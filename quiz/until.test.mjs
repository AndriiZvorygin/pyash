import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, remember, allRemember } from "../program/remember/index.mjs";

async function run(line) {
  const s = parse(line);
  return interpret(s);
}

test("toindex stops loop when fromindex equals toindex", async () => {
  forget();

  await run("su name counter ob num 0 be number ya");

  // define ceremony: add 1 to counter
  await run("su name loop body to name num target fromindex num 0 toindex num 0 be ceremony def");
  await run("ob num 1 to name counter be plus do");
  await run("su name loop body be ceremony prah");

  // call to trigger loop with registers on the evoker
  await run("to name counter fromindex num 5 toindex num 2 be loop body do");

  const counter = remember("counter");
  const invoke = [...allRemember()].reverse().find(s => s.mood === "do" && s.be === "loop body");

  assert.equal(invoke?.toindex?.num ?? invoke?.toindex, 2, "toindex should remain on the invoke");
  assert.equal(counter.ob.num, 3, "counter should increment until reaching toindex gap");
  assert.equal(invoke?.fromindex?.num ?? invoke?.fromindex, 2, "fromindex should land on toindex value when loop stops");
  assert.equal(remember("fromindex"), undefined, "fromindex register should not be stored as its own fact");
  assert.equal(remember("toindex"), undefined, "toindex register should not be stored as its own fact");
});
