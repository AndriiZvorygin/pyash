import pyashWords from "../pyashWords.json" with { type: "json" };
import { decodeLegacyCodeletSequence, VliwCodeletError } from "./codelets.mjs";
import {
  NUMBER_QUOTE_WORD,
  PARAGRAPH_LETTER_QUOTE_WORD,
  lookupLegacyName,
  lookupLegacyWord
} from "./quotes.mjs";
import { encodePyacWord } from "./word_code.mjs";

const WORD_COUNT = 16;
const PAYLOAD_WORDS = WORD_COUNT - 1;
const NAME_TYPE = wordForEntry("name_");
const GENITIVE_CASE = wordForEntry("genitive_case_");
const CONDITIONAL_MOOD = wordForEntry("conditional_mood_");

const ROLE_ENTRIES = Object.freeze({
  su: "nominative_case_",
  ob: "accusative_case_",
  from: "source_case_",
  to: "destination_case_",
  by: "instrumental_case_",
  with: "comitative_case_",
  fromindex: "multiplicative_case_",
  toindex: "toindex_"
});
const ROLE_BY_WORD = new Map(
  Object.entries(ROLE_ENTRIES).map(([role, english]) => [wordForEntry(english), role])
);
const FIELD_ORDER = Object.keys(ROLE_ENTRIES);

const MOOD_ENTRIES = Object.freeze({
  ya: "realis_mood_",
  do: "deontic_mood_",
  def: "declarative_mood_",
  prah: "paragraph_",
  que: "interrogative_mood_",
  then: "conditional_mood_"
});
const MOOD_BY_WORD = new Map(
  Object.entries(MOOD_ENTRIES).map(([mood, english]) => [wordForEntry(english), mood])
);

const ENTRIES_BY_HNUC = new Map();
for (const entry of pyashWords) {
  const word = Number.parseInt(entry.hnuc, 16);
  if (Number.isInteger(word) && !ENTRIES_BY_HNUC.has(word)) ENTRIES_BY_HNUC.set(word, entry);
}

const THIS_WORD = encodePyacWord("tsah");

function wordForEntry(english) {
  const entry = pyashWords.find((candidate) => candidate.en === english);
  if (!entry) throw new Error(`VLIW sentence mapping is missing ${english}`);
  return Number.parseInt(entry.hnuc, 16);
}

function invalid(code, message, details = {}) {
  const error = new Error(message);
  error.name = "VliwSentenceError";
  error.code = code;
  error.details = details;
  return error;
}

function nameWord(token, role) {
  if (token === "this") return THIS_WORD;
  if (token === "fromindex") return wordForEntry("multiplicative_case_");
  if (token === "toindex") return wordForEntry("toindex_");
  const entry = lookupLegacyName(token);
  if (!entry?.hnuc) {
    throw invalid("unrepresentable-name", `VLIW ${role} name has no vocabulary HNUC`, {
      role,
      token
    });
  }
  return Number.parseInt(entry.hnuc, 16);
}

function nameWords(value, role) {
  if (typeof value !== "string" || !value.trim()) {
    throw invalid("invalid-name", `VLIW ${role} requires a non-empty name`);
  }
  return value.trim().split(/\s+/u).map((token) => nameWord(token, role));
}

function encodeValue(value, role) {
  if (Number.isInteger(value?.num)) {
    if (value.num < 0 || value.num > 0xffff) {
      throw invalid("unsupported-value", `VLIW ${role} number must be an unsigned 16-bit integer`, {
        value: value.num
      });
    }
    return [NUMBER_QUOTE_WORD, value.num];
  }
  if (typeof value?.text === "string") {
    const chars = Array.from({ length: value.text.length }, (_, index) => value.text.charCodeAt(index));
    if (chars.length === 0) throw invalid("unsupported-value", `VLIW ${role} text quote cannot be empty`);
    return [PARAGRAPH_LETTER_QUOTE_WORD, chars.length, ...chars];
  }
  if (typeof value?.name === "string") {
    return [NAME_TYPE, ...nameWords(value.name, role)];
  }
  if (Array.isArray(value?.genitive?.chain) && value.genitive.chain.length > 0) {
    const encoded = [];
    for (const [index, item] of value.genitive.chain.entries()) {
      if (index > 0) encoded.push(GENITIVE_CASE);
      encoded.push(nameWord(item, role));
    }
    return encoded;
  }
  throw invalid("unsupported-value", `VLIW ${role} value has no supported quote or name form`, {
    value
  });
}

