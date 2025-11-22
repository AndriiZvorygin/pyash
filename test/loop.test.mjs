import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../parser.mjs";
import { interpret } from "../dispatcher.mjs";
import { resetMemory, getMemory } from "../memory.mjs";

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

  // seed tloh and invoke
  await run("subj name tloh obj num 3 be number ya");
  await run("to name counter be loop_body do");

  const counter = getMemory("counter");
  const tloh = getMemory("tloh");

  assert.equal(counter.obj.num, 3, "counter should be incremented three times");
  assert.equal(tloh.obj.num, 0, "tloh should countdown to zero");
});
