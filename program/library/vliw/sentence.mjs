import pyashWords from "../pyashWords.json" with { type: "json" };
import { decodeLegacyCodeletGroups, VliwCodeletError } from "./codelets.mjs";
import {
  INT_SORT_DENOTE,
  LETTER_QUOTE_WORD,
  NUMBER_QUOTE_WORD,
  PARAGRAPH_LETTER_QUOTE_WORD,
  float32QuoteWords,
  QUOTED_GRAMMAR_WORD,
  UINT_SORT_DENOTE,
  VECTOR_THICK_LONG,
  isIntVectorQuoteWord,
  isLetterQuoteWord,
  isUintVectorQuoteWord,
  lookupLegacyName,
  lookupLegacyWord,
  lookupLegacyWordSequence,
  quoteWordFor,
  vectorThicknessFor
} from "./quotes.mjs";
import { encodePyacWord } from "./word_code.mjs";

const WORD_COUNT = 16;
const PAYLOAD_WORDS = WORD_COUNT - 1;
const RAW_BLOCKQUOTE_MIN_WORDS = 15;
const NAME_TYPE = wordForEntry("name_");
const GENITIVE_CASE = wordForEntry("genitive_case_");
const CONDITIONAL_MOOD = wordForEntry("conditional_mood_");
const DEPENDENT_CLAUSE = wordForEntry("dependent_clause_");
const CLAUSE_TAIL = wordForEntry("clause_tail_");