function encodeClause(sentence, { conditional = false } = {}) {
  if (!sentence || typeof sentence !== "object" || typeof sentence.be !== "string") {
    throw invalid("unsupported-sentence", "VLIW sentence requires a verb and a parsed Pyash sentence");
  }

  const words = [];
  const boundaries = [];
  for (const role of FIELD_ORDER) {
    if (sentence[role] === undefined) continue;
    words.push(...encodeValue(sentence[role], role));
    const caseWord = wordForEntry(ROLE_ENTRIES[role]);
    words.push(caseWord);
    boundaries.push(words.length);
  }

  const verb = lookupLegacyName(sentence.be);
  if (!verb?.hnuc) {
    throw invalid("unrepresentable-verb", `VLIW verb has no vocabulary HNUC (${sentence.be})`, {
      verb: sentence.be
    });
  }
  words.push(Number.parseInt(verb.hnuc, 16));
  const mood = conditional ? "then" : sentence.mood;
  const moodEntry = MOOD_ENTRIES[mood];
  if (!moodEntry) throw invalid("unsupported-mood", `VLIW sentence mood is unsupported (${mood})`, { mood });
  words.push(wordForEntry(moodEntry));
  boundaries.push(words.length);
  return { words, boundaries };
}

function encodeSentenceWords(sentence) {
  if (sentence?.exists === true) {
    // `exists` is declaration sugar; the named typed fact carries the same
    // declaration semantics in the legacy quote/case representation.
  }
  const clauses = [];
  let current = sentence;
  while (current) {
    const encoded = encodeClause(current, { conditional: Boolean(current.consequence) });
    clauses.push(encoded);
    current = current.consequence;
  }
  const words = [];
  const boundaries = new Set();
  for (const clause of clauses) {
    for (const offset of clause.boundaries) boundaries.add(words.length + offset);
    words.push(...clause.words);
  }
  if (words.length === 0) throw invalid("unsupported-sentence", "VLIW sentence encoded no words");
  return { words, boundaries };
}

function vectorsFor(words, boundaryOffsets) {
  const vectors = [];
  for (let start = 0; start < words.length; start += PAYLOAD_WORDS) {
    const chunk = words.slice(start, start + PAYLOAD_WORDS);
    const complete = start + PAYLOAD_WORDS >= words.length;
    const head = complete ? 1 : 0;
    const vector = new Uint16Array(WORD_COUNT);
    for (let index = 0; index < chunk.length; index += 1) {
      vector[index + 1] = chunk[index];
      const isBoundary = boundaryOffsets.has(start + index + 1);
      if (isBoundary === complete) vector[0] |= 1 << (index + 1);
    }
    vector[0] |= head;
    vectors.push(vector);
  }
  return vectors;
}

export function lowerPyashSentence(sentence) {
  const encoded = encodeSentenceWords(sentence);
  return {
    sentence,
    words: encoded.words,
    vectors: vectorsFor(encoded.words, encoded.boundaries),
    boundaryOffsets: [...encoded.boundaries].sort((left, right) => left - right)
  };
}

export function lowerPyashProgram(sentences) {
  if (!Array.isArray(sentences)) {
    throw invalid("invalid-program", "VLIW program lowering requires an array of parsed Pyash sentences");
  }
  const lowered = sentences.map(lowerPyashSentence);
  return {
    sentenceCount: lowered.length,
    vectors: lowered.flatMap((sentence) => sentence.vectors),
    sentences: lowered
  };
}

function groupVectors(vectors) {
  if (!Array.isArray(vectors) || vectors.length === 0) {
    throw invalid("invalid-program", "VLIW decoding requires one or more codelet vectors");
  }
  const groups = [];
  let group = [];
  for (const [index, vector] of vectors.entries()) {
    if (!(vector instanceof Uint16Array) && !Array.isArray(vector)) {
      throw invalid("invalid-codelet", "VLIW program contains a non-vector codelet", { index });
    }
    group.push(vector);
    const head = Number(vector[0]);
    if (head & 1) {
      groups.push(group);
      group = [];
    }
  }
  if (group.length > 0) {
    throw invalid("missing-continuation", "VLIW program ends before a codelet completion index");
  }
  return groups;
}

function boundaryOffsetsFor(vectors) {
  const offsets = new Set();
  vectors.forEach((vector, vectorIndex) => {
    const head = Number(vector[0]);
    const completion = Boolean(head & 1);
    for (let slot = 1; slot < WORD_COUNT; slot += 1) {
      const marked = Boolean(head & (1 << slot));
      if (marked === completion) offsets.add(vectorIndex * PAYLOAD_WORDS + slot);
    }
  });
  return offsets;
}

function wordName(word, role) {
  if (word === THIS_WORD) return "this";
  if (word === wordForEntry("multiplicative_case_")) return "fromindex";
  if (word === wordForEntry("toindex_")) return "toindex";
  const entry = ENTRIES_BY_HNUC.get(word);
  if (entry?.en && !entry.en.endsWith("_")) return entry.en;
  throw invalid("unrepresentable-name", `VLIW ${role} HNUC has no recoverable vocabulary name`, {
    role,
    word: `0x${word.toString(16).padStart(4, "0")}`
  });
}

