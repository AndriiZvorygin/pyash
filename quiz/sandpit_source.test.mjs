import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, allRemember, dumpSandpits, remember } from "../program/remember/index.mjs";

async function run(line) {
  const s = parse(line);
  return interpret(s);
}

test("sandpit first sentence is the source of truth for returned registers", async () => {
  forget();

  // ceremony: start from invoke sentence with obj/fromindex/toindex; mutate obj; return invoke
  await run("subj name worker to name num target be ceremony def");
  await run("obj num 4 to name target be add do");
  await run("this obj name target ret");
  await run("subj name worker be ceremony prah");

  await run("subj name target obj num 1 fromindex num 3 toindex num 5 be number ya");
  await run("to name target be worker do");

  const mem = allRemember();
  const sandpit = dumpSandpits().at(-1);

  const invoke = [...mem].reverse().find(s => s.be === "worker" && s.mood === "do");
  const result = mem.find(s => s.subj?.name === "result");
  const sandpitInvoke = sandpit?.[0];

  assert.ok(invoke, "invoke sentence should be stored");
  assert.ok(result, "result fact should be stored");
  assert.ok(sandpitInvoke, "sandpit trace should have an evoke sentence first");
  assert.equal(sandpitInvoke.mood, "do");
  assert.equal(sandpitInvoke.be, "worker");

  assert.ok(sandpit, "sandpit trace should exist");
  const latestTarget = [...sandpit].reverse().find(s => s.subj?.name === "target");
  assert.ok(latestTarget, "sandpit should contain updated target");

  assert.equal(invoke.obj?.num, latestTarget.obj?.num, "invoke obj mirrors sandpit source of truth");
  assert.equal(result.obj?.num, invoke.obj?.num, "result mirrors invoke obj");
  assert.equal(sandpitInvoke.fromindex?.num ?? sandpitInvoke.fromindex, latestTarget.fromindex?.num ?? latestTarget.fromindex, "fromindex retained on evoke sentence");
  assert.equal(sandpitInvoke.toindex?.num ?? sandpitInvoke.toindex, latestTarget.toindex?.num ?? latestTarget.toindex, "toindex retained on evoke sentence");

  // No additional body leakage into main memory beyond definition-time add
  const adds = mem.filter(s => s.be === "add" && s.mood === "do");
  assert.ok(adds.length <= 1, "sandpit body should not leak additional add commands");

  assert.equal(remember("fromindex"), undefined, "fromindex should remain attached to the invoke only");
  assert.equal(remember("toindex"), undefined, "toindex should remain attached to the invoke only");
});
