import pyashWords from "../pyashWords.json" with { type: "json" };
import { renderPyashSurface } from "../../verbs/exchange/translation/pyash_surface.mjs";
import { decodePyacWord, encodePyacWord } from "./word_code.mjs";
import {
  matchVliwCompound,
  matchVliwCompoundSurface,
  VLIW_COMPOUND_ENTRIES
} from "./compound_dictionary.mjs";

export const PHRASE_VLIW_FORMAT = "pyac-vliw-phrase-v1";
export const PHRASE_VLIW_WORDS_PER_VECTOR = 16;

export const PHRASE_CASE_WORDS = new Set(
  pyashWords
    .filter((entry) => typeof entry?.en === "string" && entry.en.endsWith("_case_"))
    .map((entry) => entry.pya)
    .filter(Boolean)
);
const MOOD_WORDS = new Set([
  "ya", "do", "def", "prah", "ret", "que", "can", "pe", "pi7", "li", "tu", "cu",
  "si", "ri", "di", "tcih", "lo", "cyih", "dwih", "pcih", "psih", "tseh", "twuh",
  "rwih", "jwih", "mwih", "mu", "nwoh", "lu", "byih", "kcuh", "kcu7h", "dyah",
  "pceh", "pruh", "swuh", "ru", "ksuh", "t6", "zlih", "n6", "gyih", "si2"
]);

const entriesByPya = new Map();
for (const entry of pyashWords) {
  const pya = typeof entry?.pya === "string" ? entry.pya : "";
  if (pya && !entriesByPya.has(pya)) entriesByPya.set(pya, entry);
}

const grammarPya = [...entriesByPya.values()]
  .filter((entry) => typeof entry.en === "string" && entry.en.endsWith("_"))
  .map((entry) => entry.pya)
  .sort((left, right) => right.length - left.length);

function invalid(message, details = {}) {
  const error = new Error(message);
  error.code = "invalid-vliw-phrase";
  error.details = details;
  return error;
}

function normalizeTokens(tokens) {
  const values = typeof tokens === "string"
    ? tokens.trim().split(/\s+/u).filter(Boolean)
    : Array.isArray(tokens)
      ? tokens.flatMap((token) => String(token).trim().split(/\s+/u)).filter(Boolean)
      : null;
  if (!values) throw invalid("VLIW phrase tokens must be an array or text");
  return values.flatMap(expandToken);
}

function expandGrammar(value) {
  if (!value) return [];
  for (const pya of grammarPya) {
    if (!value.startsWith(pya)) continue;
    const remainder = value.slice(pya.length);
    if (!remainder) return [pya];
    const suffix = expandGrammar(remainder);
    if (suffix.length > 0) return [pya, ...suffix];
  }
  return [];
}

function expandToken(value) {
  if (entriesByPya.has(value)) return [value];
  const compound = matchVliwCompoundSurface(value, VLIW_COMPOUND_ENTRIES);
  if (compound) {
    const suffix = expandGrammar(compound.remainder);
    if (!compound.remainder || suffix.length > 0) {
      return [...compound.pyashSequence, ...suffix];
    }
  }
  const roots = [...entriesByPya.keys()]
    .filter((pya) => value.startsWith(pya))
    .sort((left, right) => right.length - left.length);
  for (const root of roots) {
    const suffix = expandGrammar(value.slice(root.length));
    if (suffix.length > 0) return [root, ...suffix];
  }
  throw invalid("VLIW phrase token cannot be expanded from the vocabulary", { token: value });
}

function hnucFor(pya) {
  if (!entriesByPya.has(pya)) throw invalid("VLIW phrase word is absent from the legacy vocabulary", { pya });
  return encodePyacWord(pya);
}

function wordsToBytes(vectors) {
  const values = vectors.flatMap((vector) => vector);
  const bytes = new Uint8Array(values.length * 2);
  const view = new DataView(bytes.buffer);
  values.forEach((word, index) => view.setUint16(index * 2, word, true));
  return bytes;
}

