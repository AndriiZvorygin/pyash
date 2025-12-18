import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";

test("compile vector fill by num N to javascript", async () => {
  forget();
  const pyash = [
    "exists subj name doors obj ve num 0 by num 5 be vector ya",
    "obj name doors be say do"
  ].join("\n");

  const sentence = parse(`from text quoted.pyash.${pyash}.pyash.quoted to state javascript to text output be compile do`);
  const result = await interpret(sentence);
  let js = result?.obj?.text ?? result?.value?.text ?? "";
  js = js.replace(/^\s*quoted\.javascript\.\s*/, "").replace(/\s*\.javascript\.quoted\s*$/, "");

  const sandbox = { console: { log: () => {} } };
  vm.runInNewContext(js, sandbox);
  const doors = sandbox.doors ?? sandbox.globalThis?.doors;
  assert.deepEqual(Array.from(doors?.obj?.ve?.values ?? []), [0, 0, 0, 0, 0]);
});
