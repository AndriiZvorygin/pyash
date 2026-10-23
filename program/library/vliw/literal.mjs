import {
  CODELET_WORD_COUNT,
  decodeLegacyCodelet,
  VliwCodeletError
} from "./codelets.mjs";
import {
  LETTER_QUOTE_WORD,
  NUMBER_QUOTE_WORD,
  PARAGRAPH_LETTER_QUOTE_WORD
} from "./quotes.mjs";
import { VliwEncodingError } from "./plus.mjs";

export const TYPED_LITERAL_USED_WORD_COUNT = 5;

const TYPED_LITERAL_HEAD_WORD = 0x0019;
const ACCUSATIVE_CASE_WORD = 0x245e;
const REALIS_MOOD_WORD = 0x217e;

export const typedLiteralCompatibility = Object.freeze({
  head: TYPED_LITERAL_HEAD_WORD,
  numberQuote: NUMBER_QUOTE_WORD,
  letterQuote: LETTER_QUOTE_WORD,
  paragraphLetterQuote: PARAGRAPH_LETTER_QUOTE_WORD,
  accusativeCase: ACCUSATIVE_CASE_WORD,
  realisMood: REALIS_MOOD_WORD,
  usedWords: TYPED_LITERAL_USED_WORD_COUNT
});

function encodingError(code, message, details = {}) {
  return new VliwEncodingError(code, message, details);
}

function wordsToBytes(words) {
  const bytes = new Uint8Array(words.byteLength);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < words.length; index += 1) {
    view.setUint16(index * 2, words[index], true);
  }
  return bytes;
}

function exactKeys(value, expected, role) {
  const keys = Object.keys(value).sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw encodingError("unsupported-sentence", `${role} has an unsupported shape`, {
      role,
      keys,
      expected
    });
  }
}

function readNumber(value) {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff) {
    throw encodingError(
      "literal-range",
      "typed numeric literals must be unsigned 16-bit integers",
      { value }
    );
  }
  return value;
}

function normalizeTypedLiteralSentence(sentence) {
  if (!sentence || typeof sentence !== "object") {
    throw encodingError("unsupported-sentence", "typed literals require a sentence object");
  }
  if (sentence.su !== undefined) {
    throw encodingError(
      "unrepresentable-name",
      "the proven legacy typed-literal vector has no name slot",
      { name: sentence.su }
    );
  }

  exactKeys(sentence, ["be", "mood", "ob"], "typed literal sentence");
  if (sentence.mood !== "ya" || !["number", "text"].includes(sentence.be)) {
    throw encodingError("unsupported-sentence", "typed literals require mood ya and type number or text", {
      mood: sentence.mood,
      be: sentence.be
    });
  }

  if (!sentence.ob || typeof sentence.ob !== "object") {
    throw encodingError("unsupported-sentence", "typed literal object is required");
  }

  if (sentence.be === "number") {
    exactKeys(sentence.ob, ["num"], "numeric literal object");
    return {
      mood: "ya",
      ob: { num: readNumber(sentence.ob.num) },
      be: "number"
    };
  }

  exactKeys(sentence.ob, ["text"], "text literal object");
  if (typeof sentence.ob.text !== "string" || sentence.ob.text.length === 0 || sentence.ob.text.length > 10) {
    throw encodingError(
      "literal-width",
      "the proven text vectors accept between one and ten UTF-16 code units",
      { length: sentence.ob.text?.length ?? null }
    );
  }
  return {
    mood: "ya",
    ob: { text: sentence.ob.text },
    be: "text"
  };
}

function markerAt(decoded, offset, expected, role) {
  const item = decoded.items.find((candidate) => candidate.offset === offset);
  if (item?.kind !== "word" || item.word !== expected) {
    throw encodingError("malformed-codelet", `typed literal codelet has an invalid ${role} word`, {
      offset,
      expected,
      actual: item?.word
    });
  }
}

