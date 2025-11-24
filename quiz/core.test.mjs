// test/core.test.mjs
import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/parser/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { dumpMemory, resetMemory } from "../program/memory/index.mjs";

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

test("def mood stores definitional fact", async () => {
  resetMemory();

  const res = await run("su term be topic def");
  const mem = dumpMemory();
  const fact = mem.find(s => s.subj?.name === "term");

  assert.ok(res);
  assert.ok(fact);
  assert.equal(fact.mood, "def");
});

test("prah mood marks end of paragraph and is stored", async () => {
  resetMemory();

  const res = await run("su paragraph_end be paragraph prah");
  const mem = dumpMemory();
  const fact = mem.find(s => s.mood === "prah");

  assert.ok(res);
  assert.ok(fact, "prah sentence should be recorded");
  assert.equal(fact.subj.name, "paragraph_end");
  assert.equal(fact.be, "paragraph");
});

test("do mood is stored in history and returns result", async () => {
  resetMemory();

  await run("su target obj num 4 be number ya");
  const res = await run("su add_demo obj num 3 to name target be add do");
  const mem = dumpMemory();
  const fact = mem.find(s => s.subj?.name === "add_demo");
  const target = mem.find(s => s.subj?.name === "target");

  assert.ok(res);
  assert.ok(fact);
  assert.equal(fact.mood, "do");
  assert.ok(target);
  assert.deepEqual(target.obj, { num: 7 });
});

test("bare add imperative without target name creates and stores result", async () => {
  resetMemory();

  await run("su temp obj num 4 be number ya");
  const res = await run("su temp obj num 3 to name temp be add do");
  const mem = dumpMemory();
  const fact = mem.find(s => s.subj?.name === "temp" && s.obj?.num === 7);

  assert.ok(res);
  assert.ok(fact, "updated fact should be stored on target");
  assert.equal(fact.obj.num, 7);
});
