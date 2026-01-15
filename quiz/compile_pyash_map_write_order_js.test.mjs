import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";

test("compile pyash map write preserves official key order (js)", async () => {
  forget();

  const pyash = [
    "su name sample be map def",
    "exists su name b ob num 2 be number ya",
    "exists su name a ob num 1 be number ya",
    "exists su name aa ob text \"x\" be text ya",
    "prah",
    "ob name sample be write do"
  ].join("\n");

  const sentence = parse(`from text quoted.pyash.${pyash}.pyash.quoted to state javascript to text output be compile do`);
  const result = await interpret(sentence);
  const wrapped = result?.ob?.text ?? result?.value?.text ?? "";
  const js = wrapped.replace(/^\s*quoted\.javascript\.\s*/, "").replace(/\s*\.javascript\.quoted\s*$/, "");

  const logs = [];
  vm.runInNewContext(js, {
    console: { log: (...args) => logs.push(args.join(" ")) }
  });

  const outputLines = logs.join("\n").split("\n").filter(Boolean);
  assert.deepEqual(outputLines, [
    "su name sample be map def",
    "exists su name a ob num 1 be number ya",
    "exists su name aa ob text \"x\" be text ya",
    "exists su name b ob num 2 be number ya",
    "prah"
  ]);
});
