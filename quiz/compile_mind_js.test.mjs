import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";

async function compileToJs(pyash) {
  const sentence = parse(`from text quoted.pyash.${pyash}.pyash.quoted to state javascript to text output be compile do`);
  const res = await interpret(sentence);
  return res?.ob?.text ?? res?.value?.text ?? "";
}

test("compile mind to javascript uses PYA_MIND_RESPONSE", async () => {
  const pyash = [
    "exists su name helper be mind via state \"qwen3\" ya",
    "su name answer ob text \"Hello\" to name helper be mind do"
  ].join("\n");
  const wrapped = await compileToJs(pyash);
  const js = wrapped.replace(/^\s*quoted\.javascript\.\s*/, "").replace(/\s*\.javascript\.quoted\s*$/, "");
  const logs = [];
  vm.runInNewContext(js, {
    console: { log: (...args) => logs.push(args.join(" ")) },
    process: { env: { PYA_MIND_RESPONSE: "OK" } },
    SharedArrayBuffer,
    Atomics
  });
  assert.equal(logs.join("\n").trim(), "OK");
});
