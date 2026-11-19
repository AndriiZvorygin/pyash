import {
  QUOTE_DENOTE,
  QUOTE_DENOTE_MASK,
  NUMBER_QUOTE_WORD,
  PARAGRAPH_LETTER_QUOTE_WORD,
  QUOTED_GRAMMAR_WORD,
  decodeQuoteHeader,
  decodeQuote,
  lookupLegacyWord,
  QuoteEncodingError
} from "./quotes.mjs";

export const CODELET_WORD_COUNT = 16;

// The head word is the legacy index: bit 0 says whether the vector completes
// the codelet, and the remaining bits mark the phrase-closing case words and
// the codelet-ending mood words. `lwonprom/program/compile.c` reads a slot as
// a boundary when its bit equals bit 0, so the head carries the completion bit
// and one bit per boundary slot.
export const INDEX_COMPLETION_BIT = 0x0001;

export function indexWordFor(boundarySlots) {
  let word = INDEX_COMPLETION_BIT;
  for (const slot of boundarySlots) {
    if (!Number.isInteger(slot) || slot < 1 || slot >= CODELET_WORD_COUNT) {
      throw codeletError("invalid-codelet", "index boundary slot is outside the codelet", { slot });
    }
    word |= 1 << slot;
  }
  return word;
}

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

function invalidQuoteFrame(message, details = {}) {
  return codeletError("invalid-quote-frame", message, details);
}

