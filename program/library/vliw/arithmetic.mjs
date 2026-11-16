import {
  CODELET_WORD_COUNT,
  decodeLegacyCodelet,
  indexWordFor,
  VliwCodeletError
} from "./codelets.mjs";
import {
  decodeQuote,
  decodeQuoteHeader,
  lookupLegacyName,
  lookupLegacyWord,
  NUMBER_QUOTE_WORD,
  uintQuoteWord,
  vectorThicknessFor,
  VECTOR_THICK_LONG
} from "./quotes.mjs";
import { VliwEncodingError } from "./plus.mjs";

const LEGACY_HEAD_WORD = 0x0149;
const INSTRUMENTAL_CASE_WORD = 0x287e;
const ACCUSATIVE_CASE_WORD = 0x245e;
const NAME_TYPE_WORD = 0x225e;
const DEONTIC_MOOD_WORD = 0x295e;
const CASE_WORDS = Object.freeze({
  to: 0x243e,
  from: 0x313e,
  with: 0x490f,
  by: INSTRUMENTAL_CASE_WORD
});
const ROLE_BY_CASE_WORD = new Map(Object.entries(CASE_WORDS).map(([role, word]) => [word, role]));

const OPERATOR_WORDS = Object.freeze({
  plus: 0x8a64,
  subtract: 0xabd2,
  multiply: 0xec90,
  divide: 0x8893,
  xor: 0xa810,
  exponential: 0x8c29,
  remains: 0xe82a
});

// Which case carries the right operand. `to` is the right operand for the
// four operators that write their result somewhere else; `from` and `by` are
// the right operand for the two whose `to` is the result target.
const OPERATOR_ROLES = Object.freeze({
  plus: Object.freeze(["to", "from", "with"]),
  subtract: Object.freeze(["to", "from", "with"]),
  multiply: Object.freeze(["to", "from", "with"]),
  divide: Object.freeze(["to", "from", "with"]),
  xor: Object.freeze(["to", "from", "with"]),
  exponential: Object.freeze(["from", "by"]),
  remains: Object.freeze(["from", "by"])
});

const OPERATOR_BY_WORD = new Map(
  Object.entries(OPERATOR_WORDS).map(([name, word]) => [word, name])
);

