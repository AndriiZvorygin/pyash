import {
  buildLiteralCodelet,
  decodeLiteralCodelet,
  encodingError,
  normalizeLiteralName
} from "./literal_layout.mjs";
import {
  expandVectorInitializer,
  MAX_VECTOR_ELEMENTS,
  MAX_VLIW_ARRAY_ELEMENTS
} from "./vector_shape.mjs";
import {
  INT_SORT_DENOTE,
  FLOAT_SORT_DENOTE,
  isFloatVectorQuoteWord,
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
export const VECTOR_MIN_ELEMENTS = 1;
export const VECTOR_MAX_ELEMENTS = MAX_VECTOR_ELEMENTS;
export const ARRAY_MAX_ELEMENTS = MAX_VLIW_ARRAY_ELEMENTS;
export const TEXT_VECTOR_MAX_ELEMENTS = MAX_VLIW_ARRAY_ELEMENTS;

export const VECTOR_SORTS = Object.freeze({
  num: UINT_SORT_DENOTE,
  bool: INT_SORT_DENOTE,
  float32: FLOAT_SORT_DENOTE,
  float64: FLOAT_SORT_DENOTE
});

export const vectorCompatibility = Object.freeze({
  minElements: VECTOR_MIN_ELEMENTS,
  maxElements: VECTOR_MAX_ELEMENTS,
  arrayMaxElements: ARRAY_MAX_ELEMENTS,
  textMaxElements: TEXT_VECTOR_MAX_ELEMENTS,
  scalarBytes: 2,
  sorts: VECTOR_SORTS
});

export function vectorQuoteWord(type, count) {
  const scalarBytes = type === "float32" ? 4 : type === "float64" ? 8 : 2;
  return quoteWordFor({
    sort: VECTOR_SORTS[type],
    vectorThick: count === 1 ? VECTOR_THICK_LONG : vectorThicknessFor(count),
    scalarBytes
  });
}

export function vectorUsesExplicitLength(count) {
  return count === 1 || vectorThicknessFor(count) === VECTOR_THICK_LONG;
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
  const allowed = ["be", "mood", "ob"]
    .concat(sentence.by === undefined ? [] : ["by"])
    .concat(sentence.su === undefined ? [] : ["su"])
    .sort();
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
  const name = sentence.su === undefined ? null : normalizeLiteralName(sentence.su);
  if (!Object.hasOwn(VECTOR_SORTS, type) && type !== "text") {
    throw encodingError(
      "unsupported-vector-type",
      "only integer, boolean, float32, float64, and text vectors have a legacy quote encoding",
      { type: vector.type }
    );
  }
  let declaredLength = null;
  if (sentence.by !== undefined) {
    const byKeys = Object.keys(sentence.by ?? {});
    if (byKeys.length !== 1 || byKeys[0] !== "num") {
      throw encodingError("unsupported-vector-width", "VLIW vector lowering requires a numeric declared width", {
        by: sentence.by
      });
    }
    declaredLength = sentence.by.num;
  }
  let initialValues;
  try {
    initialValues = expandVectorInitializer(
      type,
      vector.values,
      declaredLength,
      MAX_VLIW_ARRAY_ELEMENTS
    );
  } catch (error) {
    throw encodingError("unsupported-vector-width", error.message, {
      count: vector.values.length,
      declaredLength
    });
  }
  if (initialValues.length < VECTOR_MIN_ELEMENTS) {
    throw encodingError("unsupported-vector-width", "VLIW vectors require at least one lane", {
      count: initialValues.length
    });
  }
  const values = type === "num"
    ? readNumbers(initialValues)
    : type === "bool"
      ? readBooleans(initialValues)
      : type === "float32" || type === "float64"
        ? initialValues.map((value) => {
          if (typeof value !== "number" || !Number.isFinite(value)) {
            throw encodingError("non-finite-float", `${type} vector values must be finite numbers`, { value });
          }
          const normalized = type === "float32" ? Math.fround(value) : value;
          if (!Number.isFinite(normalized)) {
            throw encodingError("non-finite-float", `value is outside the finite ${type} range`, { value });
          }
          return normalized;
        })
        : initialValues.map((value) => {
        textRegion(value);
        return value;
      });

  const normalized = {
    mood: "ya",
    ob: { ve: { type, values } },
    be: "vector"
  };
  if (sentence.su !== undefined) {
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
    const scalarBytes = type === "float32" ? 4 : type === "float64" ? 8 : 2;
    const scalarWords = scalarBytes / 2;
    const encodedPayload = type === "float32" || type === "float64"
      ? payload.flatMap((value) => {
        const view = new DataView(new ArrayBuffer(scalarBytes));
        if (scalarBytes === 4) view.setFloat32(0, value, true);
        else view.setFloat64(0, value, true);
        return Array.from({ length: scalarWords }, (_, index) => view.getUint16(index * 2, true));
      })
      : payload;
    const explicitLength = vectorUsesExplicitLength(payload.length);
    const words = explicitLength
      ? [payload.length, ...encodedPayload]
      : encodedPayload;
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

export function encodeFixedVectorPayload(type, payload) {
  const scalarBytes = type === "float32" ? 4 : type === "float64" ? 8 : 2;
  const scalarWords = scalarBytes / 2;
  const encodedPayload = type === "float32" || type === "float64"
    ? payload.flatMap((value) => {
      const view = new DataView(new ArrayBuffer(scalarBytes));
      if (scalarBytes === 4) view.setFloat32(0, value, true);
      else view.setFloat64(0, value, true);
      return Array.from({ length: scalarWords }, (_, index) => view.getUint16(index * 2, true));
    })
    : payload.map((value) => type === "bool" ? (value === 0 ? 0 : 1) : value);
  const explicitLength = vectorUsesExplicitLength(payload.length);
  return {
    quoteWord: vectorQuoteWord(type, payload.length),
    lengthWord: explicitLength ? payload.length : null,
    payloadWords: encodedPayload
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
      isFloatVectorQuoteWord(quote.word) ||
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
  } else if (isFloatVectorQuoteWord(first.word)) {
    type = first.family === "float32-vector" ? "float32" : "float64";
    values = literal.regions[0].quote.value;
  } else {
    type = "text";
    if (first.family === "text-array") {
      if (literal.regions.length !== 1) {
        throw encodingError("malformed-codelet", "a counted text array must occupy one quote region");
      }
      values = first.value;
    } else {
      if (!literal.regions.every((region) => isLetterQuoteWord(region.quote.word))) {
        throw encodingError("malformed-codelet", "a text vector holds only letter regions", {
          words: literal.regions.map((region) => region.quote.word)
        });
      }
      values = literal.regions.map((region) => regionText(region));
    }
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
