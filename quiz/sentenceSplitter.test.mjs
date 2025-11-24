import test from "node:test";
import assert from "node:assert/strict";

import { splitSentences } from "../program/library/sentenceSplitter.mjs";

test("splits combined input on unquoted moods", () => {
  const input = "subj name a be number ya obj num 2 to name a be add do subj name a obj what que";
  const sentences = splitSentences(input);

  assert.deepEqual(sentences, [
    "subj name a be number ya",
    "obj num 2 to name a be add do",
    "subj name a obj what que"
  ]);
});

test("does not split on moods inside quotes", () => {
  const input = 'subj name memo obj text "say ya do later" be topic ya subj name next be topic ya';
  const sentences = splitSentences(input);

  assert.deepEqual(sentences, [
    'subj name memo obj text "say ya do later" be topic ya',
    "subj name next be topic ya"
  ]);
});

test("splits multi-line paste blocks on moods and preserves commands without moods", () => {
  const input = [
    "subj name a be number ya",
    "obj num 2 to name a be add do",
    "mem"
  ].join("\n");

  const sentences = splitSentences(input);

  assert.deepEqual(sentences, [
    "subj name a be number ya",
    "obj num 2 to name a be add do",
    "mem"
  ]);
});