export const NUMERIC_ARITHMETIC_USED_WORD_COUNT = 9;
export const numericArithmeticCompatibility = Object.freeze({
  head: LEGACY_HEAD_WORD,
  numberQuote: NUMBER_QUOTE_WORD,
  roleCases: CASE_WORDS,
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

function normalizeName(value, role) {
  if (typeof value?.name !== "string" || !value.name.trim()) {
    throw encodingError("unsupported-sentence", `numeric arithmetic ${role} operand must be a number or name`);
  }
  const parts = value.name.trim().split(/\s+/u);
  const entries = parts.map((part) => lookupLegacyName(part));
  if (entries.some((entry) => !entry)) {
    throw encodingError("unrepresentable-name", `numeric arithmetic ${role} name has no legacy vocabulary encoding`, {
      name: value.name
    });
  }
  return { name: entries.map((entry) => entry.en).join(" ") };
}

function legacyNameWords(name) {
  return name.split(/\s+/u).map((part) => Number.parseInt(lookupLegacyName(part).hnuc, 16));
}

function normalizeOperand(value, role, be) {
  if (value && Object.keys(value).length === 1 && Object.hasOwn(value, "ve")) {
    const vector = value.ve;
    if (vector?.type !== "num" || !Array.isArray(vector.values)) {
      throw encodingError("unsupported-vector-type", `numeric arithmetic ${role} operand must be an unsigned numeric vector`, {
        vector
      });
    }
    if (vector.values.length < 2) {
      throw encodingError("unsupported-vector-width", "numeric arithmetic requires at least two vector elements", {
        count: vector.values.length
      });
    }
    return {
      ve: {
        type: "num",
        values: vector.values.map((item, index) => readNumber(item, `${role} vector element ${index + 1}`))
      }
    };
  }
  if (value && Object.keys(value).length === 1 && Number.isInteger(value.num)) {
    return { num: readNumber(value.num, role) };
  }
  if (value && Object.keys(value).length === 1 && typeof value.name === "string") {
    if (be !== "subtract" || !["from", "to"].includes(role)) {
      throw encodingError("unsupported-sentence", `named ${role} operands are not supported for ${be}`);
    }
    return normalizeName(value, role);
  }
  throw encodingError("unsupported-sentence", `numeric arithmetic ${role} operand must be a number or name`, {
    value
  });
}

function operandRole(sentence) {
  const roles = OPERATOR_ROLES[sentence?.be] ?? [];
  const present = roles.filter((role) => sentence[role] !== undefined);
  if (present.length !== 1) {
    throw encodingError("unsupported-sentence", "numeric arithmetic requires one right operand", {
      roles: present
    });
  }
  return present[0];
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
  exactKeys(sentence, ["be", "mood", "ob", role].sort(), "numeric arithmetic sentence");
  const obKeys = Object.keys(sentence.ob).sort();
  let ob;
  if (obKeys.length === 1 && obKeys[0] === "num") {
    ob = { num: readNumber(sentence.ob.num, "left operand") };
  } else if (obKeys.length === 1 && obKeys[0] === "ve") {
    const vector = sentence.ob.ve;
    if (vector?.type !== "num" || !Array.isArray(vector.values)) {
      throw encodingError("unsupported-vector-type", "numeric arithmetic requires an unsigned numeric vector", {
        vector
      });
    }
    if (vector.values.length < 2) {
      throw encodingError("unsupported-vector-width", "numeric arithmetic requires at least two vector elements", {
        count: vector.values.length
      });
    }
    ob = {
      ve: {
        type: "num",
        values: vector.values.map((value, index) => readNumber(value, `vector element ${index + 1}`))
      }
    };
  } else {
    throw encodingError("unsupported-sentence", "numeric arithmetic ob operand has an unsupported shape", {
      keys: obKeys,
      expected: ["num"]
    });
  }
  const right = normalizeOperand(sentence[role], role, sentence.be);
  if (right.ve && !ob.ve) {
    throw encodingError("unsupported-sentence", "numeric vector arithmetic requires a vector ob operand");
  }
  if (ob.ve && right.ve && ob.ve.values.length !== right.ve.values.length) {
    throw encodingError("unsupported-vector-width", "numeric vector operands must have equal widths", {
      left: ob.ve.values.length,
      right: right.ve.values.length
    });
  }
  if (ob.ve && typeof right.name === "string") {
    throw encodingError("unsupported-sentence", "numeric vector arithmetic does not support named operands");
  }
  return {
    mood: "do",
    be: sentence.be,
    ob,
    [role]: right
  };
}

export function isNumericArithmeticSentence(sentence) {
  return sentence?.mood === "do" && Object.hasOwn(OPERATOR_WORDS, sentence?.be);
}

export function isNumericArithmeticCodelet(words, usedWords) {
  if (!words || !Number.isInteger(usedWords)) return false;
  try {
    const firstQuote = decodeQuote(words, 1);
    const header = decodeQuoteHeader(words[1]);
    const isVector = header.sortName === "uint" && header.scalarBytes === 2 && header.vectorThick !== 0;
    if (isVector) {
      const caseOffset = usedWords - 3;
      return words[firstQuote.nextOffset] === ACCUSATIVE_CASE_WORD &&
        ROLE_BY_CASE_WORD.has(words[caseOffset]) &&
        words[usedWords - 1] === DEONTIC_MOOD_WORD &&
        OPERATOR_BY_WORD.has(words[usedWords - 2]);
    }
  } catch {
    return false;
  }
  return words?.[3] === ACCUSATIVE_CASE_WORD &&
    ROLE_BY_CASE_WORD.has(words?.[usedWords - 3]) &&
    words?.[usedWords - 1] === DEONTIC_MOOD_WORD &&
    OPERATOR_BY_WORD.has(words?.[usedWords - 2]) &&
    OPERATOR_BY_WORD.get(words?.[usedWords - 2]) !== "plus";
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
  const roleValue = normalized[role];
  const obWords = normalized.ob.ve
    ? [
      uintQuoteWord({
        vectorThick: vectorThicknessFor(normalized.ob.ve.values.length),
        scalarBytes: 2
      }),
      ...(vectorThicknessFor(normalized.ob.ve.values.length) === VECTOR_THICK_LONG
        ? [normalized.ob.ve.values.length]
        : []),
      ...normalized.ob.ve.values
    ]
    : [NUMBER_QUOTE_WORD, normalized.ob.num];
  const roleWords = roleValue.ve
    ? [
      uintQuoteWord({ vectorThick: vectorThicknessFor(roleValue.ve.values.length), scalarBytes: 2 }),
      ...(vectorThicknessFor(roleValue.ve.values.length) === VECTOR_THICK_LONG
        ? [roleValue.ve.values.length]
        : []),
      ...roleValue.ve.values
    ]
    : typeof roleValue.name === "string"
    ? [NAME_TYPE_WORD, ...legacyNameWords(roleValue.name)]
    : [NUMBER_QUOTE_WORD, roleValue.num];
  const accusativeOffset = 1 + obWords.length;
  const roleCaseOffset = accusativeOffset + 1 + roleWords.length;
  const operatorOffset = roleCaseOffset + 1;
  const moodOffset = operatorOffset + 1;
  const usedWords = moodOffset + 1;
  if (usedWords > CODELET_WORD_COUNT) {
    throw encodingError("codelet-overflow", "numeric arithmetic operands exceed one VLIW codelet", {
      role,
      nameWords: typeof roleValue.name === "string" ? roleWords.length - 1 : 0,
      usedWords
    });
  }
  words.set([
    indexWordFor([accusativeOffset, roleCaseOffset, moodOffset]),
    ...obWords,
    ACCUSATIVE_CASE_WORD,
    ...roleWords,
    CASE_WORDS[role],
    OPERATOR_WORDS[normalized.be],
    DEONTIC_MOOD_WORD
  ]);
  return {
    sentence: normalized,
    words,
    bytes: wordsToBytes(words),
    usedWords
  };
}

export function decodeNumericArithmeticCodelet(input) {
  const decoded = decodeLegacy(input);
  const obQuote = decoded.items.find((candidate) => candidate.offset === 1);
  if (obQuote?.kind !== "quote") {
    throw encodingError("malformed-codelet", "numeric arithmetic codelet has no ob quote");
  }
  const obHeader = decodeQuoteHeader(obQuote.quote.word);
  const vectorOb = obHeader.sortName === "uint" && obHeader.scalarBytes === 2 && obHeader.vectorThick !== 0;
  const accusativeOffset = obQuote.quote.nextOffset;
  markerAt(decoded, accusativeOffset, ACCUSATIVE_CASE_WORD, "ob accusative case");
  const moodOffset = decoded.usedWords - 1;
  const operatorOffset = moodOffset - 1;
  const roleCaseOffset = operatorOffset - 1;
  const roleItem = decoded.items.find((candidate) => candidate.offset === roleCaseOffset);
  const role = ROLE_BY_CASE_WORD.get(roleItem?.word);
  if (!role) {
    throw encodingError("malformed-codelet", "numeric arithmetic codelet has an unknown operand case", {
      offset: roleCaseOffset,
      actual: roleItem?.word
    });
  }
  const leftValue = obQuote.quote.value;
  if (vectorOb && (!Array.isArray(leftValue) || leftValue.length < 2)) {
    throw encodingError("malformed-codelet", "numeric arithmetic ob vector has an invalid width");
  }
  if (!vectorOb && obQuote.quote.nextOffset !== 3) {
    throw encodingError("malformed-codelet", "numeric arithmetic ob quote has an invalid boundary");
  }
  if (decoded.usedWords !== moodOffset + 1) {
    throw encodingError("malformed-codelet", "numeric arithmetic codelet has an invalid used-word boundary", {
      expected: moodOffset + 1,
      actual: decoded.usedWords
    });
  }
  const expectedHead = indexWordFor([accusativeOffset, roleCaseOffset, moodOffset]);
  markerAt(decoded, 0, expectedHead, "index/head");
  markerAt(decoded, moodOffset, DEONTIC_MOOD_WORD, "deontic mood");
  const operatorItem = decoded.items.find((candidate) => candidate.offset === operatorOffset);
  const be = OPERATOR_BY_WORD.get(operatorItem?.word);
  if (!be) {
    throw encodingError("malformed-codelet", "numeric arithmetic codelet has an unsupported operator", {
      actual: operatorItem?.word
    });
  }
  if (!OPERATOR_ROLES[be].includes(role)) {
    throw encodingError("unsupported-codelet", `${role} is not a valid operand case for ${be}`, {
      role,
      be
    });
  }
  const rightOffset = accusativeOffset + 1;
  const rightQuote = decoded.items.find((candidate) => candidate.offset === rightOffset);
  let right;
  if (rightQuote?.kind === "quote" && rightQuote.quote.word === NUMBER_QUOTE_WORD) {
    if (rightQuote.quote.nextOffset !== roleCaseOffset) {
      throw encodingError("malformed-codelet", "numeric arithmetic right quote has an invalid boundary");
    }
    right = { num: rightQuote.quote.value };
  } else if (rightQuote?.kind === "quote") {
    const header = decodeQuoteHeader(rightQuote.quote.word);
    if (header.sortName !== "uint" || header.scalarBytes !== 2 || header.vectorThick === 0 ||
        !Array.isArray(rightQuote.quote.value) || rightQuote.quote.value.length < 2) {
      throw encodingError("malformed-codelet", "numeric arithmetic right vector quote is invalid");
    }
    if (rightQuote.quote.nextOffset !== roleCaseOffset) {
      throw encodingError("malformed-codelet", "numeric arithmetic right vector quote has an invalid boundary", {
        nextOffset: rightQuote.quote.nextOffset,
        roleCaseOffset
      });
    }
    right = { ve: { type: "num", values: rightQuote.quote.value } };
  } else {
    const nameItems = decoded.items.filter((candidate) => (
      candidate.kind === "word" && candidate.offset > 4 && candidate.offset < roleCaseOffset
    ));
    const nameType = decoded.items.find((candidate) => candidate.offset === 4);
    if (
      nameType?.kind !== "word" ||
      nameType.word !== NAME_TYPE_WORD ||
      nameItems.length !== roleCaseOffset - 5 ||
      nameItems.some((item) => !lookupLegacyWord(item.word)?.en)
    ) {
      throw encodingError("malformed-codelet", "numeric arithmetic named operand has an invalid vocabulary phrase", {
        offsets: nameItems.map((item) => item.offset)
      });
    }
    if (be !== "subtract" || !["from", "to"].includes(role)) {
      throw encodingError("unsupported-codelet", `named ${role} operands are not supported for ${be}`);
    }
    right = { name: nameItems.map((item) => lookupLegacyWord(item.word).en).join(" ") };
  }
  if (vectorOb && right.ve && right.ve.values.length !== leftValue.length) {
    throw encodingError("unsupported-vector-width", "numeric vector operands must have equal widths", {
      left: leftValue.length,
      right: right.ve.values.length
    });
  }
  if (!vectorOb && right.ve) {
    throw encodingError("unsupported-codelet", "numeric vector arithmetic requires a vector ob operand");
  }
  return {
    mood: "do",
    be,
    ob: vectorOb
      ? { ve: { type: "num", values: leftValue } }
      : { num: decodeNumberQuote(decoded, 1, "ob operand") },
    [role]: right
  };
}

function saturate(value) {
  if (!Number.isFinite(value)) return 0xffff;
  return Math.min(Math.max(Math.trunc(value), 0), 0xffff);
}

function calculate(be, left, right) {
  if (be === "plus") return Math.min(left + right, 0xffff);
  if (be === "subtract") return Math.max(left - right, 0);
  if (be === "multiply") return left * right;
  if (be === "divide") {
    if (right === 0) throw encodingError("division-by-zero", "numeric division cannot divide by zero");
    return Math.trunc(left / right);
  }
  if (be === "xor") return left ^ right;
  if (be === "exponential") return saturate(left ** right);
  if (be === "remains") {
    if (right === 0) throw encodingError("division-by-zero", "numeric remainder cannot divide by zero");
    return left % right;
  }
  throw encodingError("unsupported-operator", `numeric operator ${be} is unsupported`);
}

export async function executeNumericArithmeticCodelet(input, { state } = {}) {
  const sentence = decodeNumericArithmeticCodelet(input);
  const role = operandRole(sentence);
  if (sentence.ob.ve) {
    const right = sentence[role];
    const values = sentence.ob.ve.values.map((left, index) => calculate(
      sentence.be,
      left,
      right.ve ? right.ve.values[index] : right.num
    ));
    return {
      su: { name: "result" },
      ob: { ve: { type: "num", values } },
      be: "vector",
      mood: "ya"
    };
  }
  if (typeof sentence[role].name === "string") {
    const target = state?.get(sentence[role].name);
    if (!target || !Number.isFinite(target.ob?.num)) {
      throw encodingError("unfulfilled-reference", `numeric arithmetic target ${sentence[role].name} has no numeric value`, {
        name: sentence[role].name
      });
    }
    const value = target.ob.num - sentence.ob.num;
    const updated = {
      mood: "ya",
      su: { name: sentence[role].name },
      ob: { num: value },
      be: "number"
    };
    state.set(sentence[role].name, updated);
    return {
      su: { name: "result" },
      ob: { num: value },
      be: "number",
      mood: "ya"
    };
  }
  return {
    su: { name: "result" },
    ob: { num: calculate(sentence.be, sentence.ob.num, sentence[role].num) },
    be: "number",
    mood: "ya"
  };
}
