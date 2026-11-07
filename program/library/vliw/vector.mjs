import {
  buildLiteralCodelet,
  decodeLiteralCodelet,
  encodingError,
  normalizeLiteralName
} from "./literal_layout.mjs";
import {
  isUintVectorQuoteWord,
  uintQuoteWord,
  VECTOR_THICK_LONG,
  vectorThicknessFor
} from "./quotes.mjs";

// A numeric vector travels as a uint quote whose vector thickness states how
// many 16-bit elements it holds. The legacy format has fixed thicknesses for
// two, three, four, eight, and sixteen elements and an explicit length form
// for every other width.
export const VECTOR_MIN_ELEMENTS = 2;
export const VECTOR_MAX_ELEMENTS = 11;

export const vectorCompatibility = Object.freeze({
  minElements: VECTOR_MIN_ELEMENTS,
  maxElements: VECTOR_MAX_ELEMENTS,
  scalarBytes: 2
});

export function vectorQuoteWord(count) {
  return uintQuoteWord({ vectorThick: vectorThicknessFor(count), scalarBytes: 2 });
}

export function vectorUsesExplicitLength(count) {
  return vectorThicknessFor(count) === VECTOR_THICK_LONG;
}

function readElements(values) {
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
  if (vector.type !== undefined && vector.type !== "num") {
    throw encodingError(
      "unsupported-vector-type",
      "only numeric vectors have a proven legacy quote encoding",
      { type: vector.type }
    );
  }

  const values = readElements(vector.values);
  if (values.length < VECTOR_MIN_ELEMENTS) {
    throw encodingError(
      "unsupported-vector-width",
      "a one-element vector is indistinguishable from a numeric literal",
      { count: values.length, minimum: VECTOR_MIN_ELEMENTS }
    );
  }
  if (values.length > VECTOR_MAX_ELEMENTS) {
    throw encodingError(
      "unsupported-vector-width",
      "the vector does not fit in one codelet",
      { count: values.length, maximum: VECTOR_MAX_ELEMENTS }
    );
  }

  const normalized = {
    mood: "ya",
    ob: { ve: { type: "num", values } },
    be: "vector"
  };
  if (sentence.su !== undefined) {
    const name = normalizeLiteralName(sentence.su);
    normalized.su = { name: name.name };
  }
  return normalized;
}

export function lowerVectorSentence(sentence) {
  const normalized = normalizeVectorSentence(sentence);
  const values = normalized.ob.ve.values;
  const nameWords = normalized.su ? normalizeLiteralName(normalized.su).words : [];
  const payload = vectorUsesExplicitLength(values.length)
    ? [values.length, ...values]
    : values;
  const codelet = buildLiteralCodelet({
    nameWords,
    quoteWord: vectorQuoteWord(values.length),
    payloadWords: payload
  });
  return {
    sentence: normalized,
    words: codelet.words,
    bytes: codelet.bytes,
    usedWords: codelet.usedWords
  };
}

export function decodeVectorCodelet(input) {
  const literal = decodeLiteralCodelet(input, {
    acceptsQuote: (quote) => isUintVectorQuoteWord(quote.word),
    payloadWordCount: (quote) => quote.payloadWords  });
  const sentence = {
    mood: "ya",
    ob: { ve: { type: "num", values: literal.payloadWords } },
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
