import test from "node:test";
import assert from "node:assert/strict";

import {
  LETTER_QUOTE_WORD,
  NUMBER_QUOTE_WORD,
  PARAGRAPH_LETTER_QUOTE_WORD,
  FIXED16_QUOTE_WORD,
  fixed16NumeratorQuoteWords,
  fixed16NumeratorFromBase6,
  fixed16QuoteWords,
  fixed16QuoteWordsFromBase6,
  quoteWordFor,
  QuoteEncodingError,
  decodeQuoteHeader,
  decodeQuote,
  decodeQuoteWord,
  lookupLegacyWord,
  renderLegacyNumericPlusCodelet
} from "../program/library/vliw/quotes.mjs";
import { decodeNumericPlusCodelet } from "../program/library/vliw/plus.mjs";
import { decodeLegacyCodelet, decodeLegacyCodeletSequence } from "../program/library/vliw/codelets.mjs";
import { QUOTED_GRAMMAR_WORD } from "../program/library/vliw/quotes.mjs";

function paragraphQuote(text) {
  return [
    PARAGRAPH_LETTER_QUOTE_WORD,
    text.length,
    ...Array.from({ length: text.length }, (_, index) => text.charCodeAt(index))
  ];
}

function indexedVectors(words) {
  const chunks = [];
  for (let offset = 0; offset < words.length; offset += 15) {
    chunks.push(words.slice(offset, offset + 15));
  }
  return chunks.map((chunk, index) => {
    const vector = new Uint16Array(16);
    vector[0] = index === chunks.length - 1 ? 1 : (index === 0 ? 2 : 0);
    vector.set(chunk, 1);
    return vector;
  });
}

function taggedQuoteWords({ tag = "pyash", payload = "body", optional = [] } = {}) {
  const tagWords = paragraphQuote(tag);
  return [
    QUOTED_GRAMMAR_WORD, 0, ...tagWords, ...optional, 0,
    ...paragraphQuote(payload), 0, ...tagWords, 0, QUOTED_GRAMMAR_WORD
  ];
}

const onePlusOneWords = [
  0x0149, 0x881d, 0x0001, 0x245e, 0x881d, 0x0001, 0x243e, 0x8a64,
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
  assert.equal(QUOTED_GRAMMAR_WORD, 0x229e);
  assert.equal(decodeQuoteHeader(0xee1d).sortName, "function");
  assert.equal(errorCode(() => decodeQuoteWord(0xee1d)), "unknown-quote");
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
    lengthWord: undefined,
    nextOffset: 2
  });
});

test("legacy float quote carries one finite f32 scalar", () => {
  const header = quoteWordFor({ sort: 6, scalarBytes: 4 });
  assert.equal(header, 0xd01d);
  const bits = new DataView(new ArrayBuffer(4));
  bits.setFloat32(0, 1.25, true);
  const encoded = bits.getUint32(0, true);
  const quote = decodeQuote([header, encoded & 0xffff, encoded >>> 16]);
  assert.equal(quote.family, "float32");
  assert.equal(quote.value, 1.25);
  assert.deepEqual(quote.payload, [0, 0x3fa0]);
  assert.throws(
    () => decodeQuote([header, 0, 0x7f80]),
    (error) => error.code === "non-finite-float"
  );
  assert.equal(quoteWordFor({ sort: 6, scalarBytes: 2 }), FIXED16_QUOTE_WORD);
  assert.equal(quoteWordFor({ sort: 6, scalarBytes: 4, vectorThick: 1 }), 0xd11d);
});

test("fixed16 is a compact typed quote using the legacy float sort and u16 scalar", () => {
  assert.equal(FIXED16_QUOTE_WORD, 0xc81d);
  assert.deepEqual(fixed16QuoteWords(0.5), [FIXED16_QUOTE_WORD, 23_328]);
  assert.deepEqual(fixed16NumeratorQuoteWords(65_535), [FIXED16_QUOTE_WORD, 65_535]);
  assert.deepEqual(decodeQuote([FIXED16_QUOTE_WORD, 23_328]), {
    word: FIXED16_QUOTE_WORD,
    family: "fixed16",
    payloadWords: 1,
    valueType: "fixed16",
    supported: true,
    payload: [23_328],
    value: 0.5,
    numerator: 23_328,
    denominator: 46_656,
    lengthWord: undefined,
    nextOffset: 2
  });
  assert.throws(() => fixed16QuoteWords(-1), (error) => error.code === "fixed16-range");
  assert.throws(() => fixed16NumeratorQuoteWords(65_536), (error) => error.code === "fixed16-range");
});

test("fixed16 converts base-6 source numbers against its 1,000,000 base-6 scale", () => {
  assert.equal(fixed16NumeratorFromBase6("0.1"), 7_776);
  assert.equal(fixed16NumeratorFromBase6("0.3"), 23_328);
  assert.equal(fixed16NumeratorFromBase6("1.000000"), 46_656);
  assert.deepEqual(fixed16QuoteWordsFromBase6("0.3"), [FIXED16_QUOTE_WORD, 23_328]);
  assert.throws(() => fixed16NumeratorFromBase6("0.6"), (error) => error.code === "fixed16-base6");
  assert.throws(() => fixed16NumeratorFromBase6("1000000"), (error) => error.code === "fixed16-range");
});

test("quote headers expose legacy width, region, sequence, and sort fields", () => {
  const numberHeader = decodeQuoteHeader(NUMBER_QUOTE_WORD);
  assert.equal(numberHeader.region, "literal");
  assert.equal(numberHeader.sequence, false);
  assert.equal(numberHeader.vectorWords, 1);
  assert.equal(numberHeader.scalarBytes, 2);
  assert.equal(numberHeader.sortName, "uint");

  const paragraphHeader = decodeQuoteHeader(PARAGRAPH_LETTER_QUOTE_WORD);
  assert.equal(paragraphHeader.sortName, "letter");
  assert.equal(paragraphHeader.explicitVectorLength, true);
  assert.equal(paragraphHeader.vectorWords, null);
});

