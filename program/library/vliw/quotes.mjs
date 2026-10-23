import pyashWords from "../pyashWords.json" with { type: "json" };

export const QUOTE_DENOTE = 0x001d;
export const NUMBER_QUOTE_WORD = 0x881d;
export const LETTER_QUOTE_WORD = 0x081d;
export const PARAGRAPH_LETTER_QUOTE_WORD = 0x0e1d;

export const LEGACY_NUMERIC_PLUS_WORDS = Object.freeze({
  head: 0x0149,
  instrumentalCase: 0x287e,
  accusativeCase: 0x245e,
  number: 0x327e,
  plus: 0x8a64,
  deonticMood: 0x295e
});

const quoteDescriptorList = [
  {
    word: QUOTE_DENOTE,
    family: "quote-denote",
    payloadWords: null,
    valueType: "descriptor",
    supported: false
  },
  {
    word: NUMBER_QUOTE_WORD,
    family: "number",
    payloadWords: 1,
    valueType: "uint16",
    supported: true
  },
  {
    word: LETTER_QUOTE_WORD,
    family: "letter",
    payloadWords: null,
    valueType: "letter",
    supported: false
  },
  {
    word: PARAGRAPH_LETTER_QUOTE_WORD,
    family: "paragraph-letter",
    payloadWords: null,
    valueType: "paragraph-letter",
    supported: false
  }
];

export const quoteDescriptors = Object.freeze(
  quoteDescriptorList.map((descriptor) => Object.freeze({ ...descriptor }))
);

const quoteDescriptorByWord = new Map(
  quoteDescriptors.map((descriptor) => [descriptor.word, descriptor])
);

const legacyEntriesByHnuc = new Map();
const legacyEntriesByEnglish = new Map();
for (const entry of pyashWords) {
  if (typeof entry?.hnuc === "string" && !legacyEntriesByHnuc.has(entry.hnuc.toLowerCase())) {
    legacyEntriesByHnuc.set(entry.hnuc.toLowerCase(), entry);
  }
  if (typeof entry?.en === "string" && !legacyEntriesByEnglish.has(entry.en)) {
    legacyEntriesByEnglish.set(entry.en, entry);
  }
}

const legacyNumberNames = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
  "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen",
  "eighteen", "nineteen", "twenty"
];
const legacyNumberWords = legacyNumberNames.map((name) => legacyEntriesByEnglish.get(name)?.pya ?? null);

export class QuoteEncodingError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "QuoteEncodingError";
    this.code = code;
    this.details = details;
  }
}

function quoteError(code, message, details) {
  return new QuoteEncodingError(code, message, details);
}

function validateWord(word) {
  if (!Number.isInteger(word) || word < 0 || word > 0xffff) {
    throw quoteError("invalid-word", "quote word must be an unsigned 16-bit integer", { word });
  }
}

function normalizeWords(words) {
  if (!(words instanceof Uint16Array) && !Array.isArray(words)) {
    throw quoteError("invalid-codelet", "quote input must be a word array");
  }
  const values = Array.from(words);
  for (const [index, word] of values.entries()) {
    try {
      validateWord(word);
    } catch (error) {
      throw quoteError("invalid-word", error.message, { index, word });
    }
  }
  return values;
}

function wordKey(word) {
  return `0x${word.toString(16).padStart(4, "0")}`;
}

export function decodeQuoteWord(word) {
  validateWord(word);
  const descriptor = quoteDescriptorByWord.get(word);
  if (!descriptor) {
    const code = (word & 0x001f) === QUOTE_DENOTE ? "unknown-quote" : "not-quote";
    throw quoteError(code, `unsupported quote word ${wordKey(word)}`, { word });
  }
  return { ...descriptor };
}

