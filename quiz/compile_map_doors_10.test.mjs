import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";

test("compile map 10-doors (at all) to javascript and run", async () => {
  forget();

  const pyash = [
    "exists su name doors ob ve num 0 0 0 0 0 0 0 0 0 0 be vector ya",
    // Toggle a single door if (atindex+1) % pass === 0.
    "su name toggle pass by num 0 ob name num value atindex num 0 be ceremony def",
    "su name door ob this atindex be number ya",
    "ob num 1 to num of ob of door be add do",
    "ob num of ob of door from num of by of this to name rem be remains do",
    "ob name rem be equally from num 0 then ob num 1 to this ti ob ti num be add do",
    "ob name rem be equally from num 0 then ob this ti ob ti num from num 2 to this ti ob ti num be remains do",
    "su name toggle pass be ceremony prah",
    // For passes 1..10 inclusive: stop when fromindex==11.
    "su name process pass fromindex num 0 be ceremony def",
    "ob name doors by num of fromindex of this at name all be toggle pass do",
    "su name process pass be ceremony prah",
    "fromindex num 1 toindex num 11 be process pass do"
  ].join("\n");

  const sentence = parse(`from text quoted.pyash.${pyash}.pyash.quoted to state javascript to text output be compile do`);
  const result = await interpret(sentence);
  let js = result?.ob?.text ?? result?.value?.text ?? "";
  js = js.replace(/^\s*quoted\.javascript\.\s*/, "").replace(/\s*\.javascript\.quoted\s*$/, "");

  const sandbox = { console: { log: () => {} } };
  vm.runInNewContext(js, sandbox);

  const doors = sandbox.doors ?? sandbox.globalThis?.doors;
  assert.deepEqual(Array.from(doors?.ob?.ve?.values ?? []), [1, 0, 0, 1, 0, 0, 0, 0, 1, 0]);
});
