import {
  CODELET_WORD_COUNT,
  decodeLegacyCodelet,
  VliwCodeletError
} from "./codelets.mjs";
import {
  lookupLegacyName,
  lookupLegacyWord,
  LETTER_QUOTE_WORD,
  NUMBER_QUOTE_WORD,
  PARAGRAPH_LETTER_QUOTE_WORD
} from "./quotes.mjs";
import { VliwEncodingError } from "./plus.mjs";

export const NAMED_LITERAL_USED_WORD_COUNT = 7;

const NAMED_LITERAL_HEAD_WORD = 0x0065;
const NOMINATIVE_CASE_WORD = 0x24de;
const ACCUSATIVE_CASE_WORD = 0x245e;
const REALIS_MOOD_WORD = 0x217e;

export const namedLiteralCompatibility = Object.freeze({
  head: NAMED_LITERAL_HEAD_WORD,
  nominativeCase: NOMINATIVE_CASE_WORD,
  numberQuote: NUMBER_QUOTE_WORD,
  letterQuote: LETTER_QUOTE_WORD,
  paragraphLetterQuote: PARAGRAPH_LETTER_QUOTE_WORD,
  accusativeCase: ACCUSATIVE_CASE_WORD,
  realisMood: REALIS_MOOD_WORD,
  usedWords: NAMED_LITERAL_USED_WORD_COUNT
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
      "named numeric literals must be unsigned 16-bit integers",
      { value }
    );
  }
  return value;
}

function normalizeName(value) {
  if (!value || typeof value.name !== "string") {
    throw encodingError("unrepresentable-name", "named literals require a name", { name: value });
  }
  const name = value.name.trim();
  const parts = name.split(/\s+/u).filter(Boolean);
  const entries = parts.map((part) => lookupLegacyName(part));
  if (entries.some((entry) => !entry)) {
    throw encodingError(
      "unrepresentable-name",
      "named literal requires legacy vocabulary words for every name part",
      { name }
    );
  }
  return {
    name: entries.map((entry) => entry.en).join(" "),
    words: entries.map((entry) => Number.parseInt(entry.hnuc, 16))
  };
}

function normalizeNamedLiteralSentence(sentence) {
  if (!sentence || typeof sentence !== "object") {
    throw encodingError("unsupported-sentence", "named literals require a sentence object");
  }
  exactKeys(sentence, ["be", "mood", "ob", "su"], "named literal sentence");
  if (sentence.mood !== "ya" || !["number", "text"].includes(sentence.be)) {
    throw encodingError("unsupported-sentence", "named literals require mood ya and type number or text", {
      mood: sentence.mood,
      be: sentence.be
    });
  }
  const name = normalizeName(sentence.su);
  if (!sentence.ob || typeof sentence.ob !== "object") {
    throw encodingError("unsupported-sentence", "named literal object is required");
  }

  if (sentence.be === "number") {
    exactKeys(sentence.ob, ["num"], "named numeric literal object");
    return {
      mood: "ya",
      su: { name: name.name },
      ob: { num: readNumber(sentence.ob.num) },
      be: "number",
      nameWords: name.words
    };
  }

  exactKeys(sentence.ob, ["text"], "named text literal object");
  if (typeof sentence.ob.text !== "string" || sentence.ob.text.length === 0 || sentence.ob.text.length > 9) {
    throw encodingError(
      "literal-width",
      "the proven named text vectors accept between one and nine UTF-16 code units",
      { length: sentence.ob.text?.length ?? null }
    );
  }
  return {
    mood: "ya",
    su: { name: name.name },
    ob: { text: sentence.ob.text },
    be: "text",
    nameWords: name.words
  };
}

