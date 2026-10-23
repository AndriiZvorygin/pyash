import test from "node:test";
import assert from "node:assert/strict";

import {
  CODELET_WORD_COUNT,
  decodeLegacyCodelet,
  decodeLegacyCodeletSequence,
  renderLegacyCodelet,
  VliwCodeletError
} from "../program/library/vliw/codelets.mjs";
import {
  LETTER_QUOTE_WORD,
  NUMBER_QUOTE_WORD,
  PARAGRAPH_LETTER_QUOTE_WORD
} from "../program/library/vliw/quotes.mjs";

const onePlusOneWords = [
  0x0149, 0x881d, 0x0001, 0x287e, 0x881d, 0x0001, 0x245e, 0x8a64,
  0x295e, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000
];

const legacyContinuationFixture = [
  [
    0xb6b6, 0x881d, 0x0001, 0x4127, 0x881d, 0x0003, 0x245e, 0x69b3,
    0x29be, 0x881d, 0x0001, 0x245e, 0x881d, 0x0003, 0x287e, 0x8a64
  ],
  [0x0003, 0x295e, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
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

test("generic rendering exposes a lossless diagnostic Pyash-like surface", () => {
  assert.equal(
    renderLegacyCodelet(onePlusOneWords),
    "0x0149 num 1 yu num 1 ka plus tu"
  );
});

test("generic codelets retain letter and paragraph quote boundaries", () => {
  const letterWords = [0x0149, LETTER_QUOTE_WORD, 0x0041, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const paragraphWords = new Array(CODELET_WORD_COUNT).fill(0);
  paragraphWords.splice(0, 5, 0x0149, PARAGRAPH_LETTER_QUOTE_WORD, 2, 0x0041, 0x0042);

  assert.equal(decodeLegacyCodelet(letterWords).items[1].quote.value, "A");
  assert.equal(decodeLegacyCodelet(paragraphWords).items[1].quote.nextOffset, 5);
  const quote = String.fromCharCode(34);
  assert.equal(renderLegacyCodelet(letterWords), `0x0149 letter ${quote}A${quote}`);
  assert.equal(renderLegacyCodelet(paragraphWords), `0x0149 text ${quote}AB${quote}`);
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
  unsupported[1] = 0x001d;
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

test("continuation decoding preserves the legacy two-vector fixture", () => {
  const decoded = decodeLegacyCodeletSequence(legacyContinuationFixture);

  assert.equal(decoded.vectorCount, 2);
  assert.equal(decoded.continued, true);
  assert.equal(decoded.complete, true);
  assert.deepEqual(decoded.indexWords, [0xb6b6, 0x0003]);
  assert.equal(decoded.words.length, 31);
  assert.equal(decoded.items.at(-1).word, 0x295e);
});

test("continuation decoding rejects missing and trailing vectors", () => {
  const partial = legacyContinuationFixture.map((vector) => [...vector]);
  partial[1][0] = 0x0002;
  assert.equal(errorCode(() => decodeLegacyCodeletSequence(partial)), "missing-continuation");

  const trailing = [...legacyContinuationFixture, new Array(CODELET_WORD_COUNT).fill(0)];
  assert.equal(errorCode(() => decodeLegacyCodeletSequence(trailing)), "trailing-continuation");
});
