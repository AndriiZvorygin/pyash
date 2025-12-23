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

async function compileTo(pyash, lang) {
  const sentence = parse(`from text quoted.pyash.${pyash}.pyash.quoted to state ${lang} to text output be compile do`);
  const result = await interpret(sentence);
  return unwrapQuoted(result?.ob?.text ?? result?.value?.text ?? "", lang);
}

async function runJs(source) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-parity-js-"));
  const jsPath = path.join(tmpDir, "out.js");
  const outPath = path.join(tmpDir, "out.txt");
  await fs.writeFile(jsPath, source, "utf8");
  await execFileAsync("bash", ["-c", `node ${jsPath} > ${outPath}`], { timeout: 120000 });
  const stdout = await fs.readFile(outPath, "utf8");
  return stdout.trim();
}

async function runC(source) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-parity-c-"));
  const cPath = path.join(tmpDir, "out.c");
  const exePath = path.join(tmpDir, "out");
  await fs.writeFile(cPath, source, "utf8");
  await execFileAsync("gcc", ["-std=c11", "-O0", "-o", exePath, cPath], { timeout: 120000 });
  const { stdout } = await execFileAsync(exePath, [], { timeout: 120000 });
  return stdout.trim();
}

test("compile insertion sort output matches between JS and C", async () => {
  forget();
  const pyash = await fs.readFile("examples/pyash/insertion-sort.pya", "utf8");

  const js = await compileTo(pyash, "javascript");
  const c = await compileTo(pyash, "c");

  const jsOut = await runJs(js);
  const cOut = await runC(c);

  assert.equal(jsOut, cOut);
});
