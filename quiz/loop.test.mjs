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
