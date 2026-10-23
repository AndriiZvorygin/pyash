import {
  CODELET_WORD_COUNT,
  decodeLegacyCodelet,
  VliwCodeletError
} from "./codelets.mjs";
import { NUMBER_QUOTE_WORD } from "./quotes.mjs";
import { VliwEncodingError } from "./plus.mjs";

const HEAD_WORD = 0x0149;
const INSTRUMENTAL_CASE_WORD = 0x287e;
const ACCUSATIVE_CASE_WORD = 0x245e;
const DEONTIC_MOOD_WORD = 0x295e;

const OPERATOR_WORDS = Object.freeze({
  plus: 0x8a64,
  subtract: 0xabd2,
  multiply: 0xec90,
  divide: 0x8893,
  remains: 0xe82a,
  xor: 0xa810
});

const OPERATOR_BY_WORD = new Map(
  Object.entries(OPERATOR_WORDS).map(([name, word]) => [word, name])
);

export const NUMERIC_ARITHMETIC_USED_WORD_COUNT = 9;
export const numericArithmeticCompatibility = Object.freeze({
  head: HEAD_WORD,
  numberQuote: NUMBER_QUOTE_WORD,
  instrumentalCase: INSTRUMENTAL_CASE_WORD,
  accusativeCase: ACCUSATIVE_CASE_WORD,
  deonticMood: DEONTIC_MOOD_WORD,
  operators: OPERATOR_WORDS
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
    throw encodingError("numeric-range", `numeric ${role} must be an unsigned 16-bit integer`, {
      role,
      value
    });
  }
  return value;
}

function exactKeys(value, expected, role) {
  const keys = Object.keys(value).sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw encodingError("unsupported-sentence", `${role} has an unsupported shape`, {
      role,
      keys,
      expected
    });
  }
}

function operandRole(sentence) {
  const roles = ["to", "from", "with"].filter((role) => sentence[role] !== undefined);
  if (roles.length !== 1) {
    throw encodingError("unsupported-sentence", "numeric arithmetic requires one right operand", { roles });
  }
  return roles[0];
}

export function normalizeNumericArithmeticSentence(sentence) {
  if (!sentence || typeof sentence !== "object") {
    throw encodingError("unsupported-sentence", "numeric arithmetic requires a sentence object");
  }
  if (sentence.mood !== "do" || !Object.hasOwn(OPERATOR_WORDS, sentence.be)) {
    throw encodingError("unsupported-sentence", "numeric arithmetic requires a supported do verb", {
      mood: sentence.mood,
      be: sentence.be
    });
  }
  if (!sentence.ob || typeof sentence.ob !== "object") {
    throw encodingError("unsupported-sentence", "numeric arithmetic requires an ob operand");
  }
  const role = operandRole(sentence);
  exactKeys(sentence.ob, ["num"], "numeric arithmetic ob operand");
  exactKeys(sentence[role], ["num"], `numeric arithmetic ${role} operand`);
  const left = readNumber(sentence.ob.num, "left operand");
  const right = readNumber(sentence[role].num, "right operand");
  return {
    mood: "do",
    be: sentence.be,
    ob: { num: left },
    [role]: { num: right }
  };
}

export function isNumericArithmeticSentence(sentence) {
  return sentence?.mood === "do" && Object.hasOwn(OPERATOR_WORDS, sentence?.be);
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
    throw encodingError("malformed-codelet", `numeric arithmetic codelet has an invalid ${role}`, {
      offset,
      expected,
      actual: item?.word
    });
  }
}

function decodeNumberQuote(decoded, offset, role) {
  const item = decoded.items.find((candidate) => candidate.offset === offset);
  if (item?.kind !== "quote" || item.quote.word !== NUMBER_QUOTE_WORD) {
    throw encodingError("malformed-codelet", `numeric arithmetic codelet has an invalid ${role} quote`, {
      offset,
      actual: item?.quote?.word ?? item?.word
    });
  }
  if (item.quote.nextOffset !== offset + 2) {
    throw encodingError("malformed-codelet", `${role} quote has an invalid boundary`, {
      offset,
      nextOffset: item.quote.nextOffset
    });
  }
  return item.quote.value;
}

export function lowerNumericArithmeticSentence(sentence) {
  const normalized = normalizeNumericArithmeticSentence(sentence);
  const role = operandRole(normalized);
  const words = new Uint16Array(CODELET_WORD_COUNT);
  words.set([
    HEAD_WORD,
    NUMBER_QUOTE_WORD,
    normalized.ob.num,
    INSTRUMENTAL_CASE_WORD,
    NUMBER_QUOTE_WORD,
    normalized[role].num,
    ACCUSATIVE_CASE_WORD,
    OPERATOR_WORDS[normalized.be],
    DEONTIC_MOOD_WORD
  ]);
  return {
    sentence: normalized,
    words,
    bytes: wordsToBytes(words),
    usedWords: NUMERIC_ARITHMETIC_USED_WORD_COUNT
  };
}

export function decodeNumericArithmeticCodelet(input) {
  const decoded = decodeLegacy(input);
  if (decoded.usedWords !== NUMERIC_ARITHMETIC_USED_WORD_COUNT) {
    throw encodingError("malformed-codelet", "numeric arithmetic codelet has an invalid used-word boundary", {
      expected: NUMERIC_ARITHMETIC_USED_WORD_COUNT,
      actual: decoded.usedWords
    });
  }
  markerAt(decoded, 0, HEAD_WORD, "head");
  markerAt(decoded, 3, INSTRUMENTAL_CASE_WORD, "instrumental case");
  markerAt(decoded, 6, ACCUSATIVE_CASE_WORD, "accusative case");
  markerAt(decoded, 8, DEONTIC_MOOD_WORD, "deontic mood");
  const operatorItem = decoded.items.find((candidate) => candidate.offset === 7);
  const be = OPERATOR_BY_WORD.get(operatorItem?.word);
  if (!be) {
    throw encodingError("malformed-codelet", "numeric arithmetic codelet has an unsupported operator", {
      actual: operatorItem?.word
    });
  }
  const left = decodeNumberQuote(decoded, 1, "left operand");
  const right = decodeNumberQuote(decoded, 4, "right operand");
  return {
    mood: "do",
    be,
    ob: { num: left },
    to: { num: right }
  };
}

function calculate(be, left, right) {
  if (be === "plus") return left + right;
  if (be === "subtract") return Math.max(left - right, 0);
  if (be === "multiply") return left * right;
  if (be === "divide") {
    if (right === 0) throw encodingError("division-by-zero", "numeric division cannot divide by zero");
    return Math.trunc(left / right);
  }
  if (be === "remains") {
    if (right === 0) throw encodingError("division-by-zero", "numeric remainder cannot divide by zero");
    return left % right;
  }
  if (be === "xor") return left ^ right;
  throw encodingError("unsupported-operator", `numeric operator ${be} is unsupported`);
}

export async function executeNumericArithmeticCodelet(input) {
  const sentence = decodeNumericArithmeticCodelet(input);
  return {
    su: { name: "result" },
    ob: { num: calculate(sentence.be, sentence.ob.num, sentence.to.num) },
    be: "number",
    mood: "ya"
  };
}
