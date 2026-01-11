import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";

test("compile sugar: plus to <local name> inside ceremony mutates local fact (not global)", async () => {
  forget();

  const pyash = [
    "exists su name values ob ve num 0 0 0 be vector ya",
    // Ceremony body has a local 'door' fact derived from atindex; `to door` should mean door.ob.num in JS.
    "su name bumpIndex by num 0 ob name num value atindex num 0 be ceremony def",
    "su name door ob this atindex be number ya",
    "ob num 1 to door be plus do",
    "ob num of ob of door from num of by of this to name rem be remains do",
    "ob name rem be equally from num 0 then ob num 1 to this ti ob ti num be plus do",
    "su name bumpIndex be ceremony prah",
    // Apply once: pass=1 toggles every element by +1
    "be bumpIndex ob name values by num 1 at name all do"
  ].join("\n");

  const sentence = parse(`from text quoted.pyash.${pyash}.pyash.quoted to state javascript to text output be compile do`);
  const result = await interpret(sentence);
  let js = result?.ob?.text ?? result?.value?.text ?? "";
  js = js.replace(/^\s*quoted\.javascript\.\s*/, "").replace(/\s*\.javascript\.quoted\s*$/, "");

  const sandbox = { console: { log: () => {} } };
  vm.runInNewContext(js, sandbox);

  const vec = sandbox.values ?? sandbox.globalThis?.values;
  assert.deepEqual(Array.from(vec?.ob?.ve?.values ?? []), [1, 1, 1]);
});
