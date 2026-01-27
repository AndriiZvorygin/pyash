import test from "node:test";
import assert from "node:assert/strict";

import { splitSentences } from "../program/library/sentenceSplitter.mjs";

test("splitSentences splits on all moods when configured", () => {
  const text = [
    "su name a be topic ya",
    "su name b be topic def",
    "su name c be topic do",
    "su name d be topic que",
    "su name e be topic prah",
    "su name f be topic ret",
    "su name g be topic can",
    "ob num 1 be equally from num 1 then"
  ].join(" ");
  const out = splitSentences(text, { includeThen: true });
  assert.deepEqual(out, [
    "su name a be topic ya",
    "su name b be topic def",
    "su name c be topic do",
    "su name d be topic que",
    "su name e be topic prah",
    "su name f be topic ret",
    "su name g be topic can",
    "ob num 1 be equally from num 1 then"
  ]);
});
