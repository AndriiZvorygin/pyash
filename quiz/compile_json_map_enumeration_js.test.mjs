import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";

test("compile json map enumeration example to javascript and run", async () => {
  forget();

  const pyash = await fs.readFile("examples/pyash/json-map-enumeration.pya", "utf8");
  const sentence = parse(`from text quoted.pyash.${pyash}.pyash.quoted to state javascript to text output be compile do`);
  const result = await interpret(sentence);
  const wrapped = result?.ob?.text ?? result?.value?.text ?? "";
  const js = wrapped.replace(/^\s*quoted\.javascript\.\s*/, "").replace(/\s*\.javascript\.quoted\s*$/, "");

  const logs = [];
  vm.runInNewContext(js, {
    console: {
      log: (...args) => logs.push(args.join(" "))
    }
  });

  assert.deepEqual(logs, [
    "su name result ob ve text a aa b be vector ya",
    "su name result ob ve text ace double bee be vector ya"
  ]);
});
