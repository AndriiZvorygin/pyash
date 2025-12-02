import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, remember, allRemember } from "../program/remember/index.mjs";

async function run(line) {
  const s = parse(line);
  return interpret(s);
}

test("until register stops loop when tloh equals until", async () => {
  forget();

  await run("subj name counter obj num 0 be number ya");

  // define ceremony: add 1 to counter
  await run("subj name loop body to name num tloh num 0 until num 0 be ceremony def");
  await run("obj num 1 to name counter be add do");
  await run("subj name loop body be ceremony prah");

  // call to trigger loop with registers on the evoker
  await run("to name counter tloh num 5 until num 2 be loop body do");

  const counter = remember("counter");
  const invoke = [...allRemember()].reverse().find(s => s.mood === "do" && s.be === "loop body");

  assert.equal(invoke?.until?.num ?? invoke?.until, 2, "until should remain on the invoke");
  assert.equal(counter.obj.num, 3, "counter should increment until reaching until gap");
  assert.equal(invoke?.tloh?.num ?? invoke?.tloh, 2, "tloh should land on until value when loop stops");
  assert.equal(remember("tloh"), undefined, "tloh register should not be stored as its own fact");
  assert.equal(remember("until"), undefined, "until register should not be stored as its own fact");
});
