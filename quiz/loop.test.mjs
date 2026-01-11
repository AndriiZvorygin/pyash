import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, remember, allRemember } from "../program/remember/index.mjs";

async function run(line) {
  const s = parse(line);
  return interpret(s);
}

test("ceremony repeats using fromindex countdown until zero", async () => {
  forget();

  await run("su name counter ob num 0 be number ya");

  // define ceremony: add 1 to counter
  await run("su name loop_body to name num target fromindex num 0 be ceremony def");
  await run("ob num 1 to name counter be plus do");
  await run("su name loop_body be ceremony prah");

  // invoke with register on the evoker
  await run("to name counter fromindex num 3 be loop_body do");

  const counter = remember("counter");
  const invoke = [...allRemember()].reverse().find(s => s.mood === "do" && s.be === "loop_body");

  assert.equal(counter.ob.num, 3, "counter should be incremented three times");
  assert.equal(invoke?.fromindex?.num ?? invoke?.fromindex, 0, "fromindex should countdown to zero on the invoke");
  assert.equal(remember("fromindex"), undefined, "fromindex should not be stored as a separate register fact");
});

test("ceremony repeats using fromindex/toindex aliases", async () => {
  forget();

  await run("su name counter ob num 0 be number ya");

  await run("su name loop_body to name num target fromindex num 0 be ceremony def");
  await run("ob num 1 to name counter be plus do");
  await run("su name loop_body be ceremony prah");

  await run("to name counter fromindex num 3 toindex num 0 be loop_body do");

  const counter = remember("counter");
  const invoke = [...allRemember()].reverse().find(s => s.mood === "do" && s.be === "loop_body");

  assert.equal(counter.ob.num, 3, "counter should be incremented three times");
  assert.equal(invoke?.fromindex?.num ?? invoke?.fromindex, 0, "fromindex should count down to zero");
});

test("loop ceremony can apply a conditional update per iteration", async () => {
  forget();

  await run("exists su name values ob ve num 1 2 3 4 be vector ya");

  await run("su name flip even to name num bucket fromindex num 0 be ceremony def");
  await run("ob this ti fromindex from num 2 to name mod be remains do");
  await run("ob name mod be equally from num 0 then ob name values at num of fromindex of this be invert do");
  await run("su name flip even be ceremony prah");

  await run("to name outside fromindex num 0 toindex num 4 be flip even do");

  const vec = remember("values");
  assert.deepEqual(vec?.ob?.ve?.values, [-1, 2, -3, 4]);
});

test("loop ceremony uses caller to-name regardless of internal binding name", async () => {
  forget();

  await run("su name alpha ob num 0 be number ya");

  // Definition says to name bucket, but caller uses to name alpha.
  await run("su name inc_loop to name num bucket fromindex num 0 be ceremony def");
  await run("ob num 1 to name alpha be plus do");
  await run("su name inc_loop be ceremony prah");

  await run("to name alpha fromindex num 3 be inc_loop do");

  const alpha = remember("alpha");
  assert.equal(alpha.ob.num, 3);
});

test("loop ceremony can mutate a vector (invert element) each iteration", async () => {
  forget();

  await run("exists su name counter ob num 0 be number ya");
  await run("exists su name doors ob ve num 2 2 be vector ya");

  await run("su name flip_first to name num bucket fromindex num 0 be ceremony def");
  await run("ob name doors at num 0 be invert do");
  await run("su name flip_first be ceremony prah");

  await run("to name counter fromindex num 3 be flip_first do");

  const doors = remember("doors");
  assert.deepEqual(doors?.ob?.ve?.values, [-2, 2]);
});

test("loop can invert boolean vector at num of fromindex of this", async () => {
  forget();

  await run("exists su name outside ob num 0 be number ya");
  await run("exists su name switches ob ve bool truth lie truth be vector ya");

  // Definition binds to name bucket, but caller uses to name outside.
  await run("su name flip_index to name num bucket fromindex num 0 be ceremony def");
  await run("ob name switches at num of fromindex of this be invert do");
  await run("su name flip_index be ceremony prah");

  await run("to name outside fromindex num 2 toindex num -1 be flip_index do");

  const switches = remember("switches");
  assert.deepEqual(switches?.ob?.ve?.values, ["lie", "truth", "lie"]);
});

test.todo("loop can perform 10-doors toggle (squares end open) using at all + by pass");

/*
test("loop can perform 10-doors toggle (squares end open) using at all + by pass", async () => {
  forget();

  await run("exists su name doors ob ve bool lie lie lie lie lie lie lie lie lie lie be vector ya");

  // Toggle current element when its (atindex+1) is divisible by the current pass (provided via `by`).
  await run("su name toggle pass by num 0 ob text placeholder be ceremony def");
  await run("su name door ob this atindex be number ya");
  await run("ob num 1 to num of ob of door be plus do");
  await run("ob name door from num of by of this to name rem be remains do");
  await run("ob name rem be equally from num 0 then ob this ob be invert do");
  await run("su name toggle pass be ceremony prah");

  // For passes 1..10 inclusive: use stop-when-equal loop by setting toindex to 11.
  await run("su name process pass fromindex num 0 be ceremony def");
  await run("ob name doors by num of fromindex of this at name all be toggle pass do");
  await run("su name process pass be ceremony prah");
  await run("fromindex num 1 toindex num 11 be process pass do");

  const doors = remember("doors");
  assert.deepEqual(doors?.ob?.ve?.values, ["truth", "lie", "lie", "truth", "lie", "lie", "lie", "lie", "truth", "lie"]);
});
*/

test("loop can perform 10-doors toggle (squares end open) using nested loops only", async () => {
  forget();

  await run("exists su name doors ob ve bool lie lie lie lie lie lie lie lie lie lie be vector ya");

  // Inner loop: iterate door indices 0..9, toggling if (doorIndex+1) % pass === 0.
  await run("su name toggle door by num 0 fromindex num 0 be ceremony def");
  await run("su name doorNum ob this fromindex be number ya");
  await run("ob num 1 to name doorNum be plus do");
  await run("ob name doorNum from num of ob of by of this to name rem be remains do");
  await run("ob name rem be equally from num 0 then ob name doors at num of fromindex of this be invert do");
  await run("su name toggle door be ceremony prah");

  // Outer loop: passes 1..10 (stop when fromindex==11).
  await run("su name process pass fromindex num 0 be ceremony def");
  await run("su name pass ob this fromindex be number ya");
  await run("by name pass fromindex num 0 toindex num 10 be toggle door do");
  await run("su name process pass be ceremony prah");
  await run("fromindex num 1 toindex num 11 be process pass do");

  const doors = remember("doors");
  assert.deepEqual(doors?.ob?.ve?.values, ["truth", "lie", "lie", "truth", "lie", "lie", "lie", "lie", "truth", "lie"]);
});
