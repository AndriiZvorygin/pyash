import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import vm from "node:vm";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";
import { splitSentences } from "../program/library/sentenceSplitter.mjs";

const execFileAsync = promisify(execFile);

function unwrapQuoted(text, lang) {
  return String(text || "")
    .replace(new RegExp(`^\\s*quoted\\.${lang}\\.\\s*`), "")
    .replace(new RegExp(`\\s*\\.${lang}\\.quoted\\s*$`), "");
}

function normalizeLines(text) {
  return String(text)
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);
}

const expected = [
  "exists su name record ob la su name clause ob name example be text ya ko be note ya"
];

test("subordinate clause golden: run, runjs, runc parity", async () => {
  forget();
  const entryPath = path.resolve("examples/pyash/subordinate-clause-golden.pya");
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
  assert.deepEqual(normalizeLines(logs[0]), expected);

  const jsSentence = parse(`from filename "${entryPath}" to state javascript to text output be compile do`);
  const jsResult = await interpret(jsSentence);
  const js = unwrapQuoted(jsResult?.ob?.text ?? jsResult?.value?.text ?? "", "javascript");
  const jsLogs = [];
  vm.runInNewContext(js, {
    console: { log: (...args) => jsLogs.push(args.join(" ")) }
  });
  assert.equal(jsLogs.length, 1);
  assert.deepEqual(normalizeLines(jsLogs[0]), expected);

  const cSentence = parse(`from filename "${entryPath}" to state c to text output be compile do`);
  const cResult = await interpret(cSentence);
  const c = unwrapQuoted(cResult?.ob?.text ?? cResult?.value?.text ?? "", "c");

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-c-"));
  const cPath = path.join(tmpDir, "out.c");
  const exePath = path.join(tmpDir, "out");
  await fs.writeFile(cPath, c, "utf8");

  await execFileAsync("gcc", ["-std=c11", "-O0", "-o", exePath, cPath, "-lm"], { timeout: 120000 });
  const { stdout } = await execFileAsync(exePath, [], { timeout: 120000 });

  assert.deepEqual(normalizeLines(stdout), expected);
});
