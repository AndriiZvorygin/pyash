import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { getRefinery } from "../program/bridge/refinery.mjs";
import { forget } from "../program/remember/index.mjs";

async function runLines(lines) {
  for (const line of lines) {
    await interpret(parse(line));
  }
}

test("refinery resolves from name typed handle via producer to name contract", async () => {
  forget();
  await runLines([
    "su name flow be refinery def",
    "su name producer ob text \"alpha\" to name text payload be write do",
    "su name middle ob text \"noise\" be write do",
    "su name consumer from name text payload ob text \"ok\" be write do",
    "prah"
  ]);

  const refinery = getRefinery("flow");
  const consumer = refinery?.platforms?.get("consumer");
  assert.deepStrictEqual(consumer?.deps, ["producer"]);
});

test("refinery rejects from name typed handle when type mismatches producer contract", async () => {
  forget();
  await runLines([
    "su name flow be refinery def",
    "su name producer ob text \"alpha\" to name text payload be write do"
  ]);

  await assert.rejects(
    () => interpret(parse("su name consumer from name itinerary payload ob text \"ok\" be write do")),
    (err) => {
      const sentence = err?.sentence;
      return sentence?.su?.name === "depend defective"
        && /type mismatch/i.test(String(sentence?.ob?.text ?? ""));
    }
  );
});

test("refinery resolves mixed from ve dependencies (handle + platform) in declared order", async () => {
  forget();
  await runLines([
    "su name flow be refinery def",
    "su name producer ob text \"alpha\" to name text payload be write do",
    "su name middle ob text \"noise\" be write do",
    "su name consumer from ve name text payload name middle ob text \"ok\" be write do",
    "prah"
  ]);

  const refinery = getRefinery("flow");
  const consumer = refinery?.platforms?.get("consumer");
  assert.deepStrictEqual(consumer?.deps, ["producer", "middle"]);
  assert.deepStrictEqual(consumer?.actionSentence?.from, { name: "payload", nameTypeWords: ["text"] });
});

test("refinery rejects from ve typed handle when type mismatches producer contract", async () => {
  forget();
  await runLines([
    "su name flow be refinery def",
    "su name producer ob text \"alpha\" to name text payload be write do"
  ]);

  await assert.rejects(
    () => interpret(parse("su name consumer from ve name itinerary payload ob text \"ok\" be write do")),
    (err) => {
      const sentence = err?.sentence;
      return sentence?.su?.name === "depend defective"
        && /type mismatch/i.test(String(sentence?.ob?.text ?? ""));
    }
  );
});

test("refinery parses typed from ve dependencies with multi-word handles", async () => {
  forget();
  await runLines([
    "su name flow be refinery def",
    "su name cut platform ob text \"cuts\" to name itinerary teaching cuts be write do",
    "su name prompt stage ob text \"style\" to name text draw system prompt be write do",
    "su name draw platform from ve name itinerary teaching cuts name text draw system prompt ob text \"ok\" be write do",
    "prah"
  ]);

  const refinery = getRefinery("flow");
  const draw = refinery?.platforms?.get("draw platform");
  assert.deepStrictEqual(draw?.deps, ["cut platform", "prompt stage"]);
  assert.deepStrictEqual(draw?.actionSentence?.from, { name: "teaching cuts", nameTypeWords: ["itinerary"] });
});
