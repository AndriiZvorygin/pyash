import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import {
  decodeCodelet,
  executeCodelets,
  lowerParagraph,
  lowerSentence
} from "../program/library/vliw/index.mjs";
import { VliwCodeletError } from "../program/library/vliw/codelets.mjs";

test("VLIW facade lowers and executes a paragraph in source order", async () => {
  const paragraph = [
    parse("ob num 1 to num 1 be plus do"),
    parse("ob num 2 to num 3 be plus do")
  ];
  const codelets = lowerParagraph(paragraph);
  const results = await executeCodelets(codelets);

  assert.equal(codelets.length, 2);
  assert.deepEqual(results.map((result) => result.ob), [{ num: 2 }, { num: 5 }]);
  assert.deepEqual(decodeCodelet(codelets[1].words).sentence, paragraph[1]);
});

test("VLIW facade rejects unsupported semantic codelets after lossless decoding", () => {
  const words = Array(16).fill(0);
  words[0] = 0x0149;
  words[1] = 0x287e;

  assert.throws(
    () => decodeCodelet(words),
    (error) => error instanceof VliwCodeletError && error.code === "unsupported-codelet"
  );
});

test("VLIW facade preserves the numeric-plus lowering contract", () => {
  const codelets = lowerSentence(parse("ob num 4 to num 6 be plus do"));

  assert.equal(codelets.length, 1);
  assert.deepEqual(Array.from(codelets[0].words.slice(0, 3)), [0x0149, 0x881d, 4]);
  assert.equal(codelets[0].usedWords, 9);
});
