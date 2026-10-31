import test from "node:test";
import assert from "node:assert/strict";

import { classify, summarize } from "../command/example_audit_rules.mjs";

test("a missing input file is not a defect", () => {
  assert.equal(
    classify('su name input binding defective ob text "input binding defective: missing required input \\"source\\""'),
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