function chunk(values, size) {
  const chunks = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function headForChunk(tokens, complete) {
  let head = complete ? 1 : 0;
  tokens.forEach((pya, index) => {
    const slot = index + 1;
    if (PHRASE_CASE_WORDS.has(pya) || MOOD_WORDS.has(pya)) head |= 1 << slot;
  });
  return head;
}

function normalizeVectors(input) {
  if (input?.vectors) return normalizeVectors(input.vectors);
  if (input instanceof Uint16Array || (Array.isArray(input) && input.every(Number.isInteger))) {
    if (input.length !== PHRASE_VLIW_WORDS_PER_VECTOR) {
      throw invalid("VLIW phrase codelet must contain 16 words", { length: input.length });
    }
    return [Array.from(input)];
  }
  if (!Array.isArray(input) || input.length === 0) {
    throw invalid("VLIW phrase input must contain one or more vectors");
  }
  return input.map((vector, index) => {
    if (!(vector instanceof Uint16Array) && !Array.isArray(vector)) {
      throw invalid("VLIW phrase vector is invalid", { index });
    }
    if (vector.length !== PHRASE_VLIW_WORDS_PER_VECTOR) {
      throw invalid("VLIW phrase vector must contain 16 words", { index, length: vector.length });
    }
    return Array.from(vector);
  });
}

export function lowerPhraseVliw({ tokens } = {}) {
  const normalized = normalizeTokens(tokens);
  if (normalized.length === 0) throw invalid("VLIW phrase cannot be empty");
  const values = normalized.map(hnucFor);
  const tokenChunks = chunk(normalized, PHRASE_VLIW_WORDS_PER_VECTOR - 1);
  const valueChunks = chunk(values, PHRASE_VLIW_WORDS_PER_VECTOR - 1);
  const vectors = tokenChunks.map((tokenChunk, index) => {
    const vector = new Array(PHRASE_VLIW_WORDS_PER_VECTOR).fill(0);
    vector[0] = headForChunk(tokenChunk, index === tokenChunks.length - 1);
    valueChunks[index].forEach((word, wordIndex) => {
      vector[wordIndex + 1] = word;
    });
    return vector;
  });
  return {
    format: PHRASE_VLIW_FORMAT,
    tokens: normalized,
    vectors,
    words: vectors.length === 1 ? vectors[0] : vectors.flat(),
    bytes: wordsToBytes(vectors),
    usedWords: values.length + vectors.length,
    phraseEnds: normalized
      .map((pya, index) => PHRASE_CASE_WORDS.has(pya) ? index : null)
      .filter((index) => index !== null),
    moodIndex: normalized.findLastIndex((pya) => MOOD_WORDS.has(pya))
  };
}

function sentencePhraseValue(value) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && typeof value.name === "string") return value.name;
  return "";
}

function phraseTokens(value) {
  const phrase = sentencePhraseValue(value);
  return phrase.trim().split(/\s+/u).filter(Boolean);
}

function namedPhraseTokens(value, role) {
  const tokens = phraseTokens(value);
  if (tokens.length === 0) return [];
  const roleCase = role === "su" ? "na" : role === "ob" ? "ka" : "";
  const finalCaseIndex = [...tokens].findLastIndex((token) => PHRASE_CASE_WORDS.has(token));
  const caseIndex = finalCaseIndex >= 0
    ? finalCaseIndex
    : roleCase
      ? tokens.length
      : -1;
  if (caseIndex < 0) return tokens;
  if (tokens[caseIndex - 1] === "gi") return tokens;
  const result = [...tokens];
  result.splice(caseIndex, 0, "gi");
  if (finalCaseIndex < 0 && roleCase) result.push(roleCase);
  return result;
}

function sentencePhraseTokens(value, role, { markName = false } = {}) {
  if (value && typeof value === "object" && typeof value.name === "string") {
    return markName ? namedPhraseTokens(value, role) : phraseTokens(value);
  }
  return phraseTokens(value);
}