function markerAt(decoded, offset, expected, role) {
  const item = decoded.items.find((candidate) => candidate.offset === offset);
  if (item?.kind !== "word" || item.word !== expected) {
    throw encodingError("malformed-codelet", `named literal codelet has an invalid ${role} word`, {
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

export function isNamedLiteralSentence(sentence) {
  return sentence?.mood === "ya" && sentence?.su !== undefined && ["number", "text"].includes(sentence?.be);
}

export function lowerNamedLiteralSentence(sentence) {
  const normalized = normalizeNamedLiteralSentence(sentence);
  const words = new Uint16Array(CODELET_WORD_COUNT);
  if (normalized.be === "number") {
    words.set([
      NAMED_LITERAL_HEAD_WORD,
      ...normalized.nameWords,
      NOMINATIVE_CASE_WORD,
      NUMBER_QUOTE_WORD,
      normalized.ob.num,
      ACCUSATIVE_CASE_WORD,
      REALIS_MOOD_WORD
    ]);
  } else if (normalized.ob.text.length === 1) {
    words.set([
      NAMED_LITERAL_HEAD_WORD,
      ...normalized.nameWords,
      NOMINATIVE_CASE_WORD,
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
      NAMED_LITERAL_HEAD_WORD,
      ...normalized.nameWords,
      NOMINATIVE_CASE_WORD,
      PARAGRAPH_LETTER_QUOTE_WORD,
      chars.length,
      ...chars,
      ACCUSATIVE_CASE_WORD,
      REALIS_MOOD_WORD
    ]);
  }
  const usedWords = normalized.be === "number" || normalized.ob.text.length === 1
    ? normalized.nameWords.length + 6
    : normalized.ob.text.length + normalized.nameWords.length + 6;
  return {
    sentence: {
      mood: normalized.mood,
      su: normalized.su,
      ob: normalized.ob,
      be: normalized.be
    },
    words,
    bytes: wordsToBytes(words),
    usedWords
  };
}

export function decodeNamedLiteralCodelet(input) {
  const decoded = decodeLegacy(input);
  markerAt(decoded, 0, NAMED_LITERAL_HEAD_WORD, "head");

  const nominativeOffset = decoded.items.find((candidate) => (
    candidate.kind === "word" && candidate.word === NOMINATIVE_CASE_WORD && candidate.offset > 0
  ))?.offset;
  if (nominativeOffset === undefined || nominativeOffset < 2) {
    throw encodingError("malformed-codelet", "named literal codelet has no name phrase");
  }
  const nameItems = decoded.items.filter((candidate) => (
    candidate.kind === "word" && candidate.offset > 0 && candidate.offset < nominativeOffset
  ));
  if (nameItems.length !== nominativeOffset - 1 || nameItems.some((item) => !lookupLegacyWord(item.word)?.en)) {
    throw encodingError("malformed-codelet", "named literal codelet has an unknown name word", {
      actual: nameItems.map((item) => item.word)
    });
  }

  const quoteItem = decoded.items.find((candidate) => candidate.offset === nominativeOffset + 1);
  if (quoteItem?.kind !== "quote" || ![NUMBER_QUOTE_WORD, LETTER_QUOTE_WORD, PARAGRAPH_LETTER_QUOTE_WORD].includes(quoteItem.quote.word)) {
    throw encodingError("malformed-codelet", "named literal codelet has an unsupported quote", {
      actual: quoteItem?.quote?.word ?? quoteItem?.word
    });
  }
  const accusativeOffset = quoteItem.quote.nextOffset;
  const realisOffset = accusativeOffset + 1;
  markerAt(decoded, accusativeOffset, ACCUSATIVE_CASE_WORD, "accusative case");
  markerAt(decoded, realisOffset, REALIS_MOOD_WORD, "realis mood");
  const expectedUsedWords = realisOffset + 1;
  if (decoded.usedWords !== expectedUsedWords) {
    throw encodingError("malformed-codelet", "named literal codelet has an invalid used-word boundary", {
      expected: expectedUsedWords,
      actual: decoded.usedWords
    });
  }

  const name = nameItems.map((item) => lookupLegacyWord(item.word).en).join(" ");
  if (quoteItem.quote.word === NUMBER_QUOTE_WORD) {
    return {
      mood: "ya",
      su: { name },
      ob: { num: readNumber(quoteItem.quote.value) },
      be: "number"
    };
  }
  if (typeof quoteItem.quote.value !== "string" || quoteItem.quote.value.length === 0) {
    throw encodingError("literal-width", "named text quote must contain UTF-16 code units", {
      length: quoteItem.quote.value?.length ?? null
    });
  }
  return {
    mood: "ya",
    su: { name },
    ob: { text: quoteItem.quote.value },
    be: "text"
  };
}

export async function executeNamedLiteralCodelet(input) {
  return decodeNamedLiteralCodelet(input);
}
