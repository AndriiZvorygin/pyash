import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, remember, allRemember } from "../program/remember/index.mjs";

async function run(line) {
  const s = parse(line);
  return interpret(s);
}

test("ceremony binds this ob into local and returns via ret", async () => {
  forget();

  // define ceremony plus two: acc := this.ob; acc += 2; ret acc into evoke.ob
  await run("su name plus two ob num 0 to name num target be ceremony def");
  await run("su name acc ob this ob name acc be number ya");
  await run("ob num 2 to name acc be plus do");
  await run("this ob name acc ret");
  await run("su name plus two be ceremony prah");

  // call
  await run("ob num 5 to name result be plus two do");

  const result = remember("result");
  const retFact = allRemember().find(s => s.mood === "ret");

  assert.ok(result);
  assert.equal(result.ob.num, 7, "result should reflect returned acc");
  assert.ok(retFact, "ret fact should be recorded in memory");
  assert.equal(retFact.ret?.name ?? retFact.ret?.ob?.name, "acc");
});

test("ceremony copies this ob into a named fact and returns that fact", async () => {
  forget();

  await run("su name holder ob num 0 be number ya");
  await run("su name copycat ob num 0 to name num target be ceremony def");
  await run("su name snapshot ob this ob be number ya");
  await run("ob num 5 to name snapshot be plus do");
  await run("ob name snapshot ret");
  await run("su name copycat be ceremony prah");

  await run("ob num 10 to name holder be copycat do");

  const holder = remember("holder");
  const result = remember("result");

  assert.equal(holder.ob.num, 15, "ret of named fact should update caller");
  assert.equal(result.ob.num, 15, "result fact should mirror returned value");
});

test("ceremony ret returns full sentence with multiple registers", async () => {
  forget();

  await run("su name target ob num 1 be number ya");
  await run("su name limiter ob num 2 be number ya");

  await run("su name combo to name num target be ceremony def");
  await run("su name payload ob num 3 to name target fromindex num 4 toindex num 6 be number ya");
  await run("ob name payload ret");
  await run("su name combo be ceremony prah");

  await run("to name target be combo do");

  const target = remember("target");
  const result = remember("result");

  assert.ok(target?.ob);
  assert.equal(target.ob.num, 3, "ret sentence should update target ob");

  assert.ok(result?.ob);
  assert.equal(result.ob.num, 3, "result fact should mirror returned ob");
  assert.equal(remember("fromindex"), undefined, "fromindex should remain on evoker, not as a register fact");
  assert.equal(remember("toindex"), undefined, "toindex should remain on evoker, not as a register fact");
});

test("ret errors when binding is unknown", async () => {
  forget();

  await run("su name broken be ceremony def");
  await run("ob name missing ret");
  await run("su name broken be ceremony prah");

  await assert.rejects(() => run("be broken do"), /ret: unknown binding missing/);
});
