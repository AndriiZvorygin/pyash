import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../parser.mjs";
import { interpret } from "../dispatcher.mjs";
import { resetMemory, getMemory, dumpMemory } from "../memory.mjs";

async function run(line) {
  const s = parse(line);
  return interpret(s);
}

test("ceremony binds this obj into local and returns via ret", async () => {
  resetMemory();

  // define ceremony add two: acc := this.obj; acc += 2; ret acc into evoke.obj
  await run("subj name add two be ceremony def");
  await run("subj name acc obj this obj be number ya");
  await run("obj num 2 to name acc be add do");
  await run("this obj name acc ret");
  await run("subj name add two be ceremony prah");

  // call
  await run("obj num 5 to name result be add two do");

  const result = getMemory("result");
  const retFact = dumpMemory().find(s => s.mood === "ret");

  assert.ok(result);
  assert.equal(result.obj.num, 7, "result should reflect returned acc");
  assert.ok(retFact, "ret fact should be recorded in memory");
  assert.equal(retFact.ret?.name ?? retFact.ret?.obj?.name, "acc");
});
