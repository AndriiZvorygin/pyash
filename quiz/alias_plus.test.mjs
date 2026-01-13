import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, remember } from "../program/remember/index.mjs";

async function run(line) {
  const sentence = parse(line);
  return interpret(sentence);
}

test("add alias runs plus in interpreter", async () => {
  forget();

  await run("su name collector ob num 0 be number ya");
  await run("ob num 2 to name collector be add do");

  const fact = remember("collector");
  assert.equal(fact?.ob?.num, 2);
});

test("compile treats add as plus", async () => {
  forget();

  const program = [
    "exists su name collector ob num 0 be number ya",
    "ob num 2 to name collector be add do"
  ].join("\\n");

  const sentence = parse(
    `from text quoted.pyash.${program}.pyash.quoted to state javascript to text output be compile do`
  );

  const result = await interpret(sentence);
  const js = result?.ob?.text ?? result?.value?.text ?? "";

  assert.match(js, /collector\.ob\.num = \(collector\.ob\.num \?\? 0\) \+ 2;/);
});