function decodeLegacy(input) {
  try {
    return decodeLegacyCodelet(input);
  } catch (error) {
    if (error instanceof VliwCodeletError) {
      throw encodingError("malformed-codelet", error.message, {
        cause: error.code,
        details: error.details
      });
    }
    throw error;
  }
}

export function isTypedLiteralSentence(sentence) {
  return sentence?.mood === "ya" && ["number", "text"].includes(sentence?.be);
}

export function lowerTypedLiteralSentence(sentence) {
  const normalized = normalizeTypedLiteralSentence(sentence);
  const words = new Uint16Array(CODELET_WORD_COUNT);
  if (normalized.be === "number") {
    words.set([
      TYPED_LITERAL_HEAD_WORD,
      NUMBER_QUOTE_WORD,
      normalized.ob.num,
      ACCUSATIVE_CASE_WORD,
      REALIS_MOOD_WORD
    ]);
  } else if (normalized.ob.text.length === 1) {
    words.set([
      TYPED_LITERAL_HEAD_WORD,
      LETTER_QUOTE_WORD,
      normalized.ob.text.charCodeAt(0),
      ACCUSATIVE_CASE_WORD,
      REALIS_MOOD_WORD
    ]);
  } else {
    const chars = Array.from(
      { length: normalized.ob.text.length },
      (_, index) => normalized.ob.text.charCodeAt(index)
    );
    words.set([
      TYPED_LITERAL_HEAD_WORD,
      PARAGRAPH_LETTER_QUOTE_WORD,
      chars.length,
      ...chars,
      ACCUSATIVE_CASE_WORD,
      REALIS_MOOD_WORD
    ]);
  }
  const usedWords = normalized.be === "number" || normalized.ob.text.length === 1
    ? TYPED_LITERAL_USED_WORD_COUNT
    : normalized.ob.text.length + 5;
  return {
    sentence: normalized,
    words,
    bytes: wordsToBytes(words),
    usedWords
  };
}

export function decodeTypedLiteralCodelet(input) {
  const decoded = decodeLegacy(input);
  markerAt(decoded, 0, TYPED_LITERAL_HEAD_WORD, "head");

  const quoteItem = decoded.items.find((candidate) => candidate.offset === 1);
  if (quoteItem?.kind !== "quote" || ![NUMBER_QUOTE_WORD, LETTER_QUOTE_WORD, PARAGRAPH_LETTER_QUOTE_WORD].includes(quoteItem.quote.word)) {
    throw encodingError("malformed-codelet", "typed literal codelet has an unsupported quote", {
      actual: quoteItem?.quote?.word ?? quoteItem?.word
    });
  }
  const accusativeOffset = quoteItem.quote.nextOffset;
  const realisOffset = accusativeOffset + 1;
  markerAt(decoded, accusativeOffset, ACCUSATIVE_CASE_WORD, "accusative case");
  markerAt(decoded, realisOffset, REALIS_MOOD_WORD, "realis mood");
  const expectedUsedWords = realisOffset + 1;
  if (decoded.usedWords !== expectedUsedWords) {
    throw encodingError("malformed-codelet", "typed literal codelet has an invalid used-word boundary", {
      expected: expectedUsedWords,
      actual: decoded.usedWords
    });
  }

  if (quoteItem.quote.word === NUMBER_QUOTE_WORD) {
    return {
      mood: "ya",
      ob: { num: readNumber(quoteItem.quote.value) },
      be: "number"
    };
  }
  if (typeof quoteItem.quote.value !== "string" || quoteItem.quote.value.length === 0) {
    throw encodingError("literal-width", "typed text quote must contain UTF-16 code units", {
      length: quoteItem.quote.value?.length ?? null
    });
  }
  return {
    mood: "ya",
    ob: { text: quoteItem.quote.value },
    be: "text"
  };
}

export async function executeTypedLiteralCodelet(input) {
  return decodeTypedLiteralCodelet(input);
}