const ROLE_ENTRIES = Object.freeze({
  su: "nominative_case_",
  ob: "accusative_case_",
  as: "essive_case_",
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
  then: "conditional_mood_",
  ret: "return"
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
const TYPE_ENTRY_BY_SURFACE = Object.freeze({
  num: "number_",
  number: "number_",
  bool: "boolean_",
  boolean: "boolean_",
  text: "text_"
});
const OPERATOR_ENTRY_BY_SURFACE = Object.freeze({
  divide: "divisions",
  xor: "exclusive_or",
  not: "negatory_quantifier_",
  and: "and_",
  or: "and_or_"
});
const OPERATOR_SURFACE_BY_WORD = new Map(
  Object.entries(OPERATOR_ENTRY_BY_SURFACE).map(([surface, entry]) => [wordForEntry(entry), surface])
);
const TYPE_SURFACE_BY_WORD = new Map([
  [wordForEntry("number_"), "num"],
  [wordForEntry("boolean_"), "bool"],
  [wordForEntry("text_"), "text"]
]);

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
  if (ROLE_ENTRIES[token]) return wordForEntry(ROLE_ENTRIES[token]);
  const entry = lookupLegacyName(token);
  if (entry?.hnuc) return Number.parseInt(entry.hnuc, 16);
  const typeEntry = TYPE_ENTRY_BY_SURFACE[String(token).toLowerCase()];
  if (typeEntry) return wordForEntry(typeEntry);
  throw invalid("unrepresentable-name", `VLIW ${role} name has no vocabulary HNUC`, {
    role,
    token
  });
}

function nameWords(value, role) {
  if (typeof value !== "string" || !value.trim()) {
    throw invalid("invalid-name", `VLIW ${role} requires a non-empty name`);
  }
  return value.trim().split(/\s+/u).flatMap((token) => {
    const sequence = lookupLegacyWordSequence(token);
    return sequence
      ? sequence.map((entry) => Number.parseInt(entry.hnuc, 16))
      : [nameWord(token, role)];
  });
}

function typeWords(values, role) {
  return (Array.isArray(values) ? values : []).map((token) => {
    const entryName = TYPE_ENTRY_BY_SURFACE[String(token).trim().toLowerCase()];
    if (!entryName) {
      throw invalid("unsupported-name-type", `VLIW ${role} name type has no vocabulary HNUC`, {
        role,
        token
      });
    }
    return wordForEntry(entryName);
  });
}

function textWords(value, role) {
  const chars = Array.from({ length: value.length }, (_, index) => value.charCodeAt(index));
  if (chars.length === 0) throw invalid("unsupported-value", `VLIW ${role} text quote cannot be empty`);
  return {
    words: [PARAGRAPH_LETTER_QUOTE_WORD, chars.length, ...chars],
    rawQuotes: chars.length >= RAW_BLOCKQUOTE_MIN_WORDS
      ? [{ payloadStart: 2, payloadWords: chars.length }]
      : []
  };
}

function quoteKindFrame(value, payload, role) {
  const tag = textWords(value, `${role} quote kind`);
  const tagStart = 2;
  const payloadStart = tagStart + tag.words.length + 1;
  const closingTagStart = payloadStart + payload.words.length + 1;
  const words = [
    QUOTED_GRAMMAR_WORD,
    0,
    ...tag.words,
    0,
    ...payload.words,
    0,
    ...tag.words,
    0,
    QUOTED_GRAMMAR_WORD
  ];
  const rawQuotes = [
    ...tag.rawQuotes.map((quote) => ({ ...quote, payloadStart: tagStart + quote.payloadStart })),
    ...payload.rawQuotes.map((quote) => ({ ...quote, payloadStart: payloadStart + quote.payloadStart })),
    ...tag.rawQuotes.map((quote) => ({ ...quote, payloadStart: closingTagStart + quote.payloadStart }))
  ];
  return { words, rawQuotes };
}

function encodeVectorValue(vector, role) {
  if (!vector || typeof vector !== "object" || !Array.isArray(vector.values)) {
    throw invalid("unsupported-vector", `VLIW ${role} vector requires a typed values list`);
  }
  const type = vector.type ?? "num";
  if (!["num", "bool", "float32", "float64", "text"].includes(type)) {
    throw invalid("unsupported-vector-type", `VLIW ${role} vector type is unsupported`, { type });
  }
  if (vector.values.length < 2 || vector.values.length > 0xffff) {
    throw invalid("unsupported-vector-width", `VLIW ${role} vector length must be between 2 and 65535`, {
      count: vector.values.length
    });
  }

  if (type === "text") {
    const words = [];
    const rawQuotes = [];
    for (const value of vector.values) {
      if (typeof value !== "string" || value.length === 0) {
        throw invalid("unsupported-vector-value", "VLIW text vector elements must be non-empty strings", {
          value
        });
      }
      const start = words.length;
      if (value.length === 1) {
        words.push(LETTER_QUOTE_WORD, value.charCodeAt(0));
      } else {
        const encoded = textWords(value, role);
        words.push(...encoded.words);
        rawQuotes.push(...encoded.rawQuotes.map((quote) => ({
          ...quote,
          payloadStart: start + quote.payloadStart
        })));
      }
    }
    return { words, rawQuotes };
  }

  if (type === "float32" || type === "float64") {
    const scalarBytes = type === "float32" ? 4 : 8;
    const scalarWords = scalarBytes / 2;
    const payload = vector.values.flatMap((value) => {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw invalid("non-finite-float", `VLIW ${type} vector elements must be finite numbers`, { value });
      }
      const normalized = type === "float32" ? Math.fround(value) : value;
      if (!Number.isFinite(normalized)) {
        throw invalid("non-finite-float", `VLIW ${type} vector element is outside its finite range`, { value });
      }
      const view = new DataView(new ArrayBuffer(scalarBytes));
      if (scalarBytes === 4) view.setFloat32(0, normalized, true);
      else view.setFloat64(0, normalized, true);
      return Array.from({ length: scalarWords }, (_, index) => view.getUint16(index * 2, true));
    });
    const thickness = vectorThicknessFor(vector.values.length);
    const quote = quoteWordFor({
      sort: 6,
      vectorThick: thickness,
      scalarBytes
    });
    return {
      words: [quote, ...(thickness === VECTOR_THICK_LONG ? [vector.values.length] : []), ...payload],
      rawQuotes: []
    };
  }

  const sort = type === "num" ? UINT_SORT_DENOTE : INT_SORT_DENOTE;
  const payload = vector.values.map((value) => {
    if (type === "num" && Number.isInteger(value) && value >= 0 && value <= 0xffff) return value;
    if (type === "bool" && (value === "truth" || value === true)) return 1;
    if (type === "bool" && (value === "lie" || value === false)) return 0;
    throw invalid("unsupported-vector-value", `VLIW ${type} vector element is invalid`, { value });
  });
  const thickness = vectorThicknessFor(payload.length);
  const quote = quoteWordFor({ sort, vectorThick: thickness, scalarBytes: 2 });
  return {
    words: [quote, ...(thickness === VECTOR_THICK_LONG ? [payload.length] : []), ...payload],
    rawQuotes: []
  };
}

