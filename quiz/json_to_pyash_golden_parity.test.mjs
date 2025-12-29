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

const expected = [
  "su name profile meta be json map def",
  "su name active ob bool truth ya",
  "prah",
  "su name profile pets 1 be json map def",
  "su name kind ob text \"cat\" ya",
  "prah",
  "su name profile pets 2 be json map def",
  "su name kind ob text \"dog\" ya",
  "prah",
  "su name profile be json map def",
  "su name age ob num 36 ya",
  "su name flags ob ve bool truth lie ya",
  "su name meta ob name profile meta ya",
  "su name name ob text \"Ada\" ya",
  "su name pets ob ve name \"profile pets 1\" \"profile pets 2\" ya",
  "prah",
];

test("json->pyash golden example (interpret)", async () => {
  forget();
  const entryPath = path.resolve("examples/pyash/json-to-pyash-golden.pya");
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

  assert.equal(logs.length, 1);
  assert.deepEqual(normalizePyash(logs[0]), expected);
});

test("json->pyash golden example (compiled JS)", async () => {
  forget();
  const sentence = parse("from filename \"examples/pyash/json-to-pyash-golden.pya\" from state pyash to state javascript to text output be compile do");
  const result = await interpret(sentence);
  const wrapped = result?.ob?.text ?? result?.value?.text ?? "";
  const js = wrapped.replace(/^\s*quoted\.javascript\.\s*/, "").replace(/\s*\.javascript\.quoted\s*$/, "");

  const logs = [];
  vm.runInNewContext(js, {
    console: { log: (...args) => logs.push(args.join(" ")) },
  });

  assert.equal(logs.length, 1);
  assert.deepEqual(normalizePyash(logs[0]), expected);
});

test("json->pyash golden example (compiled C)", async () => {
  forget();
  const sentence = parse("from filename \"examples/pyash/json-to-pyash-golden.pya\" from state pyash to state c to text output be compile do");
  const result = await interpret(sentence);
  const wrapped = result?.ob?.text ?? result?.value?.text ?? "";
  const c = wrapped.replace(/^\s*quoted\.c\.\s*/, "").replace(/\s*\.c\.quoted\s*$/, "");

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-json-golden-"));
  const cPath = path.join(tmp, "out.c");
  const exePath = path.join(tmp, "out");
  await fs.writeFile(cPath, c, "utf8");

  await execFileAsync("gcc", ["-std=c11", "-O0", "-o", exePath, cPath, "-lm"]);
  const { stdout } = await execFileAsync(exePath, []);

  assert.deepEqual(normalizePyash(stdout), expected);
});
