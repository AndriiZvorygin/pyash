import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { resetMemory, getMemory, dumpSandpits } from "../program/memory/index.mjs";

async function run(line) {
  const s = parse(line);
  return interpret(s);
}

test("this tloh/this until bindings inside sandpit preserve registers on evoker", async () => {
  resetMemory();

  const lines = [
    "subj name inspector be ceremony def",
    "subj name seen-tloh obj this tloh be number ya",
    "subj name seen-until obj this until be number ya",
    "this ret",
    "subj name inspector be ceremony prah",
    "to name sink tloh num 2 until num 2 be inspector do",
  ];

  for (const line of lines) {
    await run(line);
  }

  const result = getMemory("result");
  const sandpit = dumpSandpits().at(-1);
  const evoker = sandpit?.[0];
  const seenTloh = sandpit ? [...sandpit].reverse().find(s => s.subj?.name === "seen-tloh") : null;
  const seenUntil = sandpit ? [...sandpit].reverse().find(s => s.subj?.name === "seen-until") : null;

  assert.ok(evoker, "evoker should be recorded first in sandpit");
  assert.equal(evoker.tloh?.num ?? evoker.tloh, 2, "evoker tloh should remain at initial value when until matches");
  assert.equal(evoker.until?.num ?? evoker.until, 2);

  assert.equal(seenTloh?.obj?.num ?? seenTloh?.obj, 2, "this tloh should bind into seen tloh");
  assert.equal(seenUntil?.obj?.num ?? seenUntil?.obj, 2, "this until should bind into seen until");

  assert.ok(result, "result fact should be present");

  assert.equal(getMemory("tloh"), undefined, "no standalone tloh fact");
  assert.equal(getMemory("until"), undefined, "no standalone until fact");
});
