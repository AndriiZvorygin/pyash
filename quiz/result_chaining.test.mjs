import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, remember, allRemember } from "../program/remember/index.mjs";

async function run(line) {
  const s = parse(line);
  return interpret(s);
}

test("result fact from one evoke can feed the next", async () => {
  forget();

  // First evoke: 1 + 2 = 3
  await run("subj name a obj num 1 be number ya");
  await run("obj num 2 to name a be add do");
  const firstResult = remember("result");
  assert.equal(firstResult.obj.num, 3, "first result should be 3");

  // Second evoke: add 4 to prior result (using result as target)
  await run("obj num 4 to name result be add do");
  const secondResult = remember("result");

  assert.equal(secondResult.obj.num, 7, "chained result should be 7");
  const resultFact = remember("result");
  assert.equal(resultFact.obj.num, 7, "result fact should reflect latest addition");
});

test("chaining ceremony defs using result as input", async () => {
  forget();

  // define add-one ceremony (adds 1 to result and returns)
  await run("subj name add one to name num be ceremony def");
  await run("obj num 1 to name result be add do");
  await run("this ret");
  await run("subj name add one be ceremony prah");

  // define add-two ceremony (adds 2 to result and returns)
  await run("subj name add two to name num be ceremony def");
  await run("obj num 2 to name result be add do");
  await run("this ret");
  await run("subj name add two be ceremony prah");

  // invoke both in sequence, result feeds the next call
  await run("to name result be add one do"); // result starts at 0 by default
  await run("to name result be add two do");

  const result = remember("result");
  assert.equal(result.obj.num, 3, "chained ceremonies should produce 3");
});

test("ret merges additional fields into evoker and persists", async () => {
  forget();

  await run("subj name mark to name num be ceremony def");
  await run("obj num 5 to name target ret");
  await run("subj name mark be ceremony prah");

  await run("to name target be mark do");

  const evoker = [...allRemember()].reverse().find(s => s.be === "mark" && s.mood === "do");
  const result = remember("result");

  assert.ok(evoker, "evoker should be stored");
  assert.equal(evoker.to?.name, "target", "ret fields should merge into evoker");
  assert.equal(result.obj.num, 5, "result should reflect ret obj");
});
