// test/core.test.mjs
import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { allRemember, forget, remember } from "../program/remember/index.mjs";

async function run(line) {
  const s = parse(line);
  return interpret(s);
}

test("declarative + query: collector is 7", async () => {
  forget();

  await run("exists su name collector ob num 7 be number ya");
  const res = await run("su name collector ob what que");

  assert.deepEqual(res, "exists su name collector ob num 7 be number ya");
});

test("missing exists on first assignment throws", async () => {
  forget();

  await assert.rejects(
    () => run("su name alpha ob num 1 be number ya"),
    /variable as not exists/
  );
});

test("last write wins: collector becomes 10", async () => {
  forget();

  await run("exists su name collector ob num 7 be number ya");
  await run("exists su name collector ob num 10 be number ya");

  const res = await run("su name collector ob what que");
  assert.deepEqual(res, "exists su name collector ob num 10 be number ya");
});

test("plus updates collector via imperative", async () => {
  forget();

  await run("exists su name collector ob num 7 be number ya");
  const act = await run("ob num 2 to name collector be plus do");
  const res = await run("su name collector ob what que");

  assert.equal(act.acted, "collector");
  assert.equal(act.value.ob ?? act.value, 9); // depending on how plus returns
  assert.deepEqual(res, "exists su name collector ob num 9 be number ya");
});

test("giant conditional controls next statement", async () => {
  forget();

  await run("exists su name collector ob num 7 be number ya");
  await run("su name collector from num 5 be giant then");
  await run("ob num 2 to name collector be plus do");

  const res = await run("su name collector ob what que");
  assert.deepEqual(res, "exists su name collector ob num 9 be number ya");

  // Now a false condition should skip the next line
  forget();
  await run("exists su name collector ob num 3 be number ya");
  await run("su name collector from num 5 be giant then");
  await run("ob num 2 to name collector be plus do");

  const res2 = await run("su name collector ob what que");
  assert.deepEqual(res2, "exists su name collector ob num 3 be number ya");
});

test("topic sugar: ta label be topic ya", async () => {
  forget();

  await run("exists ta loop_head be topic ya");

  const mem = allRemember();
  assert.equal(mem.length, 1);
  assert.equal(mem[0].su.name, "loop_head");
  assert.equal(mem[0].be, "topic");
});

test("quoted text after role stays text", () => {
  const s = parse('be say ob "hello world" do');
  assert.deepEqual(s.ob, { text: "hello world" });
});

test("quoted text after via state becomes name without marker", () => {
  const s = parse('exists su name helper be mind via state "qwen3-vl:8b-instruct" ya');
  assert.equal(s.as?.name, "qwen3-vl:8b-instruct");
});

test("date tokens parse as date payloads", () => {
  const s = parse("ob date 2025-05-01 be record ya");
  assert.equal(s.ob?.date, "2025-05-01");
});

test("def mood stores definitional fact", async () => {
  forget();

  const res = await run("su term be topic def");
  const mem = allRemember();
  const fact = mem.find(s => s.su?.name === "term");

  assert.ok(res);
  assert.ok(fact);
  assert.equal(fact.mood, "def");
});

test("prah mood marks end of paragraph and is stored", async () => {
  forget();

  const res = await run("su paragraph_end be paragraph prah");
  const mem = allRemember();
  const fact = mem.find(s => s.mood === "prah");

  assert.ok(res);
  assert.ok(fact, "prah sentence should be recorded");
  assert.equal(fact.su.name, "paragraph_end");
  assert.equal(fact.be, "paragraph");
});

test("do mood is stored in history and returns result", async () => {
  forget();

  await run("exists su name target ob num 4 be number ya");
  const res = await run("su add_demo ob num 3 to name target be plus do");
  const mem = allRemember();
  const fact = mem.find(s => s.su?.name === "add_demo");
  const target = mem.find(s => s.su?.name === "target");

  assert.ok(res);
  assert.ok(fact);
  assert.equal(fact.mood, "do");
  assert.ok(target);
  assert.deepEqual(target.ob, { num: 7 });
});

test("bare plus imperative without target name creates and stores result", async () => {
  forget();

  await run("exists su name temp ob num 4 be number ya");
  const res = await run("su temp ob num 3 to name temp be plus do");
  const mem = allRemember();
  const fact = mem.find(s => s.su?.name === "temp" && s.ob?.num === 7);

  assert.ok(res);
  assert.ok(fact, "updated fact should be stored on target");
  assert.equal(fact.ob.num, 7);
});

test("que on unknown subject returns null", async () => {
  forget();

  const res = await run("su name missing ob what que");
  assert.equal(res, null);
});

test("false condition skips one statement and then resets", async () => {
  forget();

  await run("exists su name counter ob num 1 be number ya");
  await run("ob num 1 be tiny from num 0 then"); // false -> skip next statement
  await run("ob num 10 to name counter be plus do"); // should be skipped
  await run("ob num 2 to name counter be plus do"); // should run

  const res = await run("su name counter ob what que");
  assert.equal(res, "exists su name counter ob num 3 be number ya");
});

test("imperative creates default numeric target when missing", async () => {
  forget();

  await run("ob num 5 to name scratch be plus do");

  const scratch = remember("scratch");
  assert.ok(scratch, "target should be created");
  assert.equal(scratch.ob.num, 5, "target should start at 0 and receive addition");

  const result = remember("result");
  assert.ok(result, "result fact should be stored");
  assert.equal(result.ob.num, 5, "result fact should mirror updated target");
});

test("unknown imperative verb throws", async () => {
  forget();

  await assert.rejects(() => run("ob num 1 be nowhere do"), /Unknown verb\/signature: be nowhere ob num/);
});

test("plus missing roles triggers signature error", async () => {
  forget();

  await assert.rejects(() => run("ob num 1 be plus do"), /plus: to is required/);
  await assert.rejects(() => run("to name target be plus do"), /plus: ob is required/);
});
