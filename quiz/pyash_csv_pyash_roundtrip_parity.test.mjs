import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { execFile } from "node:child_process";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";
import { splitSentences } from "../program/library/sentenceSplitter.mjs";

function execFileAsync(file, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(file, args, opts, (err, stdout, stderr) => {
      if (err) {
        err.stdout = stdout;
        err.stderr = stderr;
        reject(err);
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

function normalizePyash(text) {
  return String(text)
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);
}

const expectedCsv = "Name,Age\nAda,36\nTuring,41\n";
const block = [
  "su name round be csv map def",
  "su name header raw ob ve text Name Age ya",
  "su name header ob ve text name age ya",
  "su name name ob ve text Ada Turing ya",
  "su name age ob ve text 36 41 ya",
  "prah",
];
const expectedPyash = [...block];

test("pyash->csv->pyash roundtrip (interpret)", async () => {
  forget();
  const entryPath = path.resolve("examples/pyash/pyash-csv-roundtrip.pya");
  const source = await fs.readFile(entryPath, "utf8");
  const lines = splitSentences(source);

  const logs = [];
  const originalLog = console.log;
  // eslint-disable-next-line no-console
  console.log = (...args) => logs.push(args.join(" "));
  try {
    for (const line of lines) {
      if (!line.trim()) continue;
      const sentence = parse(line);
      await interpret(sentence);
    }
  } finally {
    // eslint-disable-next-line no-console
    console.log = originalLog;
  }

  assert.equal(logs.length, 2);
  assert.equal(logs[0], expectedCsv);
  assert.deepEqual(normalizePyash(logs[1]), expectedPyash);
});

test("pyash->csv->pyash roundtrip (compiled JS)", async () => {
  forget();
  const sentence = parse("from filename \"examples/pyash/pyash-csv-roundtrip.pya\" from state pyash to state javascript to text output be compile do");
  const result = await interpret(sentence);
  const wrapped = result?.ob?.text ?? result?.value?.text ?? "";
  const js = wrapped.replace(/^\s*quoted\.javascript\.\s*/, "").replace(/\s*\.javascript\.quoted\s*$/, "");

  const logs = [];
  vm.runInNewContext(js, {
    console: { log: (...args) => logs.push(args.join(" ")) },
  });

  assert.equal(logs.length, 2);
  assert.equal(logs[0], expectedCsv);
  assert.deepEqual(normalizePyash(logs[1]), expectedPyash);
});

test("pyash->csv->pyash roundtrip (compiled C)", async () => {
  forget();
  const sentence = parse("from filename \"examples/pyash/pyash-csv-roundtrip.pya\" from state pyash to state c to text output be compile do");
  const result = await interpret(sentence);
  const wrapped = result?.ob?.text ?? result?.value?.text ?? "";
  const c = wrapped.replace(/^\s*quoted\.c\.\s*/, "").replace(/\s*\.c\.quoted\s*$/, "");

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-csv-roundtrip-"));
  const cPath = path.join(tmp, "out.c");
  const exePath = path.join(tmp, "out");
  await fs.writeFile(cPath, c, "utf8");

  await execFileAsync("gcc", ["-std=c11", "-O0", "-o", exePath, cPath, "-lm"]);
  const { stdout } = await execFileAsync(exePath, []);
  const lines = stdout.split(/\r?\n/);
  const firstPyash = lines.findIndex((line) => line.trim().startsWith("su name "));
  const csvText = (firstPyash >= 0 ? lines.slice(0, firstPyash) : lines)
    .filter((line) => line.length > 0)
    .join("\n") + "\n";
  const rest = firstPyash >= 0 ? lines.slice(firstPyash).join("\n") : "";

  assert.equal(csvText, expectedCsv);
  assert.deepEqual(normalizePyash(rest), expectedPyash);
});
