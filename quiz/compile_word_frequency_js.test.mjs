import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";

test("compile word frequency to javascript and run", async () => {
  forget();

  const pyash = await fs.readFile("examples/pyash/word-frequency.pya", "utf8");
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

  const expected = [
    "su name wordmap be map def",
    "su name one ob num 1 ya",
    "su name two ob num 2 ya",
    "prah"
  ].join("\n");

  assert.deepEqual(logs, [expected]);
});
