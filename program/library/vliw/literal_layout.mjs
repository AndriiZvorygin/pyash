import {
  CODELET_WORD_COUNT,
  decodeLegacyCodelet,
  indexWordFor,
  VliwCodeletError
} from "./codelets.mjs";
import { lookupLegacyName, lookupLegacyWord, QUOTE_DENOTE, QUOTE_DENOTE_MASK } from "./quotes.mjs";
import { VliwEncodingError } from "./plus.mjs";

export const NOMINATIVE_CASE_WORD = 0x24de;
export const ACCUSATIVE_CASE_WORD = 0x245e;
export const REALIS_MOOD_WORD = 0x217e;

// The literal families share one codelet layout:
//
//   head | name words | nominative | quote | payload | accusative | realis
//
// The name phrase and its nominative case are present only when the sentence
// names the value. The legacy format has no slot for the `exists` keyword,
// so a named literal is written without it.
export function encodingError(code, message, details = {}) {
  return new VliwEncodingError(code, message, details);
}

export function wordsToBytes(words) {
  const bytes = new Uint8Array(words.byteLength);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < words.length; index += 1) {
    view.setUint16(index * 2, words[index], true);
  }
  return bytes;
}

export function normalizeLiteralName(value) {
  if (!value || typeof value.name !== "string") {
    throw encodingError("unrepresentable-name", "named literals require a name", { name: value });
  }
  const name = value.name.trim();
  const parts = name.split(/\s+/u).filter(Boolean);
  if (parts.length === 0) {
    throw encodingError("unrepresentable-name", "named literals require a name", { name: value });
  }
  const entries = parts.map((part) => lookupLegacyName(part));
  if (entries.some((entry) => !entry)) {
    throw encodingError(
      "unrepresentable-name",
      "named literals require legacy vocabulary words for every name part",
      { name }
    );
  }
  return {
    name: entries.map((entry) => entry.en).join(" "),
    words: entries.map((entry) => Number.parseInt(entry.hnuc, 16))
  };
}

export function buildLiteralCodelet({ nameWords = [], quoteWord, payloadWords }) {
  const body = [];
  const boundarySlots = [];
  let slot = 1;

  if (nameWords.length > 0) {
    for (const word of nameWords) {
      body.push(word);
      slot += 1;
    }
    body.push(NOMINATIVE_CASE_WORD);
    boundarySlots.push(slot);
    slot += 1;
  }

  body.push(quoteWord);
  slot += 1;
  for (const word of payloadWords) {
    body.push(word);
    slot += 1;
  }
  body.push(ACCUSATIVE_CASE_WORD);
  boundarySlots.push(slot);
  slot += 1;
  body.push(REALIS_MOOD_WORD);
  boundarySlots.push(slot);
  slot += 1;

  if (slot > CODELET_WORD_COUNT) {
    throw encodingError("literal-width", "the literal does not fit in one codelet", {
      usedWords: slot,
      limit: CODELET_WORD_COUNT
    });
  }

  const head = indexWordFor(boundarySlots);
  const words = new Uint16Array(CODELET_WORD_COUNT);
  words[0] = head;
  words.set(body, 1);

  return {
    head,
    words,
    bytes: wordsToBytes(words),
    usedWords: slot,
    boundarySlots
  };
}

export function readLiteralCodelet(decoded, { quoteWord, acceptsQuote, payloadWordCount }) {
  const words = decoded.words;

  // The quote header is the first word with the quote denote, so a payload
  // word that looks like a quote cannot move the boundary.
  let quoteOffset = -1;
  for (let offset = 1; offset < words.length; offset += 1) {
    if ((words[offset] & QUOTE_DENOTE_MASK) === QUOTE_DENOTE) {
      quoteOffset = offset;
      break;
    }
  }
  if (quoteOffset < 0) {
    throw encodingError("malformed-codelet", "literal codelet has no quote", { offset: quoteOffset });
  }

  let nameWords = [];
  let nominativeSlot = null;
  if (quoteOffset > 1 && words[quoteOffset - 1] === NOMINATIVE_CASE_WORD) {
    nameWords = Array.from(words.slice(1, quoteOffset - 1));
    nominativeSlot = quoteOffset - 1;
  } else if (quoteOffset !== 1) {
    throw encodingError("malformed-codelet", "literal codelet has an unsupported name phrase", {
      offset: quoteOffset
    });
  }

  const quoteItem = decoded.items.find((item) => item.kind === "quote");
  const accepted = quoteItem
    ? (acceptsQuote ? acceptsQuote(quoteItem.quote) : quoteItem.quote.word === quoteWord)
    : false;
  if (!quoteItem || quoteItem.offset !== quoteOffset || !accepted) {
    throw encodingError("malformed-codelet", "literal codelet has an unexpected quote", {
      expected: quoteWord ?? null,
      actual: quoteItem?.quote?.word ?? quoteItem?.word ?? null,
      offset: quoteOffset
    });
  }

  // The quote header owns the words that follow it. The explicit-length form
  // spends one of them on the length, so the element words start after it.
  const payloadStart = quoteItem.offset + 1 + (quoteItem.quote.lengthWord === undefined ? 0 : 1);
  const payloadLength = payloadWordCount(quoteItem.quote);
  const payloadWords = Array.from(words.slice(payloadStart, payloadStart + payloadLength));
  if (payloadWords.length !== payloadLength) {
    throw encodingError("malformed-codelet", "literal codelet has a truncated payload", {
      requiredWords: payloadLength,
      actual: payloadWords.length
    });
  }

  const accusativeOffset = quoteItem.quote.nextOffset;
  const realisOffset = accusativeOffset + 1;
  if (words[accusativeOffset] !== ACCUSATIVE_CASE_WORD) {
    throw encodingError("malformed-codelet", "literal codelet has an invalid accusative case word", {
      offset: accusativeOffset,
      expected: ACCUSATIVE_CASE_WORD,
      actual: words[accusativeOffset] ?? null
    });
  }
  if (words[realisOffset] !== REALIS_MOOD_WORD) {
    throw encodingError("malformed-codelet", "literal codelet has an invalid realis mood word", {
      offset: realisOffset,
      expected: REALIS_MOOD_WORD,
      actual: words[realisOffset] ?? null
    });
  }

  const boundarySlots = [];
  if (nominativeSlot !== null) boundarySlots.push(nominativeSlot);
  boundarySlots.push(accusativeOffset, realisOffset);
  const expectedHead = indexWordFor(boundarySlots);
  if (words[0] !== expectedHead) {
    throw encodingError("malformed-codelet", "literal codelet has an invalid head word", {
      expected: expectedHead,
      actual: words[0]
    });
  }

  const usedWords = realisOffset + 1;
  if (decoded.usedWords !== usedWords) {
    throw encodingError("malformed-codelet", "literal codelet has an invalid used-word boundary", {
      expected: usedWords,
      actual: decoded.usedWords
    });
  }

  const name = nameWords.map((word) => lookupLegacyWord(word)?.en ?? null);
  if (name.some((part) => part === null)) {
    throw encodingError("malformed-codelet", "literal codelet has an unknown name word", {
      actual: nameWords
    });
  }

  return {
    name: name.join(" "),
    nameWords,
    payloadWords,
    usedWords
  };
}

export function decodeLiteralCodelet(input, options) {
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
  return readLiteralCodelet(decoded, options);
}
