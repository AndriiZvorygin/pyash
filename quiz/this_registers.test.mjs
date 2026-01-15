import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, remember, dumpSandpits } from "../program/remember/index.mjs";

async function run(line) {
  const s = parse(line);
  return interpret(s);
}

test("this fromindex/this toindex bindings inside sandpit preserve registers on evoker", async () => {
  forget();

  const lines = [
    "su name inspector to name num target fromindex num 0 toindex num 0 be ceremony def",
    "exists su name seen-fromindex ob this fromindex be number ya",
    "exists su name seen-toindex ob this toindex be number ya",
    "this ret",
    "su name inspector be ceremony prah",
    "to name sink fromindex num 2 toindex num 2 be inspector do",
  ];

  for (const line of lines) {
    await run(line);
  }

  const result = remember("result");
  const sandpit = dumpSandpits().at(-1);
  const evoker = sandpit?.[0];
  const seenFrom = sandpit ? [...sandpit].reverse().find(s => s.su?.name === "seen-fromindex") : null;
  const seenTo = sandpit ? [...sandpit].reverse().find(s => s.su?.name === "seen-toindex") : null;

  assert.ok(evoker, "evoker should be recorded first in sandpit");
  assert.equal(evoker.fromindex?.num ?? evoker.fromindex, 2, "evoker fromindex should remain at initial value when toindex matches");
  assert.equal(evoker.toindex?.num ?? evoker.toindex, 2);

  assert.equal(seenFrom?.ob?.num ?? seenFrom?.ob, 2, "this fromindex should bind into seen fact");
  assert.equal(seenTo?.ob?.num ?? seenTo?.ob, 2, "this toindex should bind into seen fact");

  assert.ok(result, "result fact should be present");

  assert.equal(remember("fromindex"), undefined, "no standalone fromindex fact");
  assert.equal(remember("toindex"), undefined, "no standalone toindex fact");
});
