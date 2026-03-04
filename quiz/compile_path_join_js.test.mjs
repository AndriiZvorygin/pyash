import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";

function unwrapQuoted(text, lang) {
  return String(text || "")
    .replace(new RegExp(`^\\s*quoted\\.${lang}\\.\\s*`), "")
    .replace(new RegExp(`\\s*\\.${lang}\\.quoted\\s*$`), "");
}

test("compile to JS lowers path join to text output", async () => {
  forget();

  const pyash = [
    "ob ve text \"artifacts\" \"./run-001\" \"video.mp4\" to name text out be path join do"
  ].join("\n");
  const sentence = parse(`from text quoted.pyash.${pyash}.pyash.quoted to state javascript to text output be compile do`);
  const result = await interpret(sentence);
  const js = unwrapQuoted(result?.ob?.text ?? result?.value?.text ?? "", "javascript");

  assert.doesNotMatch(js, /TODO/);
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(js, sandbox);
  assert.equal(sandbox.out?.ob?.text, "artifacts/run-001/video.mp4");
});

test("compile to JS lowers path join to filename output", async () => {
  forget();

  const pyash = [
    "ob ve text \"artifacts\" \"run-001\" \"video.mp4\" to name filename out file be path join do"
  ].join("\n");
  const sentence = parse(`from text quoted.pyash.${pyash}.pyash.quoted to state javascript to text output be compile do`);
  const result = await interpret(sentence);
  const js = unwrapQuoted(result?.ob?.text ?? result?.value?.text ?? "", "javascript");

  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(js, sandbox);
  assert.equal(sandbox["out file"]?.ob?.filename, "artifacts/run-001/video.mp4");
});
