import {
  CODELET_WORD_COUNT,
  decodeLegacyCodelet,
  VliwCodeletError
} from "./codelets.mjs";
import { NUMBER_QUOTE_WORD } from "./quotes.mjs";
import { VliwEncodingError } from "./plus.mjs";

// The legacy invert codelet carries the value in the accusative phrase and
// the bound it is inverted about in the dative phrase:
//
//   0149 881D 3333 245E  EA30 225E 207E  AAD2 295E
//   head  num  val  acc   number name  dat   invert mood
//
// The legacy computes `not value + bound`. Pyash inverts a number by
// negating it, so the bound is fixed at zero and the legacy phrase shape is
// kept. A codelet whose dative phrase names a bound instead of carrying the
// literal zero is the legacy's own form; Pyash has no verb for it, so the
// decoder rejects it rather than inventing a meaning.
const HEAD_WORD = 0x0149;
const ACCUSATIVE_CASE_WORD = 0x245e;
const DATIVE_CASE_WORD = 0x207e;
const INVERT_WORD = 0xaad2;
const DEONTIC_MOOD_WORD = 0x295e;
const INVERT_BOUND = 0;

export const NUMERIC_INVERT_USED_WORD_COUNT = 9;
export const numericInvertCompatibility = Object.freeze({
  head: HEAD_WORD,
  numberQuote: NUMBER_QUOTE_WORD,
  accusativeCase: ACCUSATIVE_CASE_WORD,
  dativeCase: DATIVE_CASE_WORD,
  invert: INVERT_WORD,
  deonticMood: DEONTIC_MOOD_WORD,
  bound: INVERT_BOUND
});

function encodingError(code, message, details = {}) {
  return new VliwEncodingError(code, message, details);
}

function wordsToBytes(words) {
  const bytes = new Uint8Array(words.byteLength);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < words.length; index += 1) {
    view.setUint16(index * 2, words[index], true);
  }
  return bytes;
}

function readNumber(value, role) {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff) {
    throw encodingError("numeric-range", `numeric invert ${role} must be an unsigned 16-bit integer`, {
      role,
      value
    });
  }
  return value;
}

export function normalizeNumericInvertSentence(sentence) {
  if (!sentence || typeof sentence !== "object") {
    throw encodingError("unsupported-sentence", "numeric invert requires a sentence object");
  }
  if (sentence.mood !== "do" || sentence.be !== "invert") {
    throw encodingError("unsupported-sentence", "numeric invert requires mood do and verb invert", {
      mood: sentence.mood,
      be: sentence.be
    });
  }
  if (!sentence.ob || typeof sentence.ob !== "object") {
    throw encodingError("unsupported-sentence", "numeric invert requires an ob operand");
  }
  const keys = Object.keys(sentence.ob).sort();
  if (keys.length !== 1 || keys[0] !== "num") {
    throw encodingError("unsupported-sentence", "numeric invert ob operand has an unsupported shape", {
      keys
    });
  }
  return {
    mood: "do",
    be: "invert",
    ob: { num: readNumber(sentence.ob.num, "ob operand") }
  };
}

export function isNumericInvertSentence(sentence) {
  return sentence?.mood === "do" && sentence?.be === "invert";
}

function decodeLegacy(input) {
  try {
    return decodeLegacyCodelet(input);
  } catch (error) {
    if (error instanceof VliwCodeletError) {
      throw encodingError("malformed-codelet", error.message, {
        cause: error.code,
        details: error.details
      });
    }
    throw error;
  }
}

function markerAt(decoded, offset, expected, role) {
  const item = decoded.items.find((candidate) => candidate.offset === offset);
  if (item?.kind !== "word" || item.word !== expected) {
    throw encodingError("malformed-codelet", `numeric invert codelet has an invalid ${role}`, {
      offset,
      expected,
      actual: item?.word
    });
  }
}

function decodeNumberQuote(decoded, offset, role) {
  const item = decoded.items.find((candidate) => candidate.offset === offset);
  if (item?.kind !== "quote" || item.quote.word !== NUMBER_QUOTE_WORD) {
    if (item?.kind === "word") {
      throw encodingError("unsupported-sentence", `numeric invert ${role} names a bound Pyash does not invert about`, {
        offset,
        actual: item.word
      });
    }
    throw encodingError("malformed-codelet", `numeric invert codelet has an invalid ${role} quote`, {
      offset,
      actual: item?.quote?.word ?? item?.word
    });
  }
  if (item.quote.nextOffset !== offset + 2) {
    throw encodingError("malformed-codelet", `numeric invert ${role} quote has an invalid boundary`, {
      offset,
      nextOffset: item.quote.nextOffset
    });
  }
  return item.quote.value;
}

export function lowerNumericInvertSentence(sentence) {
  const normalized = normalizeNumericInvertSentence(sentence);
  const words = new Uint16Array(CODELET_WORD_COUNT);
  words.set([
    HEAD_WORD,
    NUMBER_QUOTE_WORD,
    normalized.ob.num,
    ACCUSATIVE_CASE_WORD,
    NUMBER_QUOTE_WORD,
    INVERT_BOUND,
    DATIVE_CASE_WORD,
    INVERT_WORD,
    DEONTIC_MOOD_WORD
  ]);
  return {
    sentence: normalized,
    words,
    bytes: wordsToBytes(words),
    usedWords: NUMERIC_INVERT_USED_WORD_COUNT
  };
}

export function decodeNumericInvertCodelet(input) {
  const decoded = decodeLegacy(input);
  if (decoded.usedWords !== NUMERIC_INVERT_USED_WORD_COUNT) {
    throw encodingError("malformed-codelet", "numeric invert codelet has an invalid used-word boundary", {
      expected: NUMERIC_INVERT_USED_WORD_COUNT,
      actual: decoded.usedWords
    });
  }
  markerAt(decoded, 0, HEAD_WORD, "head");
  markerAt(decoded, 3, ACCUSATIVE_CASE_WORD, "accusative case");
  markerAt(decoded, 6, DATIVE_CASE_WORD, "dative case");
  markerAt(decoded, 7, INVERT_WORD, "invert verb");
  markerAt(decoded, 8, DEONTIC_MOOD_WORD, "deontic mood");
  const value = decodeNumberQuote(decoded, 1, "value");
  const bound = decodeNumberQuote(decoded, 4, "bound");
  if (bound !== INVERT_BOUND) {
    throw encodingError("unsupported-sentence", "numeric invert only supports a zero bound", {
      bound
    });
  }
  return {
    mood: "do",
    be: "invert",
    ob: { num: value }
  };
}

export async function executeNumericInvertCodelet(input) {
  const sentence = decodeNumericInvertCodelet(input);
  return {
    su: { name: "result" },
    ob: { num: -sentence.ob.num },
    be: "number",
    mood: "ya"
  };
}