export function lowerSentencePhraseVliw(sentence, { markNames = false } = {}) {
  if (!sentence || typeof sentence !== "object") {
    throw invalid("VLIW sentence must be an object");
  }
  const values = [
    sentencePhraseTokens(sentence.su, "su", { markName: markNames }).join(" "),
    sentencePhraseTokens(sentence.ob, "ob", { markName: markNames }).join(" "),
    sentencePhraseValue(sentence.be),
    typeof sentence.mood === "string" ? sentence.mood : ""
  ].filter(Boolean);
  if (values.length === 0 || !sentencePhraseValue(sentence.su)) {
    throw invalid("VLIW sentence requires a subject phrase");
  }
  return lowerPhraseVliw({ tokens: values.join(" ") });
}

function validateVector(vector, index, final) {
  const head = vector[0];
  if (!Number.isInteger(head) || head < 0 || head > 0xffff) {
    throw invalid("VLIW phrase head is invalid", { index, head });
  }
  if (((head & 1) === 1) !== final) {
    throw invalid("VLIW phrase completion bits are inconsistent", { index, head, final });
  }
  let used = vector.length - 1;
  while (used > 0 && vector[used] === 0) used -= 1;
  for (let slot = used + 1; slot < vector.length; slot += 1) {
    if (vector[slot] !== 0) throw invalid("VLIW phrase has a nonzero tail", { index, slot });
  }
  return { head, used };
}

export function decodePhraseVliw(input) {
  const vectors = normalizeVectors(input);
  const tokens = [];
  const phraseEnds = [];
  let moodIndex = -1;
  let absolute = 0;
  vectors.forEach((vector, vectorIndex) => {
    const { head, used } = validateVector(vector, vectorIndex, vectorIndex === vectors.length - 1);
    for (let slot = 1; slot <= used; slot += 1) {
      const hnuc = vector[slot];
      let pya;
      try {
        pya = decodePyacWord(hnuc);
      } catch (error) {
        throw invalid("VLIW phrase contains an unknown HNUC", { vectorIndex, slot, hnuc, cause: error.code });
      }
      const entry = entriesByPya.get(pya);
      if (!entry?.pya) throw invalid("VLIW phrase contains an unassigned HNUC", { vectorIndex, slot, hnuc, pya });
      tokens.push({
        index: absolute,
        pya: entry.pya,
        en: entry.en,
        hnuc
      });
      if ((head & (1 << slot)) !== 0) {
        if (PHRASE_CASE_WORDS.has(entry.pya)) phraseEnds.push(absolute);
        if (MOOD_WORDS.has(entry.pya)) moodIndex = absolute;
      }
      absolute += 1;
    }
  });
  if (tokens.length === 0) throw invalid("VLIW phrase has no words");
  return {
    format: PHRASE_VLIW_FORMAT,
    vectors,
    words: vectors.length === 1 ? vectors[0] : vectors.flat(),
    tokens,
    phraseEnds,
    moodIndex,
    usedWords: tokens.length + vectors.length
  };
}

export function renderVliwStructuralPyash(decoded) {
  return decoded.tokens.map((token) => token.pya).join(" ");
}

export function renderVliwPyac(decoded) {
  const rendered = [];
  for (let index = 0; index < decoded.tokens.length; index += 1) {
    const match = matchVliwCompound(decoded.tokens, index, VLIW_COMPOUND_ENTRIES);
    if (match) {
      rendered.push(match.pyashSequence.join(""));
      index += match.length - 1;
      continue;
    }
    rendered.push(decoded.tokens[index].pya);
  }
  return renderPyashSurface(rendered.join(" "));
}

export function phraseParts(decoded) {
  const ends = [...decoded.phraseEnds].filter((end) => (
    end + 1 >= decoded.tokens.length
    || !PHRASE_CASE_WORDS.has(decoded.tokens[end + 1].pya)
  ));
  const phrases = [];
  let start = 0;
  for (const end of ends) {
    phrases.push({
      tokens: decoded.tokens.slice(start, end + 1),
      case: decoded.tokens[end].pya
    });
    start = end + 1;
  }
  const moodIndex = decoded.moodIndex >= 0 ? decoded.moodIndex : decoded.tokens.length;
  return {
    phrases,
    trailing: decoded.tokens.slice(start, moodIndex),
    mood: decoded.moodIndex >= 0 ? decoded.tokens[decoded.moodIndex].pya : null
  };
}
