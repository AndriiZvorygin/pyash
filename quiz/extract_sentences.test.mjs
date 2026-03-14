import test from "node:test";
import assert from "node:assert/strict";

import { extractSentences } from "../command/extract_sentences.mjs";

test("extract sentences strips source prefixes and splits prose into sentence lines", () => {
  const input = [
    "2007/0812.txt:Nothing is ever old to those who are awake to love. Everything is new now.",
    "2019/0119.txt:Thus, the wanderer may choose to create this armor of light out of the light of the One Infinite Creator."
  ].join("\n");
  const output = extractSentences(input).split("\n");
  assert.deepEqual(output, [
    "Nothing is ever old to those who are awake to love.",
    "Everything is new now.",
    "Thus, the wanderer may choose to create this armor of light out of the light of the One Infinite Creator."
  ]);
});

test("extract sentences removes footnote blocks", () => {
  const input = "[footnote start]Questioner: Hi.[footnote end] Armor of light shines.";
  assert.equal(extractSentences(input), "Armor of light shines.");
});
