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

  await run("subj name counter obj num 0 be number ya");

  // define ceremony: add 1 to counter
  await run("subj name loop_body to name num fromindex num 0 be ceremony def");
  await run("obj num 1 to name counter be add do");
  await run("subj name loop_body be ceremony prah");

  // invoke with register on the evoker
  await run("to name counter fromindex num 3 be loop_body do");

  const counter = remember("counter");
  const invoke = [...allRemember()].reverse().find(s => s.mood === "do" && s.be === "loop_body");

  assert.equal(counter.obj.num, 3, "counter should be incremented three times");
  assert.equal(invoke?.fromindex?.num ?? invoke?.fromindex, 0, "fromindex should countdown to zero on the invoke");
  assert.equal(remember("fromindex"), undefined, "fromindex should not be stored as a separate register fact");
});

test("ceremony repeats using fromindex/toindex aliases", async () => {
  forget();

  await run("subj name counter obj num 0 be number ya");

  await run("subj name loop_body to name num fromindex num 0 be ceremony def");
  await run("obj num 1 to name counter be add do");
  await run("subj name loop_body be ceremony prah");

  await run("to name counter fromindex num 3 toindex num 0 be loop_body do");

  const counter = remember("counter");
  const invoke = [...allRemember()].reverse().find(s => s.mood === "do" && s.be === "loop_body");

  assert.equal(counter.obj.num, 3, "counter should be incremented three times");
  assert.equal(invoke?.fromindex?.num ?? invoke?.fromindex, 0, "fromindex should count down to zero");
});

test("loop ceremony can apply a conditional update per iteration", async () => {
  forget();

  await run("exists subj name vec obj ve num 1 2 3 4 be vector ya");

  await run("subj name flip even to name bucket fromindex num 0 be ceremony def");
  await run("obj this ti fromindex from num 2 to name mod be remains do");
  await run("obj name mod be equally from num 0 then obj name vec at num of fromindex of this be invert do");
  await run("subj name flip even be ceremony prah");

  await run("to name outside fromindex num 0 toindex num 4 be flip even do");

  const vec = remember("vec");
  assert.deepEqual(vec?.obj?.ve?.values, [-1, 2, -3, 4]);
});

test("loop ceremony uses caller to-name regardless of internal binding name", async () => {
  forget();

  await run("subj name alpha obj num 0 be number ya");

  // Definition says to name bucket, but caller uses to name alpha.
  await run("subj name inc_loop to name bucket fromindex num 0 be ceremony def");
  await run("obj num 1 to name alpha be add do");
  await run("subj name inc_loop be ceremony prah");

  await run("to name alpha fromindex num 3 be inc_loop do");

  const alpha = remember("alpha");
  assert.equal(alpha.obj.num, 3);
});

test("loop ceremony can mutate a vector (invert element) each iteration", async () => {
  forget();

  await run("exists subj name counter obj num 0 be number ya");
  await run("exists subj name doors obj ve num 2 2 be vector ya");

  await run("subj name flip_first to name bucket fromindex num 0 be ceremony def");
  await run("obj name doors at num 0 be invert do");
  await run("subj name flip_first be ceremony prah");

  await run("to name counter fromindex num 3 be flip_first do");

  const doors = remember("doors");
  assert.deepEqual(doors?.obj?.ve?.values, [-2, 2]);
});

test("loop can invert boolean vector at num of fromindex of this", async () => {
  forget();

  await run("exists subj name outside obj num 0 be number ya");
  await run("exists subj name switches obj ve bool truth lie truth be vector ya");

  // Definition binds to name bucket, but caller uses to name outside.
  await run("subj name flip_index to name bucket fromindex num 0 be ceremony def");
  await run("obj name switches at num of fromindex of this be invert do");
  await run("subj name flip_index be ceremony prah");

  await run("to name outside fromindex num 2 toindex num -1 be flip_index do");

  const switches = remember("switches");
  assert.deepEqual(switches?.obj?.ve?.values, ["lie", "truth", "lie"]);
});
