import { plus_obj_num_to_name_num } from "../../verbs/mathematics/plus.mjs";
import {
  LEGACY_NUMERIC_PLUS_WORDS,
  NUMBER_QUOTE_WORD,
  decodeQuote
} from "./quotes.mjs";

export const CODELET_WORD_COUNT = 16;
export const NUMERIC_PLUS_USED_WORD_COUNT = 9;

const HEAD_WORD = LEGACY_NUMERIC_PLUS_WORDS.head;
const INSTRUMENTAL_CASE_WORD = LEGACY_NUMERIC_PLUS_WORDS.instrumentalCase;
const ACCUSATIVE_CASE_WORD = LEGACY_NUMERIC_PLUS_WORDS.accusativeCase;
const PLUS_WORD = LEGACY_NUMERIC_PLUS_WORDS.plus;
const DEONTIC_MOOD_WORD = LEGACY_NUMERIC_PLUS_WORDS.deonticMood;

export const numericPlusCompatibility = Object.freeze({
  head: HEAD_WORD,
  numberQuote: NUMBER_QUOTE_WORD,
  instrumentalCase: INSTRUMENTAL_CASE_WORD,
  accusativeCase: ACCUSATIVE_CASE_WORD,
  plus: PLUS_WORD,
  deonticMood: DEONTIC_MOOD_WORD
});

export class VliwEncodingError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "VliwEncodingError";
    this.code = code;
    this.details = details;
  }
}

function encodingError(code, message, details) {
  return new VliwEncodingError(code, message, details);
}

function readNumericValue(value, role) {
  const number = value?.num;
  if (!Number.isInteger(number) || number < 0 || number > 0xffff) {
    throw encodingError(
      "numeric-range",
      `numeric-plus ${role} must be an unsigned 16-bit integer`,
      { role, value: number }
    );
  }
  return number;
}

export function normalizeNumericPlusSentence(sentence) {
  if (!sentence || typeof sentence !== "object") {
    throw encodingError("unsupported-sentence", "numeric-plus requires a sentence object");
  }

  const keys = Object.keys(sentence).sort();
  const expectedKeys = ["be", "mood", "ob", "to"];
  if (keys.length !== expectedKeys.length || keys.some((key, index) => key !== expectedKeys[index])) {
    throw encodingError("unsupported-sentence", "numeric-plus requires exactly mood, be, ob, and to", { keys });
  }
  if (sentence.mood !== "do" || sentence.be !== "plus") {
    throw encodingError("unsupported-sentence", "numeric-plus requires mood do and verb plus", {
      mood: sentence.mood,
      be: sentence.be
    });
  }

  return {
    mood: "do",
    ob: { num: readNumericValue(sentence.ob, "ob") },
    to: { num: readNumericValue(sentence.to, "to") },
    be: "plus"
  };
}

function wordsToBytes(words) {
  const bytes = new Uint8Array(words.byteLength);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < words.length; index += 1) {
    view.setUint16(index * 2, words[index], true);
  }
  return bytes;
}

function normalizeWords(words) {
  if (!(words instanceof Uint16Array) && !Array.isArray(words)) {
    throw encodingError("malformed-codelet", "numeric-plus codelet must be a 16-word array");
  }
  if (words.length !== CODELET_WORD_COUNT) {
    throw encodingError("malformed-codelet", "numeric-plus codelet must contain exactly 16 words", {
      length: words.length
    });
  }

  const values = Array.from(words);
  for (const [index, value] of values.entries()) {
    if (!Number.isInteger(value) || value < 0 || value > 0xffff) {
      throw encodingError("malformed-codelet", "numeric-plus codelet contains an invalid word", { index, value });
    }
  }
  return new Uint16Array(values);
}

function validateCodeletMarkers(words) {
  const markers = [
    [0, HEAD_WORD, "head"],
    [1, NUMBER_QUOTE_WORD, "first number quote"],
    [3, INSTRUMENTAL_CASE_WORD, "instrumental case"],
    [4, NUMBER_QUOTE_WORD, "second number quote"],
    [6, ACCUSATIVE_CASE_WORD, "accusative case"],
    [7, PLUS_WORD, "plus verb"],
    [8, DEONTIC_MOOD_WORD, "deontic mood"]
  ];
  for (const [index, expected, name] of markers) {
    if (words[index] !== expected) {
      throw encodingError("malformed-codelet", `numeric-plus codelet has an invalid ${name} word`, {
        index,
        expected,
        actual: words[index]
      });
    }
  }
  for (let index = NUMERIC_PLUS_USED_WORD_COUNT; index < CODELET_WORD_COUNT; index += 1) {
    if (words[index] !== 0) {
      throw encodingError("malformed-codelet", "numeric-plus codelet has a nonzero unassigned tail", {
        index,
        actual: words[index]
      });
    }
  }
}

export function lowerNumericPlusSentence(sentence) {
  const normalized = normalizeNumericPlusSentence(sentence);
  const words = new Uint16Array(CODELET_WORD_COUNT);
  words.set([
    HEAD_WORD,
    NUMBER_QUOTE_WORD,
    normalized.ob.num,
    INSTRUMENTAL_CASE_WORD,
    NUMBER_QUOTE_WORD,
    normalized.to.num,
    ACCUSATIVE_CASE_WORD,
    PLUS_WORD,
    DEONTIC_MOOD_WORD
  ]);
  return {
    sentence: normalized,
    words,
    bytes: wordsToBytes(words),
    usedWords: NUMERIC_PLUS_USED_WORD_COUNT
  };
}

export function decodeNumericPlusCodelet(input) {
  const words = normalizeWords(input);
  validateCodeletMarkers(words);
  let first;
  let second;
  try {
    first = decodeQuote(words, 1);
    second = decodeQuote(words, 4);
  } catch (error) {
    throw encodingError("malformed-codelet", error.message, {
      cause: error.code,
      details: error.details
    });
  }
  if (first.nextOffset !== 3 || second.nextOffset !== 6) {
    throw encodingError("malformed-codelet", "numeric-plus quote boundaries are invalid");
  }
  return {
    mood: "do",
    ob: { num: first.value },
    to: { num: second.value },
    be: "plus"
  };
}

export async function executeNumericPlusCodelet(input) {
  const sentence = decodeNumericPlusCodelet(input);
  const result = await plus_obj_num_to_name_num(sentence, { remember: undefined });
  return {
    su: { name: "result" },
    ob: result.be === "number" ? { num: result.ob } : result.ob,
    be: result.be,
    mood: "ya"
  };
}
