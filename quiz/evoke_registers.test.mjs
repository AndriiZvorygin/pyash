import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, remember, dumpSandpits } from "../program/remember/index.mjs";

async function run(line) {
  const s = parse(line);
  return interpret(s);
}

test("evoker registers stay authoritative when the target has stale registers", async () => {
  forget();

  const lines = [
    "su name worker to name num target be ceremony def",
    "ob num 4 to name target be plus do",
    "this ob name target ret",
    "su name worker be ceremony prah",
    "exists su name target ob num 1 fromindex num 99 toindex num 99 by num 4 be number ya",
    "to name target fromindex num 3 toindex num 5 be worker do",
  ];

  for (const line of lines) {
    await run(line);
  }

  const target = remember("target");
  const result = remember("result");
  const sandpit = dumpSandpits().at(-1);
  const evoker = sandpit?.[0];

  assert.ok(target, "target fact should be stored");
  assert.equal(target.ob.num, 9, "target ob should reflect both loop iterations");
  assert.equal(target.by?.num, 4, "loop target write-back should preserve by");
  assert.equal(target.fromindex?.num ?? target.fromindex, 99, "target fromindex should remain target data");
  assert.equal(target.toindex?.num ?? target.toindex, 99, "target toindex should remain target data");
  assert.ok(result, "result fact should be stored");
  assert.equal(result.ob.num, 9, "result mirrors ret merge");

  assert.ok(evoker, "sandpit should include evoker at index 0");
  assert.equal(evoker.mood, "do", "evoker mood should be do");
  assert.equal(evoker.be, "number", "evoker be should match resolved ceremony output");
  assert.equal(evoker.fromindex?.num ?? evoker.fromindex, 5, "evoker carries final fromindex register");
  assert.equal(evoker.toindex?.num ?? evoker.toindex, 5, "evoker carries final toindex register");

  assert.equal(remember("fromindex"), undefined, "registers should not be stored as separate facts");
  assert.equal(remember("toindex"), undefined, "registers should not be stored as separate facts");
});
