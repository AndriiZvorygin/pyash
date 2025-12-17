import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";

test("compile ceremony loop to javascript and run", async () => {
  forget();

  const pyash = [
    "exists subj name counter obj num 0 be number ya",
    "subj name loop_body to name num fromindex num 0 be ceremony def",
    "obj num 1 to name counter be add do",
    "subj name loop_body be ceremony prah",
    "to name counter fromindex num 3 be loop_body do",
    "obj name counter be say do"
  ].join("\n");

  const sentence = parse(`from text quoted.pyash.${pyash}.pyash.quoted to state javascript to text output be compile do`);
  const result = await interpret(sentence);
  let js = result?.obj?.text ?? result?.value?.text ?? "";
  js = js.replace(/^\s*quoted\.javascript\.\s*/, "").replace(/\s*\.javascript\.quoted\s*$/, "");

  const logs = [];
  vm.runInNewContext(js, {
    console: {
      log: (...args) => logs.push(args.join(" "))
    }
  });

  assert.deepEqual(logs.map(String), ["3"]);
});
