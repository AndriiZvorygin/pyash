import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/parser/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { resetMemory, getMemory, dumpSandpits } from "../program/memory/index.mjs";

async function run(line) {
  const s = parse(line);
  return interpret(s);
}

test("evoker with registers returns via ret and stays first in sandpit trace", async () => {
  resetMemory();

  const lines = [
    "subj name worker be ceremony def",
    "obj num 4 to name target be add do",
    "this obj name target ret",
    "subj name worker be ceremony prah",
    "subj name target obj num 1 tloh num 3 until num 5 be number ya",
    "to name target be worker do",
  ];

  for (const line of lines) {
    await run(line);
  }

  const target = getMemory("target");
  const result = getMemory("result");
  const sandpit = dumpSandpits().at(-1);
  const evoker = sandpit?.[0];

  assert.ok(target, "target fact should be stored");
  assert.equal(target.obj.num, 5, "target obj should reflect ret merge");
  assert.ok(result, "result fact should be stored");
  assert.equal(result.obj.num, 5, "result mirrors ret merge");

  assert.ok(evoker, "sandpit should include evoker at index 0");
  assert.equal(evoker.mood, "do", "evoker mood should be do");
  assert.equal(evoker.be, "worker", "evoker be should match ceremony");
  assert.equal(evoker.tloh?.num ?? evoker.tloh, 3, "evoker carries tloh register");
  assert.equal(evoker.until?.num ?? evoker.until, 5, "evoker carries until register");

  assert.equal(getMemory("tloh"), undefined, "registers should not be stored as separate facts");
  assert.equal(getMemory("until"), undefined, "registers should not be stored as separate facts");
});