test("letter and paragraph-letter quotes decode their character payloads", () => {
  assert.deepEqual(decodeQuote([LETTER_QUOTE_WORD, 0x0062]), {
    word: LETTER_QUOTE_WORD,
    family: "letter",
    payloadWords: 1,
    valueType: "letter",
    supported: true,
    payload: [0x0062],
    value: "b",
    lengthWord: undefined,
    nextOffset: 2
  });
  const paragraph = decodeQuote([
    PARAGRAPH_LETTER_QUOTE_WORD, 3, 0x0054, 0x0068, 0x0069
  ]);
  assert.equal(paragraph.payloadWords, 3);
  assert.equal(paragraph.lengthWord, 3);
  assert.equal(paragraph.value, "Thi");
  assert.equal(paragraph.nextOffset, 5);
});

test("tagged quote frames parse kind and payload by their typed lengths", () => {
  const frame = decodeLegacyCodeletSequence(indexedVectors(taggedQuoteWords({
    tag: "py\u0000ash",
    payload: "body"
  })));
  const item = frame.items.find(({ kind }) => kind === "tagged-quote");

  assert.equal(item.tag, "py\u0000ash");
  assert.equal(item.quote.value, "body");
  assert.equal(item.payloadLength, undefined);
  assert.deepEqual(item.tagWords, paragraphQuote("py\u0000ash"));
});

test("tagged quote frames accept optional length and variable-length hash quotes", () => {
  const payload = "payload body";
  const lengthOnly = decodeLegacyCodeletSequence(indexedVectors(taggedQuoteWords({
    payload,
    optional: [NUMBER_QUOTE_WORD, payload.length]
  })));
  const lengthOnlyFrame = lengthOnly.items.find(({ kind }) => kind === "tagged-quote");
  assert.equal(lengthOnlyFrame.payloadLength, payload.length);
  assert.equal(lengthOnlyFrame.hashQuote, undefined);

  for (const hash of ["sum", "long-digest"]) {
    const frame = decodeLegacyCodeletSequence(indexedVectors(taggedQuoteWords({
      payload,
      optional: [NUMBER_QUOTE_WORD, payload.length, ...paragraphQuote(hash)]
    })));
    const item = frame.items.find(({ kind }) => kind === "tagged-quote");

    assert.equal(item.payloadLength, payload.length);
    assert.equal(item.hashQuote.value, hash);
    assert.equal(item.quote.value, payload);
  }
});

test("tagged quote frames reject a mismatched closing tag and hash without length", () => {
  const mismatched = taggedQuoteWords();
  const closeTagCharacter = mismatched.lastIndexOf(0x0079);
  mismatched[closeTagCharacter] = 0x0078;
  assert.throws(
    () => decodeLegacyCodeletSequence(indexedVectors(mismatched)),
    (error) => error.code === "mismatched-quote-frame"
  );

  assert.throws(
    () => decodeLegacyCodeletSequence(indexedVectors(taggedQuoteWords({
      optional: paragraphQuote("hash")
    }))),
    (error) => error.code === "invalid-quote-frame"
  );

  assert.throws(
    () => decodeLegacyCodeletSequence(indexedVectors(taggedQuoteWords({
      optional: [NUMBER_QUOTE_WORD, 5]
    }))),
    (error) => error.code === "invalid-quote-frame"
  );
});

test("zi followed by zero padding remains an ordinary delimiter word", () => {
  const words = new Uint16Array(16);
  words[0] = QUOTED_GRAMMAR_WORD;
  assert.equal(decodeLegacyCodelet(words).items[0].word, QUOTED_GRAMMAR_WORD);
});

test("fixed-width legacy vector quotes decode without promoting sentence semantics", () => {
  const numberVector = decodeQuote([0x891d, 7, 9], 0);
  assert.equal(numberVector.valueType, "uint16-vector");
  assert.equal(numberVector.payloadWords, 2);
  assert.deepEqual(numberVector.value, [7, 9]);

  const letterVector = decodeQuote([0x091d, 0x0061, 0x0062], 0);
  assert.equal(letterVector.valueType, "letter-vector");
  assert.equal(letterVector.value, "ab");
});

test("legacy HNUC lookup returns Pyash spellings", () => {
  assert.equal(lookupLegacyWord(0x287e)?.pya, "yu");
  assert.equal(lookupLegacyWord(0x245e)?.pya, "ka");
  assert.equal(lookupLegacyWord(0x8a64)?.pya, "plus");
  assert.equal(lookupLegacyWord(0x295e)?.pya, "tu");
  assert.equal(lookupLegacyWord(0x0149), null);
});

test("legacy numeric plus renders each Pyash case HNUC", () => {
  assert.equal(renderLegacyNumericPlusCodelet(onePlusOneWords), "hyikdoka hyikdoma plustu");
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
  assert.equal(
    errorCode(() => decodeQuote([PARAGRAPH_LETTER_QUOTE_WORD], 0)),
    "truncated-quote"
  );
  assert.equal(errorCode(() => renderLegacyNumericPlusCodelet(onePlusOneWords.slice(0, -1))), "invalid-codelet");
});

test("legacy surface rendering reports its supported number range", () => {
  const words = [...onePlusOneWords];
  words[2] = 21;
  assert.equal(errorCode(() => renderLegacyNumericPlusCodelet(words)), "surface-range");
});
