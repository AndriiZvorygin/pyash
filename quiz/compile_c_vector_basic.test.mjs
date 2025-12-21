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
  return unwrapQuoted(result?.obj?.text ?? result?.value?.text ?? "", "c");
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

test("compile C supports vector literal + say full sentence", async () => {
  forget();
  const pyash = [
    "exists subj name vec obj ve num 1 2 3 be vector ya",
    "obj name vec be say do"
  ].join("\n");
  const c = await compileToC(pyash);
  const out = await runC(c);
  assert.equal(out, "subj name vec obj ve num 1 2 3 be vector ya");
});

test("compile C supports vector literal + say vector only", async () => {
  forget();
  const pyash = [
    "exists subj name vec obj ve num 1 2 3 be vector ya",
    "obj ve of vec be say do"
  ].join("\n");
  const c = await compileToC(pyash);
  const out = await runC(c);
  assert.equal(out, "ve num 1 2 3");
});

test("compile C supports text vector + say full sentence", async () => {
  forget();
  const pyash = [
    "exists subj name words obj ve text hello world be vector ya",
    "obj name words be say do"
  ].join("\n");
  const c = await compileToC(pyash);
  const out = await runC(c);
  assert.equal(out, "subj name words obj ve text hello world be vector ya");
});

test("compile C supports text vector + say vector only", async () => {
  forget();
  const pyash = [
    "exists subj name words obj ve text hello world be vector ya",
    "obj ve of words be say do"
  ].join("\n");
  const c = await compileToC(pyash);
  const out = await runC(c);
  assert.equal(out, "ve text hello world");
});

test("compile C supports vector element add at index", async () => {
  forget();
  const pyash = [
    "exists subj name vec obj ve num 1 2 3 be vector ya",
    "obj num 2 to name vec at num 2 be add do",
    "obj ve of vec be say do"
  ].join("\n");
  const c = await compileToC(pyash);
  const out = await runC(c);
  assert.equal(out, "ve num 1 2 5");
});

test("compile C supports boolean vector invert at index", async () => {
  forget();
  const pyash = [
    "exists subj name doors obj ve bool truth lie truth be vector ya",
    "obj name doors at num 1 be invert do",
    "obj ve of doors be say do"
  ].join("\n");
  const c = await compileToC(pyash);
  const out = await runC(c);
  assert.equal(out, "ve bool truth truth truth");
});

test("compile C supports vector reassignment", async () => {
  forget();
  const pyash = [
    "exists subj name vec obj ve num 1 2 3 be vector ya",
    "subj name vec obj ve num 4 5 6 be vector ya",
    "obj ve of vec be say do"
  ].join("\n");
  const c = await compileToC(pyash);
  const out = await runC(c);
  assert.equal(out, "ve num 4 5 6");
});
