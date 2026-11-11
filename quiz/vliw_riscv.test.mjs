import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import {
  decodeCodelet,
  executeCodelets,
  lowerSentence
} from "../program/library/vliw/index.mjs";

// The RISC-V destination compiles this codelet. The bytes are the shared
// fixture: the interpreter runs them, the Rust backend compiles them, and the
// two implementations have to agree on the result.
const GOLDEN_WORDS = [
  0x0149, 0x881d, 0x0001, 0x287e, 0x881d, 0x0001, 0x245e, 0x8a64, 0x295e
];

test("the golden numeric plus lowers to the bytes the RISC-V backend compiles", () => {
  const sentence = parse("ob num 1 to num 1 be plus do");
  const [codelet] = lowerSentence(sentence);

  assert.deepEqual(Array.from(codelet.words.slice(0, codelet.usedWords)), GOLDEN_WORDS);
  assert.deepEqual(decodeCodelet(codelet.words).sentence, sentence);
});

test("the interpreter computes the result the compiled RISC-V program computes", async () => {
  const sentence = parse("ob num 1 to num 1 be plus do");
  const [codelet] = lowerSentence(sentence);
  const outcomes = await executeCodelets([codelet]);

  assert.equal(outcomes.length, 1);
  assert.equal(outcomes[0].ob.num, 2);
});
