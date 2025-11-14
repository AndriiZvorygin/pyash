// test/core.test.mjs
import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../parser.mjs";
import { interpret } from "../dispatcher.mjs";
import { dumpMemory, resetMemory } from "../memory.mjs";

async function run(line) {
  const s = parse(line);
  return interpret(s);
}

test("declarative + query: collector is 7", async () => {
  resetMemory();

  await run("subj name collector obj num 7 be number ya");
  const res = await run("subj name collector obj what que");

  assert.deepEqual(res, "subj name collector obj num 7 be number ya");
});

test("last write wins: collector becomes 10", async () => {
  resetMemory();

  await run("subj name collector obj num 7 be number ya");
  await run("subj name collector obj num 10 be number ya");

  const res = await run("subj name collector obj what que");
  assert.deepEqual(res, "subj name collector obj num 10 be number ya");
});

test("add updates collector via imperative", async () => {
  resetMemory();

  await run("subj name collector obj num 7 be number ya");
  const act = await run("obj num 2 to name collector be add do");
  const res = await run("subj name collector obj what que");

  assert.equal(act.acted, "collector");
  assert.equal(act.value.obj ?? act.value, 9); // depending on how add returns
  assert.deepEqual(res, "subj name collector obj num 9 be number ya");
});

test("giant conditional controls next statement", async () => {
  resetMemory();

  await run("subj name collector obj num 7 be number ya");
  await run("subj name collector from num 5 be giant then");
  await run("obj num 2 to name collector be add do");

  const res = await run("subj name collector obj what que");
  assert.deepEqual(res, "subj name collector obj num 9 be number ya");

  // Now a false condition should skip the next line
  resetMemory();
  await run("subj name collector obj num 3 be number ya");
  await run("subj name collector from num 5 be giant then");
  await run("obj num 2 to name collector be add do");

  const res2 = await run("subj name collector obj what que");
  assert.deepEqual(res2, "subj name collector obj num 3 be number ya");
});

test("topic sugar: ta label be topic ya", async () => {
  resetMemory();

  await run("ta loop_head be topic ya");

  const mem = dumpMemory();
  assert.equal(mem.length, 1);
  assert.equal(mem[0].subj.name, "loop_head");
  assert.equal(mem[0].be, "topic");
});
