import {
  buildLiteralCodelet,
  decodeLiteralCodelet,
  encodingError,
  normalizeLiteralName
} from "./literal_layout.mjs";
import {
  INT_SORT_DENOTE,
  isIntVectorQuoteWord,
  isLetterQuoteWord,
  isUintVectorQuoteWord,
  LETTER_QUOTE_WORD,
  PARAGRAPH_LETTER_QUOTE_WORD,
  quoteWordFor,
  UINT_SORT_DENOTE,
  VECTOR_THICK_LONG,
  vectorThicknessFor
} from "./quotes.mjs";

// A vector travels as a quote whose vector thickness states how many elements
// it holds. The legacy quote sort says how to read the payload, so the sort
// carries the element type: the unsigned integer sort for numbers and the
// signed integer sort for booleans.
//
// A text vector cannot use one region, because the legacy quote sorts hold
// fixed-width elements and a text element is a string. It uses one region per
// element instead, the way the legacy codelet holds several values at once.
export const VECTOR_MIN_ELEMENTS = 2;
export const VECTOR_MAX_ELEMENTS = 11;
export const TEXT_VECTOR_MAX_ELEMENTS = 6;

export const VECTOR_SORTS = Object.freeze({
  num: UINT_SORT_DENOTE,
  bool: INT_SORT_DENOTE
});

export const vectorCompatibility = Object.freeze({
  minElements: VECTOR_MIN_ELEMENTS,
  maxElements: VECTOR_MAX_ELEMENTS,
  textMaxElements: TEXT_VECTOR_MAX_ELEMENTS,
  scalarBytes: 2,
  sorts: VECTOR_SORTS
});

export function vectorQuoteWord(type, count) {
  return quoteWordFor({
    sort: VECTOR_SORTS[type],
    vectorThick: vectorThicknessFor(count),
    scalarBytes: 2
  });
}

export function vectorUsesExplicitLength(count) {
  return vectorThicknessFor(count) === VECTOR_THICK_LONG;
}

function readNumbers(values) {
  return values.map((value) => {
    if (!Number.isInteger(value) || value < 0 || value > 0xffff) {
      throw encodingError(
        "numeric-range",
        "vector elements must be unsigned 16-bit integers",
        { value }
      );
    }
    return value;
  });
}

function readBooleans(values) {
  return values.map((value) => {
    if (value === "truth" || value === true) return 1;
    if (value === "lie" || value === false) return 0;
    throw encodingError(
      "unsupported-vector-type",
      "boolean vector elements must be truth or lie",
      { value }
    );
  });
}

function textRegion(value) {
  if (typeof value !== "string" || value.length === 0) {
    throw encodingError(
      "unsupported-vector-type",
      "text vector elements must be non-empty text",
      { value }
    );
  }
  if (value.length === 1) {
    return {
      quoteWord: LETTER_QUOTE_WORD,
      payloadWords: [value.charCodeAt(0)]
    };
  }
  return {
    quoteWord: PARAGRAPH_LETTER_QUOTE_WORD,
    payloadWords: [value.length, ...Array.from(value, (character) => character.charCodeAt(0))]
  };
}

export function isVectorSentence(sentence) {
  return sentence?.mood === "ya" && sentence?.be === "vector" && sentence?.ob?.ve !== undefined;
}

