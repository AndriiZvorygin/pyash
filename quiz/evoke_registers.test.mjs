import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, remember, dumpSandpits } from "../program/remember/index.mjs";

async function run(line) {
  const s = parse(line);
  return interpret(s);
}

test("evoker with registers returns via ret and stays first in sandpit trace", async () => {
  forget();

  const lines = [
    "subj name worker to name num target be ceremony def",
    "obj num 4 to name target be add do",
    "this obj name target ret",
    "subj name worker be ceremony prah",
    "subj name target obj num 1 fromindex num 3 toindex num 5 be number ya",
    "to name target be worker do",
  ];

  for (const line of lines) {
    await run(line);
  }

  const target = remember("target");
  const result = remember("result");
  const sandpit = dumpSandpits().at(-1);
  const evoker = sandpit?.[0];

  assert.ok(target, "target fact should be stored");
  assert.equal(target.obj.num, 5, "target obj should reflect ret merge");
  assert.ok(result, "result fact should be stored");
  assert.equal(result.obj.num, 5, "result mirrors ret merge");

  assert.ok(evoker, "sandpit should include evoker at index 0");
  assert.equal(evoker.mood, "do", "evoker mood should be do");
  assert.equal(evoker.be, "worker", "evoker be should match ceremony");
  assert.equal(evoker.fromindex?.num ?? evoker.fromindex, 3, "evoker carries fromindex register");
  assert.equal(evoker.toindex?.num ?? evoker.toindex, 5, "evoker carries toindex register");

  assert.equal(remember("fromindex"), undefined, "registers should not be stored as separate facts");
  assert.equal(remember("toindex"), undefined, "registers should not be stored as separate facts");
});
