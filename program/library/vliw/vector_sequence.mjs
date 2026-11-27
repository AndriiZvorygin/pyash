import {
  ACCUSATIVE_CASE_WORD,
  NOMINATIVE_CASE_WORD,
  REALIS_MOOD_WORD,
  encodingError,
  normalizeLiteralName
} from "./literal_layout.mjs";
import { CODELET_WORD_COUNT, decodeLegacyCodeletGroups } from "./codelets.mjs";
import { encodeFixedVectorPayload, normalizeVectorSentence } from "./vector.mjs";
import { encodeTextArrayMembers } from "./text_array.mjs";
import {
  LETTER_SORT_DENOTE,
  LETTER_QUOTE_WORD,
  PARAGRAPH_LETTER_QUOTE_WORD,
  VECTOR_THICK_LONG,
  decodeQuote,
  isFloatVectorQuoteWord,
  isIntVectorQuoteWord,
  isLetterQuoteWord,
  isUintVectorQuoteWord,
  lookupLegacyWord,
  quoteWordFor
} from "./quotes.mjs";

function indexedVector(words, start, complete, boundaries) {
  const vector = new Uint16Array(CODELET_WORD_COUNT);
  const chunk = words.slice(start, Math.min(start + CODELET_WORD_COUNT - 1, words.length));
  vector.set(chunk, 1);
  vector[0] = complete ? 1 : 0;
  for (let offset = 0; offset < chunk.length; offset += 1) {
    if (boundaries.has(start + offset) === complete) vector[0] |= 1 << (offset + 1);
  }
  return vector;
}

export function lowerVectorSequence(sentence) {
  const { normalized, type, payload } = normalizeVectorSentence(sentence);
  const nameWords = normalized.su ? normalizeLiteralName(normalized.su).words : [];
  const encoded = type === "text"
    ? {
      quoteWord: quoteWordFor({
        sort: LETTER_SORT_DENOTE,
        vectorThick: VECTOR_THICK_LONG,
        scalarBytes: 2,
        sequence: true
      }),
      lengthWord: payload.length,
      payloadWords: encodeTextArrayMembers(payload, {
        letterQuoteWord: LETTER_QUOTE_WORD,
        paragraphQuoteWord: PARAGRAPH_LETTER_QUOTE_WORD
      })
    }
    : encodeFixedVectorPayload(type, payload);
  const prefix = [...nameWords];
  const boundaries = new Set();
  if (nameWords.length > 0) {
    prefix.push(NOMINATIVE_CASE_WORD);
    boundaries.add(prefix.length);
  }
  prefix.push(encoded.quoteWord);
  if (encoded.lengthWord !== null) prefix.push(encoded.lengthWord);
  const words = [0, ...prefix, ...encoded.payloadWords, ACCUSATIVE_CASE_WORD, REALIS_MOOD_WORD];
  boundaries.add(1 + prefix.length + encoded.payloadWords.length);
  boundaries.add(2 + prefix.length + encoded.payloadWords.length);
  const vectors = [];
  for (let offset = 1; offset < words.length; offset += CODELET_WORD_COUNT - 1) {
    vectors.push(indexedVector(
      words,
      offset,
      offset + CODELET_WORD_COUNT - 1 >= words.length,
      boundaries
    ));
  }
  return vectors.map((vector) => ({ sentence: normalized, words: vector, semantic: "vector-literal" }));
}

function decodeVectorGroup(group) {
  const words = group.words;
  let quoteOffset = -1;
  for (let offset = 1; offset < group.usedWords; offset += 1) {
    if (isUintVectorQuoteWord(words[offset]) || isIntVectorQuoteWord(words[offset])
      || isFloatVectorQuoteWord(words[offset]) || isLetterQuoteWord(words[offset])) {
      quoteOffset = offset;
      break;
    }
  }
  if (quoteOffset < 0) throw encodingError("malformed-codelet", "continued vector has no vector quote");

  let name = null;
  if (quoteOffset > 1) {
    if (words[quoteOffset - 1] !== NOMINATIVE_CASE_WORD) {
      throw encodingError("malformed-codelet", "continued named vector has no nominative case");
    }
    name = Array.from(words.slice(1, quoteOffset - 1), (word) => {
      const entry = lookupLegacyWord(word);
      if (!entry?.en) throw encodingError("unrepresentable-name", "continued vector name has an unknown word", { word });
      return entry.en;
    }).join(" ");
  }

  const values = [];
  let type = null;
  let cursor = quoteOffset;
  while (cursor < group.usedWords && words[cursor] !== ACCUSATIVE_CASE_WORD) {
    const quote = decodeQuote(words, cursor);
    if (isUintVectorQuoteWord(quote.word)) {
      type = "num";
      values.push(...quote.payload);
    } else if (isIntVectorQuoteWord(quote.word)) {
      type = "bool";
      values.push(...quote.payload.map((value) => value === 0 ? "lie" : "truth"));
    } else if (isFloatVectorQuoteWord(quote.word)) {
      type = quote.family === "float32-vector" ? "float32" : "float64";
      values.push(...quote.value);
    } else if (isLetterQuoteWord(quote.word)) {
      type = "text";
      values.push(...(quote.family === "text-array" ? quote.value : [quote.value]));
    } else {
      throw encodingError("malformed-codelet", "continued vector contains an unsupported quote", {
        family: quote.family
      });
    }
    cursor = quote.nextOffset;
  }
  if (words[cursor] !== ACCUSATIVE_CASE_WORD || words[cursor + 1] !== REALIS_MOOD_WORD
    || cursor + 2 !== group.usedWords) {
    throw encodingError("malformed-codelet", "continued vector has invalid closing case or mood");
  }
  const sentence = { mood: "ya", ob: { ve: { type, values } }, be: "vector" };
  if (name) sentence.su = { name };
  return sentence;
}

export function decodeVectorSequence(input) {
  const groups = decodeLegacyCodeletGroups(input);
  if (groups.length !== 1) {
    throw encodingError("malformed-codelet", "a vector sequence must contain exactly one continued literal");
  }
  return decodeVectorGroup(groups[0]);
}
