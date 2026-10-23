import {
  CODELET_WORD_COUNT,
  decodeLegacyCodelet,
  VliwCodeletError
} from "./codelets.mjs";
import {
  lookupLegacyName,
  lookupLegacyWord,
  LETTER_QUOTE_WORD,
  NUMBER_QUOTE_WORD
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
  const entry = lookupLegacyName(name);
  if (!entry) {
    throw encodingError(
      "unrepresentable-name",
      "named literal requires one legacy vocabulary name",
      { name }
    );
  }
  return { name: entry.en, word: Number.parseInt(entry.hnuc, 16) };
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
      nameWord: name.word
    };
  }

  exactKeys(sentence.ob, ["text"], "named text literal object");
  if (typeof sentence.ob.text !== "string" || sentence.ob.text.length !== 1) {
    throw encodingError(
      "literal-width",
      "the proven named letter vector accepts exactly one UTF-16 code unit",
      { length: sentence.ob.text?.length ?? null }
    );
  }
  return {
    mood: "ya",
    su: { name: name.name },
    ob: { text: sentence.ob.text },
    be: "text",
    nameWord: name.word
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
  const quoteWord = normalized.be === "number" ? NUMBER_QUOTE_WORD : LETTER_QUOTE_WORD;
  const payload = normalized.be === "number"
    ? normalized.ob.num
    : normalized.ob.text.charCodeAt(0);
  words.set([
    NAMED_LITERAL_HEAD_WORD,
    normalized.nameWord,
    NOMINATIVE_CASE_WORD,
    quoteWord,
    payload,
    ACCUSATIVE_CASE_WORD,
    REALIS_MOOD_WORD
  ]);
  return {
    sentence: {
      mood: normalized.mood,
      su: normalized.su,
      ob: normalized.ob,
      be: normalized.be
    },
    words,
    bytes: wordsToBytes(words),
    usedWords: NAMED_LITERAL_USED_WORD_COUNT
  };
}

export function decodeNamedLiteralCodelet(input) {
  const decoded = decodeLegacy(input);
  if (decoded.usedWords !== NAMED_LITERAL_USED_WORD_COUNT) {
    throw encodingError("malformed-codelet", "named literal codelet has an invalid used-word boundary", {
      expected: NAMED_LITERAL_USED_WORD_COUNT,
      actual: decoded.usedWords
    });
  }
  markerAt(decoded, 0, NAMED_LITERAL_HEAD_WORD, "head");
  markerAt(decoded, 2, NOMINATIVE_CASE_WORD, "nominative case");
  markerAt(decoded, 5, ACCUSATIVE_CASE_WORD, "accusative case");
  markerAt(decoded, 6, REALIS_MOOD_WORD, "realis mood");

  const nameItem = decoded.items.find((candidate) => candidate.offset === 1);
  if (nameItem?.kind !== "word" || !lookupLegacyWord(nameItem.word)?.en) {
    throw encodingError("malformed-codelet", "named literal codelet has an unknown name word", {
      actual: nameItem?.word
    });
  }

  const quoteItem = decoded.items.find((candidate) => candidate.offset === 3);
  if (quoteItem?.kind !== "quote" || ![NUMBER_QUOTE_WORD, LETTER_QUOTE_WORD].includes(quoteItem.quote.word)) {
    throw encodingError("malformed-codelet", "named literal codelet has an unsupported quote", {
      actual: quoteItem?.quote?.word ?? quoteItem?.word
    });
  }
  if (quoteItem.quote.nextOffset !== 5) {
    throw encodingError("malformed-codelet", "named literal quote boundary is invalid", {
      nextOffset: quoteItem.quote.nextOffset
    });
  }

  const name = lookupLegacyWord(nameItem.word).en;
  if (quoteItem.quote.word === NUMBER_QUOTE_WORD) {
    return {
      mood: "ya",
      su: { name },
      ob: { num: readNumber(quoteItem.quote.value) },
      be: "number"
    };
  }
  if (typeof quoteItem.quote.value !== "string" || quoteItem.quote.value.length !== 1) {
    throw encodingError("literal-width", "named letter quote must contain one UTF-16 code unit", {
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
