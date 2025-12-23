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

test("compile C sieve 10 outputs composite vector", async () => {
  forget();
  const pyash = await fs.readFile("examples/pyash/sieve-10.pya", "utf8");
  const c = await compileToC(pyash);
  const out = await runC(c);
  const lines = out.split("\n").filter(Boolean);
  assert.equal(lines[0], "ve bool lie lie lie lie truth lie truth lie truth truth");
  assert.equal(lines[1], "ve num 2 3 5 7");
});