function decodeValue(items, role) {
  if (items.length === 1 && items[0].kind === "quote") {
    const { word, value } = items[0].quote;
    if (word === NUMBER_QUOTE_WORD && Number.isInteger(value) && value >= 0 && value <= 0xffff) {
      return { num: value };
    }
    if (word === PARAGRAPH_LETTER_QUOTE_WORD && typeof value === "string" && value.length > 0) {
      return { text: value };
    }
    throw invalid("unsupported-value", `VLIW ${role} value has an unsupported quote type`, {
      quoteWord: word
    });
  }
  const words = items.filter((item) => item.kind === "word").map((item) => item.word);
  if (words.length !== items.length) {
    throw invalid("unsupported-value", `VLIW ${role} value mixes quote payloads and lexical words`);
  }
  if (words[0] === NAME_TYPE) {
    if (words.length < 2) throw invalid("unsupported-value", `VLIW ${role} name phrase is empty`);
    return { name: words.slice(1).map((word) => wordName(word, role)).join(" ") };
  }
  const genitiveParts = [];
  let segment = [];
  for (const word of words) {
    if (word === GENITIVE_CASE) {
      if (segment.length !== 1) {
        throw invalid("unsupported-value", `VLIW ${role} genitive segment is not one HNUC`);
      }
      genitiveParts.push(wordName(segment[0], role));
      segment = [];
    } else {
      segment.push(word);
    }
  }
  if (genitiveParts.length > 0) {
    if (segment.length !== 1) throw invalid("unsupported-value", `VLIW ${role} genitive tail is not one HNUC`);
    genitiveParts.push(wordName(segment[0], role));
    return { genitive: { chain: genitiveParts } };
  }
  if (words.length === 1) {
    const truth = lookupLegacyName("truth");
    const lie = lookupLegacyName("lie");
    if (words[0] === Number.parseInt(truth?.hnuc, 16)) return { boolean: true };
    if (words[0] === Number.parseInt(lie?.hnuc, 16)) return { boolean: false };
  }
  throw invalid("unsupported-value", `VLIW ${role} phrase has no supported typed value`);
}

function sentenceFromClause(fields, verb, mood) {
  return { ...fields, be: verb, mood };
}

function decodeClauseItems(items, boundaryOffsets) {
  const fields = {};
  let pending = [];
  for (const item of items) {
    const isBoundary = boundaryOffsets.has(item.offset);
    if (isBoundary && item.kind === "word" && ROLE_BY_WORD.has(item.word)) {
      const role = ROLE_BY_WORD.get(item.word);
      if (Object.hasOwn(fields, role)) throw invalid("duplicate-case", `VLIW sentence repeats the ${role} case`);
      fields[role] = decodeValue(pending, role);
      pending = [];
      continue;
    }
    if (isBoundary && item.kind === "word" && MOOD_BY_WORD.has(item.word)) {
      if (pending.length !== 1 || pending[0].kind !== "word") {
        throw invalid("unsupported-sentence", "VLIW sentence must end each clause with one verb and one mood");
      }
      return {
        sentence: sentenceFromClause(fields, wordName(pending[0].word, "verb"), MOOD_BY_WORD.get(item.word)),
        nextIndex: item.offset + 1
      };
    }
    pending.push(item);
  }
  throw invalid("unsupported-sentence", "VLIW sentence is missing a marked mood boundary");
}

function decodeSentenceGroup(vectors) {
  const decoded = decodeLegacyCodeletSequence(vectors);
  const boundaryOffsets = boundaryOffsetsFor(vectors);
  const items = decoded.items.filter((item) => item.offset !== 0);
  const clauses = [];
  let start = 0;
  while (start < items.length) {
    const clause = decodeClauseItems(items.slice(start), boundaryOffsets);
    clauses.push(clause.sentence);
    start = items.findIndex((item) => item.offset >= clause.nextIndex);
    if (start < 0) break;
  }
  if (clauses.length === 0) throw invalid("unsupported-sentence", "VLIW codelet contains no Pyash clause");
  let sentence = clauses.at(-1);
  for (let index = clauses.length - 2; index >= 0; index -= 1) {
    const condition = clauses[index];
    if (condition.mood !== "then") {
      throw invalid("unsupported-sentence", "multiple VLIW clauses require a conditional mood between them");
    }
    sentence = {
      ...condition,
      mood: sentence.mood,
      consequence: sentence
    };
  }
  return sentence;
}

export function decodePyashProgram(vectors) {
  return groupVectors(vectors).map(decodeSentenceGroup);
}

export function decodePyashProgramOrNull(vectors) {
  try {
    return decodePyashProgram(vectors);
  } catch (error) {
    if (error instanceof VliwCodeletError || error?.name === "VliwSentenceError") return null;
    throw error;
  }
}