export function decodeQuote(words, offset = 0) {
  const values = normalizeWords(words);
  if (!Number.isInteger(offset) || offset < 0 || offset >= values.length) {
    throw quoteError("invalid-offset", "quote offset is outside the word sequence", { offset });
  }

  const descriptor = decodeQuoteWord(values[offset]);
  if (!descriptor.supported) {
    throw quoteError("unsupported-quote", `${descriptor.family} quotes have no decoder yet`, {
      word: values[offset],
      family: descriptor.family
    });
  }
  const end = offset + 1 + descriptor.payloadWords;
  if (end > values.length) {
    throw quoteError("truncated-quote", `${descriptor.family} quote payload is truncated`, {
      offset,
      requiredWords: descriptor.payloadWords,
      availableWords: values.length - offset - 1
    });
  }

  const payload = values.slice(offset + 1, end);
  return {
    ...descriptor,
    payload,
    value: payload[0],
    nextOffset: end
  };
}

export function lookupLegacyWord(word) {
  validateWord(word);
  const entry = legacyEntriesByHnuc.get(wordKey(word));
  return entry ? { en: entry.en, hnuc: entry.hnuc, pya: entry.pya } : null;
}

function legacyNumberWord(value) {
  if (!Number.isInteger(value) || value < 0 || value >= legacyNumberWords.length) {
    throw quoteError("surface-range", "legacy numeric surface rendering supports values 0 through 20", { value });
  }
  const word = legacyNumberWords[value];
  if (!word) {
    throw quoteError("missing-lexeme", `legacy number word ${value} has no lexicon entry`, { value });
  }
  return word;
}

function requireLegacyWord(word, role) {
  const entry = lookupLegacyWord(word);
  if (!entry?.pya) {
    throw quoteError("missing-lexeme", `legacy ${role} word ${wordKey(word)} has no Pyash spelling`, { word, role });
  }
  return entry.pya;
}

function normalizePlusWords(words) {
  const values = normalizeWords(words);
  if (values.length !== 16) {
    throw quoteError("invalid-codelet", "numeric-plus rendering requires 16 words", { length: values.length });
  }
  for (let index = 9; index < values.length; index += 1) {
    if (values[index] !== 0) {
      throw quoteError("invalid-codelet", "numeric-plus rendering requires a zero tail", { index, value: values[index] });
    }
  }
  const markers = [
    [0, LEGACY_NUMERIC_PLUS_WORDS.head, "head"],
    [3, LEGACY_NUMERIC_PLUS_WORDS.instrumentalCase, "instrumental case"],
    [6, LEGACY_NUMERIC_PLUS_WORDS.accusativeCase, "accusative case"],
    [7, LEGACY_NUMERIC_PLUS_WORDS.plus, "plus"],
    [8, LEGACY_NUMERIC_PLUS_WORDS.deonticMood, "deontic mood"]
  ];
  for (const [index, expected, role] of markers) {
    if (values[index] !== expected) {
      throw quoteError("invalid-codelet", `numeric-plus rendering has an invalid ${role} word`, {
        index,
        expected,
        actual: values[index]
      });
    }
  }
  return values;
}

export function renderLegacyNumericPlusCodelet(words) {
  const values = normalizePlusWords(words);
  const first = decodeQuote(values, 1);
  const second = decodeQuote(values, 4);
  if (first.nextOffset !== 3 || second.nextOffset !== 6) {
    throw quoteError("invalid-codelet", "numeric-plus quote boundaries do not match the legacy layout");
  }
  const numberWord = requireLegacyWord(LEGACY_NUMERIC_PLUS_WORDS.number, "number");
  const firstCase = requireLegacyWord(LEGACY_NUMERIC_PLUS_WORDS.instrumentalCase, "instrumental case");
  const secondCase = requireLegacyWord(LEGACY_NUMERIC_PLUS_WORDS.accusativeCase, "accusative case");
  const plus = requireLegacyWord(LEGACY_NUMERIC_PLUS_WORDS.plus, "verb");
  const mood = requireLegacyWord(LEGACY_NUMERIC_PLUS_WORDS.deonticMood, "mood");
  return [
    `${legacyNumberWord(first.value)}${numberWord}${firstCase}`,
    `${legacyNumberWord(second.value)}${numberWord}${secondCase}`,
    `${plus}${mood}`
  ].join(" ");
}
