import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/parser/index.mjs";
import { interpret } from "../program/dispatcher/index.mjs";
import { resetMemory, getMemory } from "../program/memory/index.mjs";

async function run(line) {
  const s = parse(line);
  return interpret(s);
}

test("subtract number from named target", async () => {
  resetMemory();

  await run("subj name collector obj num 10 be number ya");
  await run("obj num 3 from name collector be subtract do");

  const res = getMemory("collector");
  assert.equal(res.obj.num, 7);

  const resultFact = getMemory("result");
  assert.equal(resultFact.obj.num, 7);
});

test("subtract using named subtrahend and target via from", async () => {
  resetMemory();

  await run("subj name lhs obj num 8 be number ya");
  await run("subj name rhs obj num 5 be number ya");
  await run("obj name rhs from name lhs be subtract do");

  const lhs = getMemory("lhs");
  assert.equal(lhs.obj.num, 3);
  assert.equal(getMemory("result").obj.num, 3);
});
