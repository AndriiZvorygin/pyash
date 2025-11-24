import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/parser/index.mjs";
import { interpret } from "../program/dispatcher/index.mjs";
import { resetMemory, getMemory, dumpMemory } from "../program/memory/index.mjs";

async function run(line) {
  const s = parse(line);
  return interpret(s);
}

test("ceremony binds this obj into local and returns via ret", async () => {
  resetMemory();

  // define ceremony add two: acc := this.obj; acc += 2; ret acc into evoke.obj
  await run("subj name add two be ceremony def");
  await run("subj name acc obj this obj name acc be number ya");
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

test("ceremony copies this obj into a named fact and returns that fact", async () => {
  resetMemory();

  await run("subj name holder obj num 0 be number ya");
  await run("subj name copycat be ceremony def");
  await run("subj name snapshot obj this obj be number ya");
  await run("obj num 5 to name snapshot be add do");
  await run("obj name snapshot ret");
  await run("subj name copycat be ceremony prah");

  await run("obj num 10 to name holder be copycat do");

  const holder = getMemory("holder");
  const result = getMemory("result");

  assert.equal(holder.obj.num, 15, "ret of named fact should update caller");
  assert.equal(result.obj.num, 15, "result fact should mirror returned value");
});

test("ceremony ret returns full sentence with multiple registers", async () => {
  resetMemory();

  await run("subj name target obj num 1 be number ya");
  await run("subj name limiter obj num 2 be number ya");

  await run("subj name combo be ceremony def");
  await run("subj name payload obj num 3 to name target tloh num 4 until num 6 be number ya");
  await run("obj name payload ret");
  await run("subj name combo be ceremony prah");

  await run("to name target be combo do");

  const target = getMemory("target");
  const result = getMemory("result");

  assert.ok(target?.obj);
  assert.equal(target.obj.num, 3, "ret sentence should update target obj");

  assert.ok(result?.obj);
  assert.equal(result.obj.num, 3, "result fact should mirror returned obj");
  assert.equal(getMemory("tloh"), undefined, "tloh should remain on evoker, not as a register fact");
  assert.equal(getMemory("until"), undefined, "until should remain on evoker, not as a register fact");
});
