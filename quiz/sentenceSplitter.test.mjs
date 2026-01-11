import test from "node:test";
import assert from "node:assert/strict";

import { splitSentences } from "../program/library/sentenceSplitter.mjs";

test("splits combined input on unquoted moods", () => {
  const input = "su name a be number ya ob num 2 to name a be plus do su name a ob what que";
  const sentences = splitSentences(input);

  assert.deepEqual(sentences, [
    "su name a be number ya",
    "ob num 2 to name a be plus do",
    "su name a ob what que"
  ]);
});

test("splits on can mood", () => {
  const input = "su name tools be map def su name add num be plus ob num 1 to name num can prah";
  const sentences = splitSentences(input);

  assert.deepEqual(sentences, [
    "su name tools be map def",
    "su name add num be plus ob num 1 to name num can",
    "prah"
  ]);
});

test("does not split on moods inside quotes", () => {
  const input = 'su name memo ob text "say ya do later" be topic ya su name next be topic ya';
  const sentences = splitSentences(input);

  assert.deepEqual(sentences, [
    'su name memo ob text "say ya do later" be topic ya',
    "su name next be topic ya"
  ]);
});

test("splits multi-line paste blocks on moods and preserves commands without moods", () => {
  const input = [
    "su name a be number ya",
    "ob num 2 to name a be plus do",
    "mem"
  ].join("\n");

  const sentences = splitSentences(input);

  assert.deepEqual(sentences, [
    "su name a be number ya",
    "ob num 2 to name a be plus do",
    "mem"
  ]);
});