export function normalizeVectorSentence(sentence) {
  if (!sentence || typeof sentence !== "object") {
    throw encodingError("unsupported-sentence", "vector literals require a sentence object");
  }
  const keys = Object.keys(sentence).sort();
  const allowed = sentence.su === undefined
    ? ["be", "mood", "ob"]
    : ["be", "mood", "ob", "su"];
  if (keys.length !== allowed.length || keys.some((key, index) => key !== allowed[index])) {
    throw encodingError("unsupported-sentence", "vector literals have an unsupported shape", {
      keys,
      expected: allowed
    });
  }
  if (sentence.mood !== "ya" || sentence.be !== "vector") {
    throw encodingError("unsupported-sentence", "vector literals require mood ya and type vector", {
      mood: sentence.mood,
      be: sentence.be
    });
  }
  if (!sentence.ob || typeof sentence.ob !== "object") {
    throw encodingError("unsupported-sentence", "vector literal object is required");
  }
  const obKeys = Object.keys(sentence.ob).sort();
  if (obKeys.length !== 1 || obKeys[0] !== "ve") {
    throw encodingError("unsupported-sentence", "vector literals carry a single vector value", {
      keys: obKeys
    });
  }

  const vector = sentence.ob.ve;
  if (!vector || typeof vector !== "object" || !Array.isArray(vector.values)) {
    throw encodingError("unsupported-sentence", "vector literals require a list of values", {
      vector
    });
  }
  const type = vector.type === undefined ? "num" : vector.type;
  if (type !== "num" && type !== "bool" && type !== "text") {
    throw encodingError(
      "unsupported-vector-type",
      "only numeric, boolean, and text vectors have a proven legacy quote encoding",
      { type: vector.type }
    );
  }
  if (vector.values.length < VECTOR_MIN_ELEMENTS) {
    throw encodingError(
      "unsupported-vector-width",
      "a one-element vector is indistinguishable from a scalar literal",
      { count: vector.values.length, minimum: VECTOR_MIN_ELEMENTS }
    );
  }
  const maximum = type === "text" ? TEXT_VECTOR_MAX_ELEMENTS : VECTOR_MAX_ELEMENTS;
  if (vector.values.length > maximum) {
    throw encodingError(
      "unsupported-vector-width",
      "the vector does not fit in one codelet",
      { count: vector.values.length, maximum }
    );
  }

  const values = type === "num"
    ? readNumbers(vector.values)
    : type === "bool"
      ? readBooleans(vector.values)
      : vector.values.map((value) => {
        textRegion(value);
        return value;
      });

  const normalized = {
    mood: "ya",
    ob: { ve: { type, values } },
    be: "vector"
  };
  if (sentence.su !== undefined) {
    const name = normalizeLiteralName(sentence.su);
    normalized.su = { name: name.name };
  }
  return { normalized, type, payload: values };
}

export function lowerVectorSentence(sentence) {
  const { normalized, type, payload } = normalizeVectorSentence(sentence);
  const nameWords = normalized.su ? normalizeLiteralName(normalized.su).words : [];

  let regions;
  if (type === "text") {
    regions = payload.map((value) => textRegion(value));
  } else {
    const words = vectorUsesExplicitLength(payload.length)
      ? [payload.length, ...payload]
      : payload;
    regions = [{ quoteWord: vectorQuoteWord(type, payload.length), payloadWords: words }];
  }

  const codelet = buildLiteralCodelet({ nameWords, regions });
  return {
    sentence: normalized,
    words: codelet.words,
    bytes: codelet.bytes,
    usedWords: codelet.usedWords
  };
}

function regionText(region) {
  return region.payloadWords.map((code) => String.fromCharCode(code)).join("");
}

export function decodeVectorCodelet(input) {
  const literal = decodeLiteralCodelet(input, {
    acceptsQuote: (quote) => (
      isUintVectorQuoteWord(quote.word) ||
      isIntVectorQuoteWord(quote.word) ||
      isLetterQuoteWord(quote.word)
    ),
    payloadWordCount: (quote) => quote.payloadWords
  });

  const first = literal.regions[0].quote;
  let type;
  let values;
  if (isUintVectorQuoteWord(first.word)) {
    type = "num";
    values = literal.regions[0].payloadWords;
  } else if (isIntVectorQuoteWord(first.word)) {
    type = "bool";
    values = literal.regions[0].payloadWords.map((code) => (code === 0 ? "lie" : "truth"));
  } else {
    type = "text";
    if (!literal.regions.every((region) => isLetterQuoteWord(region.quote.word))) {
      throw encodingError("malformed-codelet", "a text vector holds only letter regions", {
        words: literal.regions.map((region) => region.quote.word)
      });
    }
    values = literal.regions.map((region) => regionText(region));
  }

  const sentence = {
    mood: "ya",
    ob: { ve: { type, values } },
    be: "vector"
  };
  if (literal.name) {
    sentence.su = { name: literal.name };
  }
  return sentence;
}

export async function executeVectorCodelet(input) {
  return decodeVectorCodelet(input);
}
