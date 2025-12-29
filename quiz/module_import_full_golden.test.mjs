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
import { setEntryModulePath } from "../program/bridge/modules.mjs";
import { splitSentences } from "../program/library/sentenceSplitter.mjs";

const execFileAsync = promisify(execFile);

function unwrapQuoted(text, lang) {
  return String(text || "")
    .replace(new RegExp(`^\\s*quoted\\.${lang}\\.\\s*`), "")
    .replace(new RegExp(`\\s*\\.${lang}\\.quoted\\s*$`), "");
}

test("full module import golden: run, runjs, runc parity", async () => {
  forget();
  const entryPath = path.resolve("examples/pyash/module-import-full.pya");
  setEntryModulePath(entryPath);

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

  const mapText = [
    "su name settings be map def",
    "su name limit ob num 3 ya",
    "su name mode ob text \"ready\" ya",
    "prah"
  ].join("\n");

  assert.deepEqual(logs, [mapText, "2", "5", "7"]);

  const jsSentence = parse(`from filename "${entryPath}" to state javascript to text output be compile do`);
  const jsResult = await interpret(jsSentence);
  const js = unwrapQuoted(jsResult?.ob?.text ?? jsResult?.value?.text ?? "", "javascript");
  const jsLogs = [];
  vm.runInNewContext(js, {
    console: { log: (...args) => jsLogs.push(args.join(" ")) }
  });
  assert.deepEqual(jsLogs, [mapText, "2", "5", "7"]);

  const cSentence = parse(`from filename "${entryPath}" to state c to text output be compile do`);
  const cResult = await interpret(cSentence);
  const c = unwrapQuoted(cResult?.ob?.text ?? cResult?.value?.text ?? "", "c");

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-c-"));
  const cPath = path.join(tmpDir, "out.c");
  const exePath = path.join(tmpDir, "out");
  await fs.writeFile(cPath, c, "utf8");

  await execFileAsync("gcc", ["-std=c11", "-O0", "-o", exePath, cPath, "-lm"], { timeout: 120000 });
  const { stdout } = await execFileAsync(exePath, [], { timeout: 120000 });

  assert.deepEqual(stdout.trim().split(/\r?\n/), [
    "su name settings be map def",
    "su name limit ob num 3 ya",
    "su name mode ob text \"ready\" ya",
    "prah",
    "2",
    "5",
    "7"
  ]);
});