function encodeValue(value, role) {
  if (value?.la && typeof value.la === "object") {
    const nested = encodeClause(value.la);
    return {
      words: [DEPENDENT_CLAUSE, ...nested.words, CLAUSE_TAIL],
      boundaries: nested.boundaries.map((offset) => offset + 1),
      rawQuotes: nested.rawQuotes.map((quote) => ({
        ...quote,
        payloadStart: quote.payloadStart + 1
      }))
    };
  }
  if (Number.isInteger(value?.num) && !Object.is(value.num, -0) && value.num >= 0 && value.num <= 0xffff) {
    return { words: [NUMBER_QUOTE_WORD, value.num], rawQuotes: [] };
  }
  if (typeof value?.num === "number") {
    return { words: float32QuoteWords(value.num), rawQuotes: [] };
  }
  if (typeof value?.text === "string") {
    return textWords(value.text, role);
  }
  if (value?.ve !== undefined) {
    return encodeVectorValue(value.ve, role);
  }
  if (typeof value?.boolean === "boolean") {
    return { words: [wordForEntry(value.boolean ? "truth" : "lie")], rawQuotes: [] };
  }
  if (typeof value?.name === "string") {
    const types = typeWords(value.nameTypeWords, role);
    return {
      words: [NAME_TYPE, ...types, ...(types.length ? [NAME_TYPE] : []), ...nameWords(value.name, role)],
      rawQuotes: []
    };
  }
  if (Array.isArray(value?.genitive?.chain) && value.genitive.chain.length > 0) {
    const encoded = [];
    for (const [index, item] of value.genitive.chain.entries()) {
      if (index > 0) encoded.push(GENITIVE_CASE);
      encoded.push(nameWord(item, role));
    }
    return { words: encoded, rawQuotes: [] };
  }
  throw invalid("unsupported-value", `VLIW ${role} value has no supported quote or name form`, {
    value
  });
}

function encodeClause(sentence, { conditional = false } = {}) {
  const isReturn = sentence?.mood === "ret" && sentence.be === undefined;
  const isParagraphEnd = sentence?.mood === "prah" && sentence.be === undefined;
  if (
    !sentence
    || typeof sentence !== "object"
    || (!isReturn && !isParagraphEnd && typeof sentence.be !== "string")
  ) {
    throw invalid("unsupported-sentence", "VLIW sentence requires a verb and a parsed Pyash sentence");
  }

  const words = [];
  const boundaries = [];
  const rawQuotes = [];
  for (const role of FIELD_ORDER) {
    const returnValue = isReturn && sentence.ret?.role === role
      ? sentence.ret.name
        ? { name: sentence.ret.name }
        : sentence.ret.num !== undefined
          ? { num: sentence.ret.num }
          : sentence.ret.genitive
            ? { genitive: sentence.ret.genitive }
            : undefined
      : undefined;
    const fieldValue = sentence[role] ?? returnValue;
    if (fieldValue === undefined) continue;
    let value = encodeValue(fieldValue, role);
    const quoteKind = sentence.quoteKinds?.[role];
    if (quoteKind !== undefined) {
      if (typeof sentence[role]?.text !== "string" || typeof quoteKind !== "string" || !quoteKind) {
        throw invalid("invalid-quote-kind", `VLIW ${role} quote kind requires a text value and non-empty kind`);
      }
      value = quoteKindFrame(quoteKind, value, role);
    }
    const valueStart = words.length;
    words.push(...value.words);
    boundaries.push(...(value.boundaries ?? []).map((offset) => valueStart + offset));
    rawQuotes.push(...value.rawQuotes.map((quote) => ({
      ...quote,
      payloadStart: valueStart + quote.payloadStart
    })));
    const caseWord = wordForEntry(ROLE_ENTRIES[role]);
    words.push(caseWord);
    boundaries.push(words.length);
  }

  if (!isReturn && !isParagraphEnd) {
    const verbTokens = String(sentence.be).trim().split(/\s+/u);
    const verbs = verbTokens.map((token) => lookupLegacyWordSequence(OPERATOR_ENTRY_BY_SURFACE[token] ?? token));
    const missingIndex = verbs.findIndex((sequence) => !sequence);
    if (missingIndex >= 0) {
      throw invalid("unrepresentable-verb", `VLIW verb has no vocabulary HNUC (${verbTokens[missingIndex]})`, {
        verb: sentence.be,
        token: verbTokens[missingIndex]
      });
    }
    words.push(...verbs.flatMap((sequence) => sequence.map((verb) => Number.parseInt(verb.hnuc, 16))));
  }
  const mood = isReturn ? "ret" : conditional ? "then" : sentence.mood;
  const moodEntry = MOOD_ENTRIES[mood];
  if (!moodEntry) throw invalid("unsupported-mood", `VLIW sentence mood is unsupported (${mood})`, { mood });
  words.push(wordForEntry(moodEntry));
  boundaries.push(words.length);
  return { words, boundaries, rawQuotes };
}

