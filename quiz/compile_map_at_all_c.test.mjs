import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";

const execFileAsync = promisify(execFile);

function unwrapQuoted(text, lang) {
  return String(text || "")
    .replace(new RegExp(`^\\s*quoted\\.${lang}\\.\\s*`), "")
    .replace(new RegExp(`\\s*\\.${lang}\\.quoted\\s*$`), "");
}

async function compileToC(pyash) {
  const sentence = parse(`from text quoted.pyash.${pyash}.pyash.quoted to state c to text output be compile do`);
  const result = await interpret(sentence);
  return unwrapQuoted(result?.ob?.text ?? result?.value?.text ?? "", "c");
}

async function runC(source) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-c-"));
  const cPath = path.join(tmpDir, "out.c");
  const exePath = path.join(tmpDir, "out");
  await fs.writeFile(cPath, source, "utf8");
  await execFileAsync("gcc", ["-std=c11", "-O0", "-o", exePath, cPath], { timeout: 120000 });
  const { stdout } = await execFileAsync(exePath, [], { timeout: 120000 });
  return stdout.trim();
}

test("compile C at all ceremony map writes back", async () => {
  forget();
  const pyash = [
    "exists su name values ob ve num 1 2 3 be vector ya",
    "su name bump ob num 0 be ceremony def",
    "exists su name val ob num of ob of this be number ya",
    "ob num 1 to name val be plus do",
    "this ob name val ret",
    "su name bump be ceremony prah",
    "ob name values at name all be bump do",
    "ob ve of values be write do"
  ].join("\n");
  const c = await compileToC(pyash);
  const out = await runC(c);
  assert.equal(out, "ve num 2 3 4");
});

test("compile C at all primitive map writes to to-name", async () => {
  forget();
  const pyash = [
    "exists su name values ob ve num 1 -2 3 be vector ya",
    "be invert ob name values to name out at name all do",
    "ob ve of out be write do"
  ].join("\n");
  const c = await compileToC(pyash);
  const out = await runC(c);
  assert.equal(out, "ve num -1 2 -3");
});
