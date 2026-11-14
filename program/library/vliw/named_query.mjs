import {
  CODELET_WORD_COUNT,
  decodeLegacyCodelet,
  indexWordFor,
  VliwCodeletError
} from "./codelets.mjs";
import { lookupLegacyName, lookupLegacyWord } from "./quotes.mjs";
import { VliwEncodingError } from "./plus.mjs";

const NAMED_HEAD_WORD = 0x0065;
const NOMINATIVE_CASE_WORD = 0x24de;
const WHAT_WORD = 0x0910;
const ACCUSATIVE_CASE_WORD = 0x245e;
const INTERROGATIVE_MOOD_WORD = 0x21de;

export const namedQueryCompatibility = Object.freeze({
  head: NAMED_HEAD_WORD,
  nominativeCase: NOMINATIVE_CASE_WORD,
  what: WHAT_WORD,
  accusativeCase: ACCUSATIVE_CASE_WORD,
  interrogativeMood: INTERROGATIVE_MOOD_WORD
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

function legacyNameWords(name) {
  if (typeof name !== "string" || !name.trim()) {
    throw encodingError("unrepresentable-name", "named queries require a non-empty subject name");
  }
  const entries = name.trim().split(/\s+/u).map((part) => lookupLegacyName(part));
  if (entries.some((entry) => !entry)) {
    throw encodingError("unrepresentable-name", "named query requires legacy vocabulary words for every name part", {
      name
    });
  }
  return entries.map((entry) => Number.parseInt(entry.hnuc, 16));
}

export function isNamedQuerySentence(sentence) {
  return sentence?.mood === "que" && sentence?.su?.name && sentence?.ob?.name === "what";
}

export function lowerNamedQuerySentence(sentence) {
  if (!isNamedQuerySentence(sentence) || Object.keys(sentence).sort().join(",") !== "mood,ob,su") {
    throw encodingError("unsupported-sentence", "named queries require su name, ob what, and mood que");
  }
  const nameWords = legacyNameWords(sentence.su.name);
  const nominativeOffset = nameWords.length + 1;
  const accusativeOffset = nominativeOffset + 2;
  const moodOffset = accusativeOffset + 1;
  if (moodOffset + 1 > CODELET_WORD_COUNT) {
    throw encodingError("codelet-overflow", "named query subject exceeds one VLIW codelet", {
      name: sentence.su.name
    });
  }
  const words = new Uint16Array(CODELET_WORD_COUNT);
  words.set([
    indexWordFor([nominativeOffset, accusativeOffset, moodOffset]),
    ...nameWords,
    NOMINATIVE_CASE_WORD,
    WHAT_WORD,
    ACCUSATIVE_CASE_WORD,
    INTERROGATIVE_MOOD_WORD
  ]);
  return {
    sentence: {
      mood: "que",
      su: { name: sentence.su.name.trim().split(/\s+/u).join(" ") },
      ob: { name: "what" }
    },
    words,
    bytes: wordsToBytes(words),
    usedWords: moodOffset + 1
  };
}

export function decodeNamedQueryCodelet(input) {
  let decoded;
  try {
    decoded = decodeLegacyCodelet(input);
  } catch (error) {
    if (error instanceof VliwCodeletError) {
      throw encodingError("malformed-codelet", error.message, {
        cause: error.code,
        details: error.details
      });
    }
    throw error;
  }
  const moodOffset = decoded.usedWords - 1;
  const interrogative = decoded.items.find((item) => item.offset === moodOffset);
  const accusativeOffset = moodOffset - 1;
  const whatOffset = moodOffset - 2;
  const nominativeOffset = moodOffset - 3;
  const marker = (offset, word, label) => {
    const item = decoded.items.find((candidate) => candidate.offset === offset);
    if (item?.kind !== "word" || item.word !== word) {
      throw encodingError("malformed-codelet", `named query has an invalid ${label}`, {
        offset,
        expected: word,
        actual: item?.word
      });
    }
  };
  marker(moodOffset, INTERROGATIVE_MOOD_WORD, "interrogative mood");
  marker(accusativeOffset, ACCUSATIVE_CASE_WORD, "accusative case");
  marker(whatOffset, WHAT_WORD, "what object");
  marker(nominativeOffset, NOMINATIVE_CASE_WORD, "nominative case");
  if (nominativeOffset < 2) {
    throw encodingError("malformed-codelet", "named query has no subject name");
  }
  const nameItems = decoded.items.filter((item) => item.kind === "word" && item.offset > 0 && item.offset < nominativeOffset);
  if (nameItems.length !== nominativeOffset - 1 || nameItems.some((item) => !lookupLegacyWord(item.word)?.en)) {
    throw encodingError("malformed-codelet", "named query subject contains an unknown vocabulary word");
  }
  const expectedHead = indexWordFor([nominativeOffset, accusativeOffset, moodOffset]);
  marker(0, expectedHead, "index/head");
  return {
    mood: "que",
    su: { name: nameItems.map((item) => lookupLegacyWord(item.word).en).join(" ") },
    ob: { name: "what" }
  };
}

export async function executeNamedQueryCodelet(input, state) {
  const sentence = decodeNamedQueryCodelet(input);
  const fact = state.get(sentence.su.name);
  if (!fact) {
    throw encodingError("unfulfilled-reference", `named query reads unfulfilled reference ${sentence.su.name}`, {
      name: sentence.su.name
    });
  }
  return structuredClone(fact);
}
