import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../parser.mjs";
import { interpret } from "../dispatcher.mjs";
import { resetMemory, dumpMemory, dumpSandpits, getMemory } from "../memory.mjs";

async function run(line) {
  const s = parse(line);
  return interpret(s);
}

test("sandpit first sentence is the source of truth for returned registers", async () => {
  resetMemory();

  // ceremony: start from invoke sentence with obj/tloh/until; mutate obj; return invoke
  await run("subj name worker be ceremony def");
  await run("obj num 4 to name target be add do");
  await run("this obj name target ret");
  await run("subj name worker be ceremony prah");

  await run("subj name target obj num 1 tloh num 3 until num 5 be number ya");
  await run("to name target be worker do");

  const mem = dumpMemory();
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
  assert.equal(sandpitInvoke.tloh?.num ?? sandpitInvoke.tloh, latestTarget.tloh?.num ?? latestTarget.tloh, "tloh retained on evoke sentence");
  assert.equal(sandpitInvoke.until?.num ?? sandpitInvoke.until, latestTarget.until?.num ?? latestTarget.until, "until retained on evoke sentence");

  // No additional body leakage into main memory beyond definition-time add
  const adds = mem.filter(s => s.be === "add" && s.mood === "do");
  assert.ok(adds.length <= 1, "sandpit body should not leak additional add commands");

  assert.equal(getMemory("tloh"), undefined, "tloh should remain attached to the invoke only");
  assert.equal(getMemory("until"), undefined, "until should remain attached to the invoke only");
});
