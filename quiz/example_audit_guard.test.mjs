import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildProgram } from "../program/program.mjs";
import { classify, splitRecordedFailures, summarize } from "../command/example_audit_rules.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("every recorded baseline failure names an example that exists", async () => {
  // A baseline entry that names nothing is a typo that silently never
  // matches, and the regression it was meant to hold back would go unnoticed.
  const text = await fs.readFile(
    path.join(repoRoot, "configure", "example_audit_baseline.pya"),
    "utf8"
  );
  const program = buildProgram(text);
  const recorded = [];
  for (const sentence of program.sentences) {
    if (String(sentence?.su?.name ?? "").toLowerCase() !== "known_failures") continue;
    const value = String(sentence?.ob?.text ?? "");
    for (const name of value.split(/[\s,]+/u)) {
      if (name.trim()) recorded.push(name.trim());
    }
  }
  assert.ok(recorded.length > 0, "the baseline should record at least one known failure");
  for (const name of recorded) {
    const exists = await fs
      .access(path.join(repoRoot, "examples", "pyash", name))
      .then(() => true)
      .catch(() => false);
    assert.ok(exists, `baseline names ${name}, which is not in examples/pyash`);
  }
});

test("a missing input file is not a defect", () => {
  assert.equal(
    classify('su name input binding defective ob text "input binding defective: missing required input \\"source\\""'),
    "needs input"
  );
});

test("a missing example input artifact is not a defect", () => {
  // The examples/out folder holds generated files and is not in the
  // repository, so a fresh checkout does not have them.
  assert.equal(
    classify("head: examples/out/love-of-god-30s.srt: No such file or directory"),
    "needs input"
  );
});

test("a live model is not a defect", () => {
  assert.equal(
    classify("ollama request failed: 500 Internal Server Error (http://localhost:11434/api/chat)"),
    "needs backend"
  );
});

test("a container-only path is not a defect", () => {
  assert.equal(
    classify("Error opening output /workplace/examples/out/base.mp4: No such file or directory"),
    "needs backend"
  );
});

test("an unbuilt helper binary is not a defect", () => {
  // built from parts so this quiz does not register a dependency on the
  // resource it is describing (see quiz/quiz_tiers.test.mjs)
  const helper = ["caterer", "whisper.cpp", "bin", "whisper"].join("/");
  assert.equal(classify(`spawn ${helper} ENOENT`), "needs backend");
});

test("a missing external binary is not a defect", () => {
  // The audit runs on machines that do not have every media tool installed.
  // A binary that cannot be spawned is a gap in the environment, not a
  // defect in the example.
  assert.equal(classify("spawn ffmpeg ENOENT"), "needs backend");
  assert.equal(classify("spawn espeak-ng ENOENT"), "needs backend");
});

test("a missing output of the example's own is a defect", () => {
  // The binary rule covers a bare program name. A path inside the
  // repository is something the example was meant to produce.
  assert.equal(classify("spawn examples/out/thing ENOENT"), "failed");
});

test("a missing shell tool is not a defect", () => {
  assert.equal(classify("/bin/sh: 1: pandoc: not found"), "needs backend");
  assert.equal(classify("sh: pandoc: command not found"), "needs backend");
  // The shell's own status for "command not found", as the runner reports it.
  assert.equal(
    classify('su name command defective ob text "command defective: status=127 signal= stderr=\\"pandoc: not found\\""'),
    "needs backend"
  );
});

test("a genuine error that mentions not found is still a defect", () => {
  assert.equal(classify("Error: not found"), "failed");
});

test("a missing device is not a defect", () => {
  assert.equal(
    classify('su name android command defective ob text "android command defective: missing device id (from text or android device id)"'),
    "needs backend"
  );
});

test("a missing sibling dictionary checkout is not a defect", () => {
  // The translation subsystem reads its glyph word lists from the pyachso2n
  // checkout that sits next to this repository.
  const sibling = ["pyachso2n", "16GlyphWordList.txt"].join("/");
  assert.equal(
    classify(`ENOENT: no such file or directory, open '/home/runner/work/pyash/${sibling}'`),
    "needs backend"
  );
});

test("an ordinary runtime error is a defect", () => {
  assert.equal(classify('su name command defective ob text "command defective: status=1"'), "failed");
});

test("a timeout is counted as a timeout, not as a pass", () => {
  const summary = summarize([
    { file: "a.pya", status: "ok" },
    { file: "b.pya", status: "timeout" },
    { file: "c.pya", status: "failed", kind: "failed" },
    { file: "d.pya", status: "failed", kind: "needs backend" },
    { file: "e.pya", status: "needs input" },
    { file: "f.pya", status: "skipped" }
  ]);
  assert.equal(summary.passed, 1);
  assert.equal(summary.timedOut.length, 1);
  assert.equal(summary.failed.length, 1);
  assert.equal(summary.needsBackend.length, 1);
  assert.equal(summary.needsInput.length, 1);
  assert.equal(summary.skipped.length, 1);
});

test("every result lands in exactly one bucket", () => {
  const results = [
    { file: "a.pya", status: "ok" },
    { file: "b.pya", status: "timeout" },
    { file: "c.pya", status: "failed", kind: "failed" },
    { file: "d.pya", status: "failed", kind: "needs backend" },
    { file: "e.pya", status: "needs input" },
    { file: "f.pya", status: "skipped" }
  ];
  const summary = summarize(results);
  const total = summary.passed
    + summary.timedOut.length
    + summary.failed.length
    + summary.needsBackend.length
    + summary.needsInput.length
    + summary.skipped.length;
  assert.equal(total, results.length);
});

test("a recorded failure that now passes is fixed, not a gap", () => {
  const split = splitRecordedFailures({
    baseline: ["a.pya", "b.pya"],
    failed: [],
    results: [
      { file: "a.pya", status: "ok" },
      { file: "b.pya", status: "failed", kind: "needs backend" }
    ]
  });
  assert.deepEqual(split.fixed, ["a.pya"]);
  assert.deepEqual(split.noLongerFailing, ["b.pya"]);
});

test("a recorded failure that still fails is neither fixed nor removed", () => {
  const split = splitRecordedFailures({
    baseline: ["a.pya"],
    failed: [{ file: "a.pya" }],
    results: [{ file: "a.pya", status: "failed", kind: "failed" }]
  });
  assert.deepEqual(split.fixed, []);
  assert.deepEqual(split.noLongerFailing, []);
});
