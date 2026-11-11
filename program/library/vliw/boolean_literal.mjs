import {
  CODELET_WORD_COUNT,
  decodeLegacyCodelet,
  VliwCodeletError
} from "./codelets.mjs";
import { lookupLegacyName, lookupLegacyWord } from "./quotes.mjs";
import { VliwEncodingError } from "./plus.mjs";

const ANONYMOUS_HEAD_WORD = 0x0019;
const NAMED_HEAD_WORD = 0x0065;
const NOMINATIVE_CASE_WORD = 0x24de;
const ACCUSATIVE_CASE_WORD = 0x245e;
const BOOLEAN_GRAMMAR_WORD = 0x538f;
const TRUTH_WORD = 0x6909;
const LIE_WORD = 0x680d;
const REALIS_MOOD_WORD = 0x217e;

export const booleanLiteralCompatibility = Object.freeze({
  anonymousHead: ANONYMOUS_HEAD_WORD,
  namedHead: NAMED_HEAD_WORD,
  nominativeCase: NOMINATIVE_CASE_WORD,
  accusativeCase: ACCUSATIVE_CASE_WORD,
  booleanGrammar: BOOLEAN_GRAMMAR_WORD,
  truth: TRUTH_WORD,
  lie: LIE_WORD,
  realisMood: REALIS_MOOD_WORD
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

function normalizeBoolean(value) {
  if (typeof value !== "boolean") {
    throw encodingError("boolean-value", "boolean literals require a boolean payload", { value });
  }
  return value;
}

function normalizeName(value) {
  if (!value || typeof value.name !== "string") {
    throw encodingError("unrepresentable-name", "named boolean literals require a name", { name: value });
  }
  const parts = value.name.trim().split(/\s+/u).filter(Boolean);
  const entries = parts.map((part) => lookupLegacyName(part));
  if (entries.some((entry) => !entry)) {
    throw encodingError("unrepresentable-name", "named boolean literals require legacy vocabulary words for every name part", {
      name: value.name
    });
  }
  return {
    name: entries.map((entry) => entry.en).join(" "),
    words: entries.map((entry) => Number.parseInt(entry.hnuc, 16))
  };
}

export function isBooleanLiteralSentence(sentence) {
  return sentence?.mood === "ya" && sentence?.ob?.boolean !== undefined;
}

export function normalizeBooleanLiteralSentence(sentence) {
  if (!isBooleanLiteralSentence(sentence)) {
    throw encodingError("unsupported-sentence", "boolean literals require mood ya and ob boolean");
  }
  const keys = Object.keys(sentence).sort();
  const named = sentence.su !== undefined;
  const expected = named ? ["mood", "ob", "su"] : ["mood", "ob"];
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw encodingError("unsupported-sentence", "boolean literal has an unsupported shape", { keys, expected });
  }
  const obKeys = Object.keys(sentence.ob).sort();
  if (obKeys.length !== 1 || obKeys[0] !== "boolean") {
    throw encodingError("unsupported-sentence", "boolean literal payload has an unsupported shape", { obKeys });
  }
  const normalized = { mood: "ya", ob: { boolean: normalizeBoolean(sentence.ob.boolean) } };
  if (named) {
    const name = normalizeName(sentence.su);
    normalized.su = { name: name.name };
    normalized.nameWords = name.words;
  }
  return normalized;
}

function markerAt(decoded, offset, expected, role) {
  const item = decoded.items.find((candidate) => candidate.offset === offset);
  if (item?.kind !== "word" || item.word !== expected) {
    throw encodingError("malformed-codelet", `boolean literal codelet has an invalid ${role}`, {
      offset,
      expected,
      actual: item?.word
    });
  }
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

export function lowerBooleanLiteralSentence(sentence) {
  const normalized = normalizeBooleanLiteralSentence(sentence);
  const named = normalized.su !== undefined;
  const words = new Uint16Array(CODELET_WORD_COUNT);
  words.set(named
    ? [
      NAMED_HEAD_WORD,
      ...normalized.nameWords,
      NOMINATIVE_CASE_WORD,
      normalized.ob.boolean ? TRUTH_WORD : LIE_WORD,
      BOOLEAN_GRAMMAR_WORD,
      ACCUSATIVE_CASE_WORD,
      REALIS_MOOD_WORD
    ]
    : [
      ANONYMOUS_HEAD_WORD,
      normalized.ob.boolean ? TRUTH_WORD : LIE_WORD,
      BOOLEAN_GRAMMAR_WORD,
      ACCUSATIVE_CASE_WORD,
      REALIS_MOOD_WORD
    ]);
  const { nameWords, ...sentenceResult } = normalized;
  return {
    sentence: sentenceResult,
    words,
    bytes: wordsToBytes(words),
    usedWords: named ? nameWords.length + 6 : 5
  };
}

export function decodeBooleanLiteralCodelet(input) {
  const decoded = decodeLegacy(input);
  const named = decoded.words[0] === NAMED_HEAD_WORD;
  const anonymous = decoded.words[0] === ANONYMOUS_HEAD_WORD;
  if (!named && !anonymous) {
    throw encodingError("malformed-codelet", "boolean literal codelet has an invalid head", {
      actual: decoded.words[0]
    });
  }
  const valueOffset = named ? 3 : 1;
  const nominativeOffset = named
    ? decoded.items.find((candidate) => (
      candidate.kind === "word" && candidate.word === NOMINATIVE_CASE_WORD && candidate.offset > 0
    ))?.offset
    : null;
  if (named && (nominativeOffset === undefined || nominativeOffset < 2)) {
    throw encodingError("malformed-codelet", "named boolean codelet has no name phrase");
  }
  const actualValueOffset = named ? nominativeOffset + 1 : valueOffset;
  const actualGrammarOffset = actualValueOffset + 1;
  const actualAccusativeOffset = actualGrammarOffset + 1;
  const actualRealisOffset = actualAccusativeOffset + 1;
  const actualExpectedUsedWords = actualRealisOffset + 1;
  if (decoded.usedWords !== actualExpectedUsedWords) {
    throw encodingError("malformed-codelet", "boolean literal codelet has an invalid used-word boundary", {
      expected: actualExpectedUsedWords,
      actual: decoded.usedWords
    });
  }
  markerAt(decoded, actualGrammarOffset, BOOLEAN_GRAMMAR_WORD, "boolean grammar");
  markerAt(decoded, actualAccusativeOffset, ACCUSATIVE_CASE_WORD, "accusative case");
  markerAt(decoded, actualRealisOffset, REALIS_MOOD_WORD, "realis mood");
  const valueItem = decoded.items.find((candidate) => candidate.offset === actualValueOffset);
  if (valueItem?.kind !== "word" || ![TRUTH_WORD, LIE_WORD].includes(valueItem.word)) {
    throw encodingError("malformed-codelet", "boolean literal codelet has an invalid boolean value", {
      actual: valueItem?.word
    });
  }
  const sentence = {
    mood: "ya",
    ob: { boolean: valueItem.word === TRUTH_WORD }
  };
  if (named) {
    const nameItems = decoded.items.filter((candidate) => (
      candidate.kind === "word" && candidate.offset > 0 && candidate.offset < nominativeOffset
    ));
    if (nameItems.length !== nominativeOffset - 1 || nameItems.some((item) => !lookupLegacyWord(item.word)?.en)) {
      throw encodingError("malformed-codelet", "boolean literal codelet has an unknown name word", {
        actual: nameItems.map((item) => item.word)
      });
    }
    sentence.su = { name: nameItems.map((item) => lookupLegacyWord(item.word).en).join(" ") };
  }
  return sentence;
}

export async function executeBooleanLiteralCodelet(input) {
  return decodeBooleanLiteralCodelet(input);
}
