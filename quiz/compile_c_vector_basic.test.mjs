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

test("compile C supports vector literal + write full sentence", async () => {
  forget();
  const pyash = [
    "exists su name values ob ve num 1 2 3 be vector ya",
    "ob name values be write do"
  ].join("\n");
  const c = await compileToC(pyash);
  const out = await runC(c);
  assert.equal(out, "su name values ob ve num 1 2 3 be vector ya");
});

test("compile C supports vector literal + write vector only", async () => {
  forget();
  const pyash = [
    "exists su name values ob ve num 1 2 3 be vector ya",
    "ob ve of values be write do"
  ].join("\n");
  const c = await compileToC(pyash);
  const out = await runC(c);
  assert.equal(out, "ve num 1 2 3");
});

test("compile C supports text vector + write full sentence", async () => {
  forget();
  const pyash = [
    "exists su name words ob ve text hello world be vector ya",
    "ob name words be write do"
  ].join("\n");
  const c = await compileToC(pyash);
  const out = await runC(c);
  assert.equal(out, "su name words ob ve text hello world be vector ya");
});

test("compile C supports text vector + write vector only", async () => {
  forget();
  const pyash = [
    "exists su name words ob ve text hello world be vector ya",
    "ob ve of words be write do"
  ].join("\n");
  const c = await compileToC(pyash);
  const out = await runC(c);
  assert.equal(out, "ve text hello world");
});

test("compile C supports vector element add at index", async () => {
  forget();
  const pyash = [
    "exists su name values ob ve num 1 2 3 be vector ya",
    "ob num 2 to name values at num 2 be plus do",
    "ob ve of values be write do"
  ].join("\n");
  const c = await compileToC(pyash);
  const out = await runC(c);
  assert.equal(out, "ve num 1 2 5");
});

test("compile C supports boolean vector invert at index", async () => {
  forget();
  const pyash = [
    "exists su name doors ob ve bool truth lie truth be vector ya",
    "ob name doors at num 1 be invert do",
    "ob ve of doors be write do"
  ].join("\n");
  const c = await compileToC(pyash);
  const out = await runC(c);
  assert.equal(out, "ve bool truth truth truth");
});

test("compile C supports vector reassignment", async () => {
  forget();
  const pyash = [
    "exists su name values ob ve num 1 2 3 be vector ya",
    "su name values ob ve num 4 5 6 be vector ya",
    "ob ve of values be write do"
  ].join("\n");
  const c = await compileToC(pyash);
  const out = await runC(c);
  assert.equal(out, "ve num 4 5 6");
});

test("compile C supports write to vector element", async () => {
  forget();
  const pyash = [
    "exists su name values ob ve num 10 20 30 be vector ya",
    "ob num 99 to name values at num 1 be write do",
    "ob ve of values be write do"
  ].join("\n");
  const c = await compileToC(pyash);
  const out = await runC(c);
  assert.equal(out, "ve num 10 99 30");
});
