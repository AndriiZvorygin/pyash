import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../parser.mjs";
import { interpret } from "../dispatcher.mjs";
import { resetMemory, getMemory } from "../memory.mjs";

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

  // seed tloh and until (count down from 5 to 2)
  await run("subj name tloh obj num 5 be number ya");
  await run("subj name until obj num 2 be number ya");

  // call to trigger loop
  await run("to name counter be loop body do");

  const counter = getMemory("counter");
  const tloh = getMemory("tloh");
  const until = getMemory("until");

  assert.equal(until.obj.num, 2, "until should remain at target");
  assert.equal(counter.obj.num, 3, "counter should increment until reaching until gap");
  assert.equal(tloh.obj.num, 2, "tloh should land on until value when loop stops");
});
