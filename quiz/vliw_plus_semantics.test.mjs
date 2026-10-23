import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, remember } from "../program/remember/index.mjs";
import {
  CODELET_WORD_COUNT,
  NUMERIC_PLUS_USED_WORD_COUNT,
  VliwEncodingError,
  decodeNumericPlusCodelet,
  executeNumericPlusCodelet,
  lowerNumericPlusSentence
} from "../program/library/vliw/plus.mjs";

const onePlusOneWords = [
  0x0149, 0x881d, 0x0001, 0x287e, 0x881d, 0x0001, 0x245e, 0x8a64,
  0x295e, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000
];

function errorCode(action) {
  try {
    action();
  } catch (error) {
    assert.ok(error instanceof VliwEncodingError);
    return error.code;
  }
  assert.fail("expected VliwEncodingError");
  return undefined;
}

test("numeric plus lowers the current Pyash sentence to the legacy codelet", () => {
  const sentence = parse("ob num 1 to num 1 be plus do");
  const lowered = lowerNumericPlusSentence(sentence);

  assert.deepEqual(Array.from(lowered.words), onePlusOneWords);
  assert.equal(lowered.usedWords, NUMERIC_PLUS_USED_WORD_COUNT);
  assert.equal(lowered.words.length, CODELET_WORD_COUNT);
  assert.deepEqual(
    Array.from(lowered.bytes),
    onePlusOneWords.flatMap((word) => [word & 0xff, word >> 8])
  );
});

test("numeric plus lowering is deterministic for supported operands", () => {
  const sentence = parse("ob num 42 to num 5 be plus do");
  const first = lowerNumericPlusSentence(sentence);
  const second = lowerNumericPlusSentence(sentence);

  assert.deepEqual(Array.from(first.words), Array.from(second.words));
  assert.deepEqual(Array.from(first.bytes), Array.from(second.bytes));
  assert.deepEqual(decodeNumericPlusCodelet(first.words), {
    mood: "do",
    ob: { num: 42 },
    to: { num: 5 },
    be: "plus"
  });
});

test("decoded numeric plus executes with the existing interpreter result shape", async () => {
  const sentence = parse("ob num 42 to num 5 be plus do");
  const lowered = lowerNumericPlusSentence(sentence);
  const backendResult = await executeNumericPlusCodelet(lowered.words);

  forget();
  const interpretedValue = await interpret(sentence);
  const interpretedRecord = remember("result");

  assert.equal(interpretedValue.value, 47);
  assert.deepEqual(backendResult, interpretedRecord);
});

test("numeric plus rejects unsupported sentence shapes and values", () => {
  assert.equal(errorCode(() => lowerNumericPlusSentence(parse("ob text x to num 1 be plus do"))), "numeric-range");
  assert.equal(errorCode(() => lowerNumericPlusSentence(parse("ob num 1 to num 1 be subtract do"))), "unsupported-sentence");
  assert.equal(errorCode(() => lowerNumericPlusSentence({ mood: "ya", ob: { num: 1 }, to: { num: 1 }, be: "plus" })), "unsupported-sentence");
  assert.equal(errorCode(() => lowerNumericPlusSentence({ mood: "do", ob: { num: 1 }, to: { num: 1 }, be: "plus", from: { num: 2 } })), "unsupported-sentence");
  assert.equal(errorCode(() => lowerNumericPlusSentence({ mood: "do", ob: { num: -1 }, to: { num: 1 }, be: "plus" })), "numeric-range");
  assert.equal(errorCode(() => lowerNumericPlusSentence({ mood: "do", ob: { num: 65536 }, to: { num: 1 }, be: "plus" })), "numeric-range");
});

test("numeric plus rejects malformed codelets", () => {
  assert.equal(errorCode(() => decodeNumericPlusCodelet(onePlusOneWords.slice(0, -1))), "malformed-codelet");

  const badMarker = [...onePlusOneWords];
  badMarker[7] = 0;
  assert.equal(errorCode(() => decodeNumericPlusCodelet(badMarker)), "malformed-codelet");

  const badTail = [...onePlusOneWords];
  badTail[15] = 1;
  assert.equal(errorCode(() => decodeNumericPlusCodelet(badTail)), "malformed-codelet");
});
