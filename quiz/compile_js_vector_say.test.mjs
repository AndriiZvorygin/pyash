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

async function compileToJs(pyash) {
  const sentence = parse(`from text quoted.pyash.${pyash}.pyash.quoted to state javascript to text output be compile do`);
  const result = await interpret(sentence);
  return unwrapQuoted(result?.obj?.text ?? result?.value?.text ?? "", "javascript");
}

async function runJs(source) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-js-"));
  const jsPath = path.join(tmpDir, "out.js");
  const outPath = path.join(tmpDir, "out.txt");
  await fs.writeFile(jsPath, source, "utf8");
  await execFileAsync("bash", ["-c", `node ${jsPath} > ${outPath}`], { timeout: 120000 });
  const stdout = await fs.readFile(outPath, "utf8");
  return stdout.trim();
}

test("compile JS say name vector outputs full sentence", async () => {
  forget();
  const pyash = [
    "exists subj name values obj ve num 1 2 3 be vector ya",
    "obj name values be say do"
  ].join("\n");
  const js = await compileToJs(pyash);
  const out = await runJs(js);
  assert.equal(out, "subj name values obj ve num 1 2 3 be vector ya");
});

test("compile JS say genitive vector outputs literal", async () => {
  forget();
  const pyash = [
    "exists subj name values obj ve num 1 2 3 be vector ya",
    "obj ve of values be say do"
  ].join("\n");
  const js = await compileToJs(pyash);
  const out = await runJs(js);
  assert.equal(out, "ve num 1 2 3");
});

test("compile JS say name text vector outputs full sentence", async () => {
  forget();
  const pyash = [
    "exists subj name words obj ve text hello world be vector ya",
    "obj name words be say do"
  ].join("\n");
  const js = await compileToJs(pyash);
  const out = await runJs(js);
  assert.equal(out, "subj name words obj ve text hello world be vector ya");
});

test("compile JS say genitive text vector outputs literal", async () => {
  forget();
  const pyash = [
    "exists subj name words obj ve text hello world be vector ya",
    "obj ve of words be say do"
  ].join("\n");
  const js = await compileToJs(pyash);
  const out = await runJs(js);
  assert.equal(out, "ve text hello world");
});
