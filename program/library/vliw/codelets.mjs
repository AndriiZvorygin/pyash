import {
  QUOTE_DENOTE,
  decodeQuote,
  lookupLegacyWord,
  QuoteEncodingError
} from "./quotes.mjs";

export const CODELET_WORD_COUNT = 16;

export class VliwCodeletError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "VliwCodeletError";
    this.code = code;
    this.details = details;
  }
}

function codeletError(code, message, details) {
  return new VliwCodeletError(code, message, details);
}

function normalizeCodeletWords(words) {
  if (!(words instanceof Uint16Array) && !Array.isArray(words)) {
    throw codeletError("invalid-codelet", "codelet must be a 16-word array");
  }
  if (words.length !== CODELET_WORD_COUNT) {
    throw codeletError("invalid-codelet", "codelet must contain exactly 16 words", {
      length: words.length
    });
  }

  const values = Array.from(words);
  for (const [index, word] of values.entries()) {
    if (!Number.isInteger(word) || word < 0 || word > 0xffff) {
      throw codeletError("invalid-word", "codelet contains an invalid word", { index, word });
    }
  }
  return new Uint16Array(values);
}

function normalizeCodeletSequence(input) {
  if (!Array.isArray(input) || input.length === 0) {
    throw codeletError("invalid-sequence", "codelet sequence must contain one or more 16-word vectors");
  }
  return input.map((vector, index) => {
    try {
      return normalizeCodeletWords(vector);
    } catch (error) {
      if (error instanceof VliwCodeletError) {
        throw codeletError(error.code, "codelet sequence contains an invalid vector", {
          vector: index,
          details: error.details
        });
      }
      throw error;
    }
  });
}

function decodeQuoteItem(words, offset) {
  try {
    return decodeQuote(words, offset);
  } catch (error) {
    if (error instanceof QuoteEncodingError) {
      throw codeletError("malformed-quote", error.message, {
        offset,
        cause: error.code,
        details: error.details
      });
    }
    throw error;
  }
}

function validateZeroTail(words, offset) {
  for (let index = offset; index < words.length; index += 1) {
    if (words[index] !== 0) {
      throw codeletError("nonzero-tail", "codelet has nonzero data after its used words", {
        index,
        actual: words[index]
      });
    }
  }
}

function decodeWordSequence(words) {
  const items = [];
  let offset = 0;

  while (offset < words.length) {
    const word = words[offset];
    if (word === 0) {
      validateZeroTail(words, offset);
      return { words, items, usedWords: offset };
    }

    if ((word & 0x001f) === QUOTE_DENOTE) {
      const quote = decodeQuoteItem(words, offset);
      items.push({ kind: "quote", offset, quote });
      offset = quote.nextOffset;
      continue;
    }

    items.push({
      kind: "word",
      offset,
      word,
      entry: lookupLegacyWord(word)
    });
    offset += 1;
  }

  return { words, items, usedWords: words.length };
}

export function decodeLegacyCodelet(input) {
  return decodeWordSequence(normalizeCodeletWords(input));
}

export function decodeLegacyCodeletSequence(input) {
  const vectors = normalizeCodeletSequence(input);
  const indexWords = vectors.map((vector) => vector[0]);
  const finalVector = indexWords.findIndex((word) => (word & 0x0001) === 1);

  if (finalVector === -1) {
    throw codeletError("missing-continuation", "codelet sequence has no final vector", {
      vectorCount: vectors.length,
      indexWords
    });
  }
  if (finalVector !== vectors.length - 1) {
    throw codeletError("trailing-continuation", "codelet sequence contains data after its final vector", {
      finalVector,
      vectorCount: vectors.length,
      indexWords
    });
  }

  const flattened = [vectors[0][0]];
  for (const vector of vectors) {
    flattened.push(...vector.slice(1));
  }
  const decoded = decodeWordSequence(new Uint16Array(flattened));
  return {
    ...decoded,
    vectors,
    indexWords,
    vectorCount: vectors.length,
    continued: vectors.length > 1,
    complete: true
  };
}

function renderQuote(quote) {
  if (quote.family === "number") {
    return `num ${quote.value.toString()}`;
  }
  if (quote.family === "letter") {
    return `letter ${JSON.stringify(quote.value)}`;
  }
  if (quote.family === "paragraph-letter") {
    return `text ${JSON.stringify(quote.value)}`;
  }
  throw codeletError("unsupported-quote", `cannot render ${quote.family} quote`);
}

export function renderLegacyCodelet(input) {
  const decoded = decodeLegacyCodelet(input);
  return decoded.items.map((item) => {
    if (item.kind === "quote") {
      return renderQuote(item.quote);
    }
    return item.entry?.pya ?? `0x${item.word.toString(16).padStart(4, "0")}`;
  }).join(" ");
}