function encodeSentenceWords(sentence) {
  if (sentence?.exists === true) {
    // `exists` is declaration sugar; the named typed fact carries the same
    // declaration semantics in the legacy quote/case representation.
  }
  if (sentence?.alternative) {
    if (!sentence.consequence) {
      throw invalid("unsupported-branch", "VLIW alternative requires a conditional consequence");
    }
    if ([sentence.consequence, sentence.alternative].some((branch) => branch?.consequence || branch?.alternative)) {
      throw invalid("nested-branch", "VLIW first milestone does not encode nested conditional branches");
    }
    const clauses = [
      encodeClause(sentence, { conditional: true }),
      encodeClause(sentence.consequence),
      encodeClause(sentence.alternative)
    ];
    const words = [];
    const boundaries = new Set();
    const rawQuotes = [];
    for (const clause of clauses) {
      for (const offset of clause.boundaries) boundaries.add(words.length + offset);
      rawQuotes.push(...clause.rawQuotes.map((quote) => ({
        ...quote,
        payloadStart: words.length + quote.payloadStart
      })));
      words.push(...clause.words);
    }
    return { words, boundaries, rawQuotes };
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
  const rawQuotes = [];
  for (const clause of clauses) {
    for (const offset of clause.boundaries) boundaries.add(words.length + offset);
    rawQuotes.push(...clause.rawQuotes.map((quote) => ({
      ...quote,
      payloadStart: words.length + quote.payloadStart
    })));
    words.push(...clause.words);
  }
  if (words.length === 0) throw invalid("unsupported-sentence", "VLIW sentence encoded no words");
  return { words, boundaries, rawQuotes };
}

function vectorsFor(words, boundaryOffsets, rawQuotes = []) {
  const pieces = [];
  let cursor = 0;
  for (const quote of rawQuotes.slice().sort((left, right) => left.payloadStart - right.payloadStart)) {
    const payloadStart = quote.payloadStart;
    const payloadEnd = payloadStart + quote.payloadWords;
    if (payloadStart < cursor || payloadEnd > words.length) {
      throw invalid("invalid-blockquote", "long quote payload ranges overlap or exceed the sentence", { quote });
    }
    pieces.push({ kind: "indexed", start: cursor, words: words.slice(cursor, payloadStart) });
    pieces.push({ kind: "raw", start: payloadStart, words: words.slice(payloadStart, payloadEnd) });
    cursor = payloadEnd;
  }
  pieces.push({ kind: "indexed", start: cursor, words: words.slice(cursor) });

  const indexedChunkCount = pieces
    .filter((piece) => piece.kind === "indexed")
    .reduce((count, piece) => count + Math.ceil(piece.words.length / PAYLOAD_WORDS), 0);
  let indexedChunkIndex = 0;
  const vectors = [];
  for (const piece of pieces) {
    if (piece.kind === "raw") {
      for (let start = 0; start < piece.words.length; start += WORD_COUNT) {
        const vector = new Uint16Array(WORD_COUNT);
        vector.set(piece.words.slice(start, start + WORD_COUNT));
        vectors.push(vector);
      }
      continue;
    }
    for (let offset = 0; offset < piece.words.length; offset += PAYLOAD_WORDS) {
      const chunk = piece.words.slice(offset, offset + PAYLOAD_WORDS);
      indexedChunkIndex += 1;
      const complete = indexedChunkIndex === indexedChunkCount;
      const vector = new Uint16Array(WORD_COUNT);
      for (let index = 0; index < chunk.length; index += 1) {
        vector[index + 1] = chunk[index];
        const isBoundary = boundaryOffsets.has(piece.start + offset + index + 1);
        if (isBoundary === complete) vector[0] |= 1 << (index + 1);
      }
      if (complete) vector[0] |= 1;
      vectors.push(vector);
    }
  }
  return vectors;
}

export function lowerPyashSentence(sentence) {
  const encoded = encodeSentenceWords(sentence);
  return {
    sentence,
    words: encoded.words,
    vectors: vectorsFor(encoded.words, encoded.boundaries, encoded.rawQuotes),
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

function wordName(word, role) {
  if (word === THIS_WORD) return "this";
  if (word === wordForEntry("multiplicative_case_")) return "fromindex";
  if (word === wordForEntry("toindex_")) return "toindex";
  if (ROLE_BY_WORD.has(word)) return ROLE_BY_WORD.get(word);
  if (TYPE_SURFACE_BY_WORD.has(word)) return TYPE_SURFACE_BY_WORD.get(word);
  if (role === "verb" && OPERATOR_SURFACE_BY_WORD.has(word)) return OPERATOR_SURFACE_BY_WORD.get(word);
  const entry = ENTRIES_BY_HNUC.get(word);
  if (entry?.en && !entry.en.endsWith("_")) return entry.en;
  throw invalid("unrepresentable-name", `VLIW ${role} HNUC has no recoverable vocabulary name`, {
    role,
    word: `0x${word.toString(16).padStart(4, "0")}`
  });
}

function decodeValue(items, role, boundaryOffsets) {
  if (
    items.length >= 3
    && items[0].kind === "word"
    && items[0].word === DEPENDENT_CLAUSE
    && items.at(-1).kind === "word"
    && items.at(-1).word === CLAUSE_TAIL
  ) {
    const nested = decodeClauseItems(items.slice(1, -1), boundaryOffsets);
    if (nested.nextIndex !== items.at(-1).offset) {
      throw invalid("malformed-dependent-clause", `VLIW ${role} dependent clause has trailing content`);
    }
    return { la: nested.sentence };
  }
  if (
    items.length === 1
    && items[0].kind === "tagged-quote"
  ) {
    const frame = items[0];
    if (frame.hashQuote) {
      throw invalid("unsupported-quote-hash-profile", "VLIW quote hash has no configured verification profile", {
        role
      });
    }
    if (typeof frame.quote.value !== "string") {
      throw invalid("invalid-quote-kind", `VLIW ${role} quote kind does not annotate a text payload`);
    }
    return {
      quotedKind: frame.tag,
      quotedValue: { text: frame.quote.value }
    };
  }
  if (items.length === 1 && items[0].kind === "quote") {
    const { word, value } = items[0].quote;
    if (isUintVectorQuoteWord(word) && Array.isArray(value)) {
      return { ve: { type: "num", values: value } };
    }
    if (isIntVectorQuoteWord(word) && Array.isArray(value)) {
      return { ve: { type: "bool", values: value.map((item) => item === 0 ? "lie" : "truth") } };
    }
    if ((items[0].quote.family === "float32-vector" || items[0].quote.family === "float64-vector") && Array.isArray(value)) {
      return { ve: { type: items[0].quote.family === "float32-vector" ? "float32" : "float64", values: value } };
    }
    if (["float32", "float64", "fixed16"].includes(items[0].quote.family) && typeof value === "number") {
      return { num: value };
    }
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
  if (
    items.length > 1 &&
    items.every((item) => item.kind === "quote" && isLetterQuoteWord(item.quote.word))
  ) {
    return {
      ve: {
        type: "text",
        values: items.map((item) => item.quote.value)
      }
    };
  }
  const words = items.filter((item) => item.kind === "word").map((item) => item.word);
  if (words.length !== items.length) {
    throw invalid("unsupported-value", `VLIW ${role} value mixes quote payloads and lexical words`);
  }
  if (words[0] === NAME_TYPE) {
    const typeMarker = words.indexOf(NAME_TYPE, 1);
    const encodedTypes = typeMarker < 0 ? [] : words.slice(1, typeMarker);
    const nameStart = typeMarker < 0 ? 1 : typeMarker + 1;
    if (nameStart >= words.length) throw invalid("unsupported-value", `VLIW ${role} name phrase is empty`);
    const nameTypeWords = encodedTypes.map((word) => TYPE_SURFACE_BY_WORD.get(word));
    if (nameTypeWords.some((type) => !type)) {
      throw invalid("unsupported-name-type", `VLIW ${role} name type has no recoverable surface`);
    }
    return {
      name: words.slice(nameStart).map((word) => wordName(word, role)).join(" "),
      ...(nameTypeWords.length ? { nameTypeWords } : {})
    };
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

function sentenceFromClause(fields, verb, mood, quoteKinds) {
  return {
    ...fields,
    ...(verb !== undefined ? { be: verb } : {}),
    mood,
    ...(Object.keys(quoteKinds).length > 0 ? { quoteKinds } : {})
  };
}

function decodeClauseItems(items, boundaryOffsets) {
  const fields = {};
  const quoteKinds = {};
  let pending = [];
  let cursor = 0;
  while (cursor < items.length) {
    const item = items[cursor];
    if (item.kind === "word" && item.word === DEPENDENT_CLAUSE) {
      let depth = 1;
      let tail = cursor + 1;
      for (; tail < items.length; tail += 1) {
        if (items[tail].kind !== "word") continue;
        if (items[tail].word === DEPENDENT_CLAUSE) depth += 1;
        else if (items[tail].word === CLAUSE_TAIL && --depth === 0) break;
      }
      if (tail >= items.length) {
        throw invalid("malformed-dependent-clause", "VLIW dependent clause is missing its clause tail");
      }
      pending.push(...items.slice(cursor, tail + 1));
      cursor = tail + 1;
      continue;
    }
    const isBoundary = boundaryOffsets.has(item.offset);
    if (isBoundary && item.kind === "word" && ROLE_BY_WORD.has(item.word)) {
      const role = ROLE_BY_WORD.get(item.word);
      if (Object.hasOwn(fields, role)) throw invalid("duplicate-case", `VLIW sentence repeats the ${role} case`);
      const value = decodeValue(pending, role, boundaryOffsets);
      if (Object.hasOwn(value, "quotedKind")) {
        fields[role] = value.quotedValue;
        quoteKinds[role] = value.quotedKind;
      } else {
        fields[role] = value;
      }
      pending = [];
      cursor += 1;
      continue;
    }
    if (isBoundary && item.kind === "word" && MOOD_BY_WORD.has(item.word)) {
      const mood = MOOD_BY_WORD.get(item.word);
      if ((mood === "ret" || mood === "prah") && pending.length === 0) {
        return {
          sentence: sentenceFromClause(fields, undefined, mood, quoteKinds),
          nextIndex: item.offset + 1
        };
      }
      if (pending.length < 1 || pending.some((entry) => entry.kind !== "word")) {
        throw invalid("unsupported-sentence", "VLIW sentence must end each clause with one verb and one mood");
      }
      return {
        sentence: sentenceFromClause(
          fields,
          pending.map((entry) => wordName(entry.word, "verb")).join(" "),
          mood,
          quoteKinds
        ),
        nextIndex: item.offset + 1
      };
    }
    pending.push(item);
    cursor += 1;
  }
  throw invalid("unsupported-sentence", "VLIW sentence is missing a marked mood boundary");
}

function decodeSentenceGroup(decoded) {
  const boundaryOffsets = decoded.boundaryOffsets;
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
  if (
    clauses.length === 3
    && clauses[0].mood === "then"
    && clauses[1].mood !== "then"
    && clauses[2].mood !== "then"
  ) {
    const [condition, consequence, alternative] = clauses;
    if (consequence.mood !== alternative.mood) {
      throw invalid("branch-mood-mismatch", "VLIW conditional branches must have matching moods");
    }
    return {
      ...condition,
      mood: "do",
      consequence,
      alternative
    };
  }
  let sentence = clauses.at(-1);
  for (let index = clauses.length - 2; index >= 0; index -= 1) {
    const condition = clauses[index];
    if (condition.mood !== "then") {
      throw invalid("unsupported-sentence", "multiple VLIW clauses require a conditional mood between them");
    }
    sentence = {
      ...condition,
      mood: "do",
      consequence: sentence
    };
  }
  return sentence;
}

export function decodePyashProgram(vectors) {
  if (!Array.isArray(vectors) || vectors.length === 0) {
    throw invalid("invalid-program", "VLIW decoding requires one or more codelet vectors");
  }
  return decodeLegacyCodeletGroups(vectors).map(decodeSentenceGroup);
}

export function decodePyashProgramOrNull(vectors) {
  try {
    return decodePyashProgram(vectors);
  } catch (error) {
    if (error instanceof VliwCodeletError || error?.name === "VliwSentenceError") return null;
    throw error;
  }
}
