import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";

test("compile sugar: add to <local name> inside ceremony mutates local fact (not global)", async () => {
  forget();

  const pyash = [
    "exists subj name values obj ve num 0 0 0 be vector ya",
    // Ceremony body has a local 'door' fact derived from atindex; `to door` should mean door.obj.num in JS.
    "subj name bumpIndex by num 0 obj name num value atindex num 0 be ceremony def",
    "subj name door obj this atindex be number ya",
    "obj num 1 to door be add do",
    "obj num of obj of door from num of by of this to name rem be remains do",
    "obj name rem be equally from num 0 then obj num 1 to this ti obj ti num be add do",
    "subj name bumpIndex be ceremony prah",
    // Apply once: pass=1 toggles every element by +1
    "be bumpIndex obj name values by num 1 at name all do"
  ].join("\n");

  const sentence = parse(`from text quoted.pyash.${pyash}.pyash.quoted to state javascript to text output be compile do`);
  const result = await interpret(sentence);
  let js = result?.obj?.text ?? result?.value?.text ?? "";
  js = js.replace(/^\s*quoted\.javascript\.\s*/, "").replace(/\s*\.javascript\.quoted\s*$/, "");

  const sandbox = { console: { log: () => {} } };
  vm.runInNewContext(js, sandbox);

  const vec = sandbox.values ?? sandbox.globalThis?.values;
  assert.deepEqual(Array.from(vec?.obj?.ve?.values ?? []), [1, 1, 1]);
});
