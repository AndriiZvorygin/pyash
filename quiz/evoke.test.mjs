import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, remember, allRemember } from "../program/remember/index.mjs";

async function run(line) {
  const s = parse(line);
  return interpret(s);
}

test("ceremony binds this obj into local and returns via ret", async () => {
  forget();

  // define ceremony add two: acc := this.obj; acc += 2; ret acc into evoke.obj
  await run("subj name add two obj num 0 to name num target be ceremony def");
  await run("subj name acc obj this obj name acc be number ya");
  await run("obj num 2 to name acc be add do");
  await run("this obj name acc ret");
  await run("subj name add two be ceremony prah");

  // call
  await run("obj num 5 to name result be add two do");

  const result = remember("result");
  const retFact = allRemember().find(s => s.mood === "ret");

  assert.ok(result);
  assert.equal(result.obj.num, 7, "result should reflect returned acc");
  assert.ok(retFact, "ret fact should be recorded in memory");
  assert.equal(retFact.ret?.name ?? retFact.ret?.obj?.name, "acc");
});

test("ceremony copies this obj into a named fact and returns that fact", async () => {
  forget();

  await run("subj name holder obj num 0 be number ya");
  await run("subj name copycat obj num 0 to name num target be ceremony def");
  await run("subj name snapshot obj this obj be number ya");
  await run("obj num 5 to name snapshot be add do");
  await run("obj name snapshot ret");
  await run("subj name copycat be ceremony prah");

  await run("obj num 10 to name holder be copycat do");

  const holder = remember("holder");
  const result = remember("result");

  assert.equal(holder.obj.num, 15, "ret of named fact should update caller");
  assert.equal(result.obj.num, 15, "result fact should mirror returned value");
});

test("ceremony ret returns full sentence with multiple registers", async () => {
  forget();

  await run("subj name target obj num 1 be number ya");
  await run("subj name limiter obj num 2 be number ya");

  await run("subj name combo to name num target be ceremony def");
  await run("subj name payload obj num 3 to name target fromindex num 4 toindex num 6 be number ya");
  await run("obj name payload ret");
  await run("subj name combo be ceremony prah");

  await run("to name target be combo do");

  const target = remember("target");
  const result = remember("result");

  assert.ok(target?.obj);
  assert.equal(target.obj.num, 3, "ret sentence should update target obj");

  assert.ok(result?.obj);
  assert.equal(result.obj.num, 3, "result fact should mirror returned obj");
  assert.equal(remember("fromindex"), undefined, "fromindex should remain on evoker, not as a register fact");
  assert.equal(remember("toindex"), undefined, "toindex should remain on evoker, not as a register fact");
});

test("ret errors when binding is unknown", async () => {
  forget();

  await run("subj name broken be ceremony def");
  await run("obj name missing ret");
  await run("subj name broken be ceremony prah");

  await assert.rejects(() => run("be broken do"), /ret: unknown binding missing/);
});
