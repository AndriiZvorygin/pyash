import test from "node:test";
import assert from "node:assert/strict";

import {
  CODELET_WORD_COUNT,
  decodeLegacyCodelet,
  VliwCodeletError
} from "../program/library/vliw/codelets.mjs";
import { LETTER_QUOTE_WORD, NUMBER_QUOTE_WORD } from "../program/library/vliw/quotes.mjs";

const onePlusOneWords = [
  0x0149, 0x881d, 0x0001, 0x287e, 0x881d, 0x0001, 0x245e, 0x8a64,
  0x295e, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000
];

function errorCode(action) {
  try {
    action();
  } catch (error) {
    assert.ok(error instanceof VliwCodeletError);
    return error.code;
  }
  assert.fail("expected VliwCodeletError");
}

test("generic codelet decoding preserves words, quotes, and lexical lookup", () => {
  const decoded = decodeLegacyCodelet(onePlusOneWords);

  assert.equal(decoded.words.length, CODELET_WORD_COUNT);
  assert.equal(decoded.usedWords, 9);
  assert.equal(decoded.items.length, 7);
  assert.deepEqual(decoded.items.map(({ kind, offset }) => ({ kind, offset })), [
    { kind: "word", offset: 0 },
    { kind: "quote", offset: 1 },
    { kind: "word", offset: 3 },
    { kind: "quote", offset: 4 },
    { kind: "word", offset: 6 },
    { kind: "word", offset: 7 },
    { kind: "word", offset: 8 }
  ]);
  assert.equal(decoded.items[0].entry, null);
  assert.equal(decoded.items[2].entry.pya, "yu");
  assert.equal(decoded.items[5].entry.pya, "plus");
  assert.deepEqual(decoded.items[1].quote.payload, [1]);
  assert.equal(decoded.items[1].quote.value, 1);
  assert.equal(decoded.items[3].quote.nextOffset, 6);
});

test("generic decoding keeps zero-valued quote payloads inside the used prefix", () => {
  const words = [...onePlusOneWords];
  words[2] = 0;

  const decoded = decodeLegacyCodelet(words);

  assert.equal(decoded.usedWords, 9);
  assert.equal(decoded.items[1].quote.value, 0);
});

test("generic decoding preserves unknown words without inventing lexical meaning", () => {
  const words = [...onePlusOneWords];
  words[3] = 0x0001;

  const decoded = decodeLegacyCodelet(words);

  assert.equal(decoded.items[2].word, 0x0001);
  assert.equal(decoded.items[2].entry, null);
});

test("generic decoding rejects malformed quotes and nonzero padding", () => {
  const truncated = new Array(CODELET_WORD_COUNT).fill(1);
  truncated[CODELET_WORD_COUNT - 1] = NUMBER_QUOTE_WORD;
  assert.equal(errorCode(() => decodeLegacyCodelet(truncated)), "malformed-quote");

  const unsupported = [...onePlusOneWords];
  unsupported[1] = LETTER_QUOTE_WORD;
  assert.equal(errorCode(() => decodeLegacyCodelet(unsupported)), "malformed-quote");

  const nonzeroTail = [...onePlusOneWords];
  nonzeroTail[15] = 1;
  assert.equal(errorCode(() => decodeLegacyCodelet(nonzeroTail)), "nonzero-tail");
});

test("generic decoding rejects invalid codelet shape and word values", () => {
  assert.equal(errorCode(() => decodeLegacyCodelet(onePlusOneWords.slice(0, -1))), "invalid-codelet");
  const invalidWord = [...onePlusOneWords];
  invalidWord[0] = -1;
  assert.equal(errorCode(() => decodeLegacyCodelet(invalidWord)), "invalid-word");
});
