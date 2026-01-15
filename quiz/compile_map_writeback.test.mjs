import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";
import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";

test("compile at all map writes back per-element ceremony mutations", async () => {
  const pyash = [
    "exists su name values ob ve num 1 2 3 be vector ya",
    "su name bump ob name num value be ceremony def",
    "exists su name val ob this ob be number ya",
    "ob num 1 be plus do",
    "su name val ret",
    "su name bump be ceremony prah",
    "ob name values at name all be bump do"
  ].join("\n");

  const sentence = parse(`from text quoted.pyash.${pyash}.pyash.quoted to state javascript to text output be compile do`);
  const result = await interpret(sentence);
  let js = result?.ob?.text ?? result?.value?.text ?? "";
  if (js.startsWith("quoted.javascript.")) js = js.slice("quoted.javascript.".length);
  if (js.endsWith(".javascript.quoted")) js = js.slice(0, -".javascript.quoted".length);
  js = js.trim();

  const sandbox = { console: { log: () => {} } };
  vm.runInNewContext(js, sandbox);

  const vec = sandbox.values ?? sandbox.globalThis?.values;
  const values = Array.from(vec?.ob?.ve?.values ?? []);
  assert.deepEqual(values, [2, 3, 4]);
});
