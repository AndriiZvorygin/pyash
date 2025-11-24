import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/parser/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { resetMemory, getMemory, dumpMemory } from "../program/memory/index.mjs";

async function run(line) {
  const s = parse(line);
  return interpret(s);
}

test("ceremony repeats using tloh countdown until zero", async () => {
  resetMemory();

  await run("subj name counter obj num 0 be number ya");

  // define ceremony: add 1 to counter
  await run("subj name loop_body be ceremony def");
  await run("obj num 1 to name counter be add do");
  await run("subj name loop_body be ceremony prah");

  // invoke with register on the evoker
  await run("to name counter tloh num 3 be loop_body do");

  const counter = getMemory("counter");
  const invoke = [...dumpMemory()].reverse().find(s => s.mood === "do" && s.be === "loop_body");

  assert.equal(counter.obj.num, 3, "counter should be incremented three times");
  assert.equal(invoke?.tloh?.num ?? invoke?.tloh, 0, "tloh should countdown to zero on the invoke");
  assert.equal(getMemory("tloh"), undefined, "tloh should not be stored as a separate register fact");
});
