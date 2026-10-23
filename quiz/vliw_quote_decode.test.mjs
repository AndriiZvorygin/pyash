import test from "node:test";
import assert from "node:assert/strict";

import {
  LETTER_QUOTE_WORD,
  NUMBER_QUOTE_WORD,
  PARAGRAPH_LETTER_QUOTE_WORD,
  QuoteEncodingError,
  decodeQuote,
  decodeQuoteWord,
  lookupLegacyWord,
  renderLegacyNumericPlusCodelet
} from "../program/library/vliw/quotes.mjs";
import { decodeNumericPlusCodelet } from "../program/library/vliw/plus.mjs";

const onePlusOneWords = [
  0x0149, 0x881d, 0x0001, 0x287e, 0x881d, 0x0001, 0x245e, 0x8a64,
  0x295e, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000
];

function errorCode(action) {
  try {
    action();
  } catch (error) {
    assert.ok(error instanceof QuoteEncodingError);
    return error.code;
  }
  assert.fail("expected QuoteEncodingError");
}

test("quote descriptors identify legacy quote families", () => {
  assert.equal(decodeQuoteWord(0x001d).family, "quote-denote");
  assert.deepEqual(decodeQuoteWord(NUMBER_QUOTE_WORD), {
    word: NUMBER_QUOTE_WORD,
    family: "number",
    payloadWords: 1,
    valueType: "uint16",
    supported: true
  });
  assert.equal(decodeQuoteWord(LETTER_QUOTE_WORD).family, "letter");
  assert.equal(decodeQuoteWord(PARAGRAPH_LETTER_QUOTE_WORD).family, "paragraph-letter");
});

test("numeric quote decodes its typed payload", () => {
  assert.deepEqual(decodeQuote([NUMBER_QUOTE_WORD, 1], 0), {
    word: NUMBER_QUOTE_WORD,
    family: "number",
    payloadWords: 1,
    valueType: "uint16",
    supported: true,
    payload: [1],
    value: 1,
    nextOffset: 2
  });
});

test("legacy HNUC lookup returns Pyash spellings", () => {
  assert.equal(lookupLegacyWord(0x287e)?.pya, "yu");
  assert.equal(lookupLegacyWord(0x245e)?.pya, "ka");
  assert.equal(lookupLegacyWord(0x8a64)?.pya, "plus");
  assert.equal(lookupLegacyWord(0x295e)?.pya, "tu");
  assert.equal(lookupLegacyWord(0x0149), null);
});

test("legacy numeric plus renders the historical Pyash surface", () => {
  assert.equal(renderLegacyNumericPlusCodelet(onePlusOneWords), "hyikdoyu hyikdoka plustu");
  assert.deepEqual(decodeNumericPlusCodelet(onePlusOneWords), {
    mood: "do",
    ob: { num: 1 },
    to: { num: 1 },
    be: "plus"
  });
});

test("quote decoding rejects unsupported and malformed values", () => {
  assert.equal(errorCode(() => decodeQuoteWord(0x1234)), "not-quote");
  assert.equal(errorCode(() => decodeQuoteWord(0x041d)), "unknown-quote");
  assert.equal(errorCode(() => decodeQuote([NUMBER_QUOTE_WORD], 0)), "truncated-quote");
  assert.equal(errorCode(() => decodeQuote([LETTER_QUOTE_WORD, 1], 0)), "unsupported-quote");
  assert.equal(errorCode(() => renderLegacyNumericPlusCodelet(onePlusOneWords.slice(0, -1))), "invalid-codelet");
});

test("legacy surface rendering reports its supported number range", () => {
  const words = [...onePlusOneWords];
  words[2] = 21;
  assert.equal(errorCode(() => renderLegacyNumericPlusCodelet(words)), "surface-range");
});
