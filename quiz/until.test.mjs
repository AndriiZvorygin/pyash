import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/parser/index.mjs";
import { interpret } from "../program/dispatcher/index.mjs";
import { resetMemory, getMemory, dumpMemory } from "../program/memory/index.mjs";

async function run(line) {
  const s = parse(line);
  return interpret(s);
}

test("until register stops loop when tloh equals until", async () => {
  resetMemory();

  await run("subj name counter obj num 0 be number ya");

  // define ceremony: add 1 to counter
  await run("subj name loop body be ceremony def");
  await run("obj num 1 to name counter be add do");
  await run("subj name loop body be ceremony prah");

  // call to trigger loop with registers on the evoker
  await run("to name counter tloh num 5 until num 2 be loop body do");

  const counter = getMemory("counter");
  const invoke = [...dumpMemory()].reverse().find(s => s.mood === "do" && s.be === "loop body");

  assert.equal(invoke?.until?.num ?? invoke?.until, 2, "until should remain on the invoke");
  assert.equal(counter.obj.num, 3, "counter should increment until reaching until gap");
  assert.equal(invoke?.tloh?.num ?? invoke?.tloh, 2, "tloh should land on until value when loop stops");
  assert.equal(getMemory("tloh"), undefined, "tloh register should not be stored as its own fact");
  assert.equal(getMemory("until"), undefined, "until register should not be stored as its own fact");
});