function decodeQuoteFrame(words, offset) {
  const tagStart = offset + 2;
  let tagQuote;
  try {
    tagQuote = decodeQuoteItem(words, tagStart);
  } catch (error) {
    throw invalidQuoteFrame("tagged quote frame has an invalid opening tag", {
      offset,
      cause: error.code
    });
  }
  if (tagQuote.family !== "paragraph-letter" || typeof tagQuote.value !== "string" || !tagQuote.value) {
    throw invalidQuoteFrame("quote frame tag must be a non-empty text quote", { offset });
  }

  const tagWords = Array.from(words.slice(tagStart, tagQuote.nextOffset));
  const optionalQuotes = [];
  let cursor = tagQuote.nextOffset;
  while (cursor < words.length && words[cursor] !== 0) {
    if (optionalQuotes.length === 2) {
      throw invalidQuoteFrame("quote frame has more than two optional fields", { offset });
    }
    const optional = decodeQuoteItem(words, cursor);
    optionalQuotes.push(optional);
    cursor = optional.nextOffset;
  }
  if (cursor >= words.length) throw invalidQuoteFrame("quote frame is missing its payload delimiter", { offset });

  let payloadLength;
  if (optionalQuotes.length > 0) {
    const lengthQuote = optionalQuotes[0];
    if (lengthQuote.word !== NUMBER_QUOTE_WORD || !Number.isInteger(lengthQuote.value) || lengthQuote.value < 1) {
      throw invalidQuoteFrame("first optional quote frame field must be a positive uint16 payload length", {
        offset
      });
    }
    payloadLength = lengthQuote.value;
  }

  const payloadStart = cursor + 1;
  const payloadQuote = decodeQuoteItem(words, payloadStart);
  if (payloadQuote.family !== "paragraph-letter" || typeof payloadQuote.value !== "string") {
    throw invalidQuoteFrame("quote frame payload must be a text quote", { offset });
  }
  if (payloadLength !== undefined && payloadLength !== payloadQuote.payloadWords) {
    throw invalidQuoteFrame("quote frame payload length does not match its typed quote", {
      offset,
      declaredLength: payloadLength,
      actualLength: payloadQuote.payloadWords
    });
  }

  cursor = payloadQuote.nextOffset;
  if (words[cursor] !== 0) throw invalidQuoteFrame("quote frame is missing its closing tag delimiter", { offset });
  const closingTagStart = cursor + 1;
  let closingTag;
  try {
    closingTag = decodeQuoteItem(words, closingTagStart);
  } catch (error) {
    throw invalidQuoteFrame("tagged quote frame has an invalid closing tag", {
      offset,
      cause: error.code
    });
  }
  const closingTagWords = Array.from(words.slice(closingTagStart, closingTag.nextOffset));
  if (closingTagWords.length !== tagWords.length || closingTagWords.some((word, index) => word !== tagWords[index])) {
    throw codeletError("mismatched-quote-frame", "tagged quote frame closing tag does not match its opener", {
      offset
    });
  }
  cursor = closingTag.nextOffset;
  if (words[cursor] !== 0 || words[cursor + 1] !== QUOTED_GRAMMAR_WORD) {
    throw invalidQuoteFrame("tagged quote frame must close with zero and zi", { offset });
  }

  return {
    kind: "tagged-quote",
    offset,
    tag: tagQuote.value,
    tagWords,
    quote: payloadQuote,
    payloadLength,
    hashQuote: optionalQuotes[1],
    nextOffset: cursor + 2
  };
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

    if (
      word === QUOTED_GRAMMAR_WORD
      && words[offset + 1] === 0
      && words[offset + 2] === PARAGRAPH_LETTER_QUOTE_WORD
    ) {
      const frame = decodeQuoteFrame(words, offset);
      items.push(frame);
      offset = frame.nextOffset;
      continue;
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

function freshQuoteScan() {
  return { explicitLength: null, payloadWords: 0 };
}

function scanQuoteWord(word, state) {
  if (state.payloadWords > 0) {
    state.payloadWords -= 1;
    return null;
  }
  if (state.explicitLength) {
    const quote = state.explicitLength;
    state.explicitLength = null;
    if (quote.word === PARAGRAPH_LETTER_QUOTE_WORD && word > 14) {
      return word;
    }
    const payloadWords = word * (quote.scalarBytes / 2);
    state.payloadWords = payloadWords;
    return null;
  }
  if ((word & QUOTE_DENOTE_MASK) !== QUOTE_DENOTE) return null;

  let header;
  try {
    header = decodeQuoteHeader(word);
  } catch {
    return null;
  }
  if (header.explicitVectorLength) {
    state.explicitLength = header;
    return null;
  }
  if (header.vectorWords !== null && header.scalarBytes !== null) {
    const payloadWords = header.vectorWords * (header.scalarBytes / 2);
    state.payloadWords = payloadWords;
  }
  return null;
}

function appendIndexedVector(group, vector, effectiveSlots = CODELET_WORD_COUNT - 1) {
  const completion = Boolean(vector[0] & INDEX_COMPLETION_BIT);
  const logicalBase = group.words.length - 1;
  for (let slot = 1; slot <= effectiveSlots; slot += 1) {
    group.words.push(vector[slot]);
    if (Boolean(vector[0] & (1 << slot)) === completion) {
      group.boundaryOffsets.add(logicalBase + slot);
    }
  }
}

function decodeIndexedGroup(group) {
  const decoded = decodeWordSequence(new Uint16Array(group.words));
  return {
    ...decoded,
    vectors: group.vectors,
    indexWords: group.indexWords,
    boundaryOffsets: group.boundaryOffsets,
    vectorCount: group.vectors.length,
    continued: group.vectors.length > 1,
    complete: true
  };
}

export function decodeLegacyCodelet(input) {
  return decodeWordSequence(normalizeCodeletWords(input));
}

export function decodeLegacyCodeletGroups(input) {
  const vectors = normalizeCodeletSequence(input);
  const groups = [];
  let group = null;
  let quoteScan = freshQuoteScan();

  for (let vectorIndex = 0; vectorIndex < vectors.length;) {
    const vector = vectors[vectorIndex];
    if (!group) {
      group = {
        vectors: [],
        indexWords: [],
        words: [vector[0]],
        boundaryOffsets: new Set()
      };
      quoteScan = freshQuoteScan();
    }
    group.vectors.push(vector);
    group.indexWords.push(vector[0]);

    let blockLength = null;
    let lengthSlot = CODELET_WORD_COUNT - 1;
    for (let slot = 1; slot < CODELET_WORD_COUNT; slot += 1) {
      blockLength = scanQuoteWord(vector[slot], quoteScan);
      if (blockLength !== null) {
        lengthSlot = slot;
        for (let tail = slot + 1; tail < CODELET_WORD_COUNT; tail += 1) {
          if (vector[tail] !== 0) {
            throw codeletError("malformed-blockquote", "indexed quote header has data after its raw-block length", {
              vector: vectorIndex,
              slot: tail,
              actual: vector[tail]
            });
          }
        }
        break;
      }
    }

    appendIndexedVector(group, vector, lengthSlot);
    vectorIndex += 1;

    if (blockLength !== null) {
      const rawVectorCount = Math.ceil(blockLength / CODELET_WORD_COUNT);
      if (vectorIndex + rawVectorCount > vectors.length) {
        throw codeletError("missing-blockquote", "long quote is missing one or more raw payload vectors", {
          requiredVectors: rawVectorCount,
          availableVectors: vectors.length - vectorIndex,
          payloadWords: blockLength
        });
      }
      let remaining = blockLength;
      for (let rawIndex = 0; rawIndex < rawVectorCount; rawIndex += 1) {
        const raw = vectors[vectorIndex];
        group.vectors.push(raw);
        const used = Math.min(remaining, CODELET_WORD_COUNT);
        for (let slot = 0; slot < used; slot += 1) group.words.push(raw[slot]);
        for (let slot = used; slot < CODELET_WORD_COUNT; slot += 1) {
          if (raw[slot] !== 0) {
            throw codeletError("nonzero-blockquote-padding", "raw quote's final vector has nonzero padding", {
              vector: vectorIndex,
              slot,
              actual: raw[slot]
            });
          }
        }
        remaining -= used;
        vectorIndex += 1;
      }
      quoteScan = freshQuoteScan();
      continue;
    }

    if (vector[0] & INDEX_COMPLETION_BIT) {
      groups.push(decodeIndexedGroup(group));
      group = null;
    }
  }

  if (group) {
    throw codeletError("missing-continuation", "codelet sequence has no final indexed vector", {
      vectorCount: group.vectors.length,
      indexWords: group.indexWords,
      completedGroups: groups.length
    });
  }
  return groups;
}

export function decodeLegacyCodeletSequence(input) {
  let groups;
  try {
    groups = decodeLegacyCodeletGroups(input);
  } catch (error) {
    if (error?.code === "missing-continuation" && error.details?.completedGroups > 0) {
      throw codeletError("trailing-continuation", "codelet sequence contains data after its final vector", {
        groupCount: error.details.completedGroups,
        vectorCount: input.length
      });
    }
    throw error;
  }
  if (groups.length === 0) {
    throw codeletError("missing-continuation", "codelet sequence has no final indexed vector");
  }
  if (groups.length > 1) {
    throw codeletError("trailing-continuation", "codelet sequence contains data after its final vector", {
      groupCount: groups.length,
      vectorCount: input.length
    });
  }
  return groups[0];
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
    if (item.kind === "tagged-quote") {
      return `tagged-quote ${JSON.stringify(item.tag)} ${JSON.stringify(item.quote.value)}`;
    }
    return item.entry?.pya ?? `0x${item.word.toString(16).padStart(4, "0")}`;
  }).join(" ");
}
