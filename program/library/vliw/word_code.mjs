const LONG_ROOT = 1;
const SHORT_ROOT = 2;
const LONG_GRAMMAR = 3;
const SHORT_GRAMMAR = 4;

const CONSONANT_ONE = new Map([
  ["m", 1], ["k", 2], ["y", 3], ["p", 4], ["w", 5], ["n", 6],
  ["s", 9], ["t", 10], ["l", 11], ["f", 12], ["c", 13], ["r", 14],
  ["b", 17], ["g", 18], ["d", 19], ["z", 20], ["j", 21], ["v", 22],
  ["q", 25], ["x", 26], ["4", 27], ["8", 28], ["Q", 29]
]);
const CONSONANT_TWO = new Map([
  ["y", 0], ["w", 1], ["s", 2], ["z", 2], ["l", 3], ["f", 4],
  ["v", 4], ["c", 5], ["j", 5], ["r", 6], ["x", 7]
]);
const CONSONANT_TWO_VOCAL = ["y", "w", "z", "l", "v", "j", "r", "x"];
const CONSONANT_TWO_ASPIRATE = ["y", "w", "s", "l", "f", "c", "r", "x"];
const VOWEL = new Map([["i", 0], ["a", 1], ["u", 2], ["e", 3], ["o", 4], ["6", 5], ["1", 6], ["3", 7]]);
const TONE = new Map([["E", 0], ["M", 1], ["7", 2], ["2", 3]]);
const CONSONANT_THREE = new Map([
  ["m", 0], ["k", 1], ["p", 2], ["n", 3], ["s", 4], ["t", 5], ["f", 6], ["c", 7],
  ["z", 4], ["g", 1], ["v", 6], ["b", 2], ["d", 5], ["j", 7]
]);
const CONSONANT_THREE_CANONICAL = ["m", "k", "p", "n", "s", "t", "f", "c"];
const CONSONANT_ONE_VOCAL = new Set(["b", "g", "d"]);

function invalid(message, details = {}) {
  const error = new Error(message);
  error.code = "invalid-vliw-word";
  error.details = details;
  return error;
}

function classifyWord(word) {
  const length = word.length;
  if (length === 2 || length === 3) return SHORT_GRAMMAR;
  if (length === 4 && word[3] === "h") return LONG_GRAMMAR;
  if (length === 4 && word[0] === "h") return SHORT_ROOT;
  if (length === 4) return LONG_ROOT;
  if (length === 5 && word[0] === "h") return SHORT_ROOT;
  if (length === 5 && word[4] === "h") return LONG_GRAMMAR;
  if (length === 5) return LONG_ROOT;
  throw invalid("Pyac words must contain two through five glyphs", { word });
}

function requireTable(table, glyph, role, word) {
  const value = table.get(glyph);
  if (value === undefined) throw invalid("Pyac word contains an unsupported glyph", { word, role, glyph });
  return value;
}

function codeConsonantOne(type, glyph, number, word) {
  if (glyph === "\0" || type === SHORT_ROOT) return number;
  const code = requireTable(CONSONANT_ONE, glyph, "first consonant", word);
  if (type === LONG_ROOT) return number | code;
  if (type === LONG_GRAMMAR) return number | (code << 3);
  return number | (code << 5);
}

function codeConsonantTwo(type, glyph, number, word) {
  if (glyph === "\0") return number;
  if (type === SHORT_ROOT) {
    const code = requireTable(CONSONANT_ONE, glyph, "second consonant", word);
    return number | (code << 3);
  }
  if (type === SHORT_GRAMMAR) return number;
  const code = requireTable(CONSONANT_TWO, glyph, "second consonant", word);
  return type === LONG_ROOT ? number | (code << 5) : number | (code << 8);
}

function codeVowel(type, glyph, number, word) {
  if (glyph === "\0") throw invalid("Pyac word has no vowel", { word });
  const code = requireTable(VOWEL, glyph, "vowel", word);
  if (type === LONG_ROOT) return number | (code << 8);
  if (type === SHORT_ROOT) return number | (code << 8);
  if (type === LONG_GRAMMAR) return number | (code << 11);
  return number | (code << 10);
}

function codeTone(type, glyph, number, word) {
  const tone = glyph || "M";
  const code = requireTable(TONE, tone, "tone", word);
  if (type === LONG_ROOT || type === SHORT_ROOT) return number | (code << 11);
  if (type === LONG_GRAMMAR) return number | (code << 14);
  return number | (code << 13);
}

function codeConsonantThree(type, glyph, number, word) {
  if (glyph === "\0" || type === LONG_GRAMMAR || type === SHORT_GRAMMAR) return number;
  const code = CONSONANT_THREE.get(glyph);
  if (code === undefined) throw invalid("Pyac word contains an unsupported final consonant", { word, glyph });
  return number | (code << 13);
}

function splitGlyphs(word, type) {
  const first = word[0];
  if (word.length === 2) return { first, vowel: word[1], tone: "M", second: "\0", third: "\0" };
  if (word.length === 3) return { first, vowel: word[1], tone: word[2], second: "\0", third: "\0" };
  if (type === SHORT_ROOT) {
    return { first, second: word[1], vowel: word[2], tone: word.length === 5 ? word[3] : "M", third: word.at(-1) };
  }
  if (word.length === 4) return { first, second: word[1], vowel: word[2], tone: "M", third: word[3] };
  return { first, second: word[1], vowel: word[2], tone: word[3], third: word[4] };
}

export function encodePyacWord(value) {
  if (typeof value !== "string" || value.length === 0) throw invalid("Pyac word must be non-empty text", { value });
  const word = value.normalize("NFC");
  const type = classifyWord(word);
  const glyphs = splitGlyphs(word, type);
  let number = type === SHORT_GRAMMAR ? 0x1e : type === LONG_GRAMMAR ? 0x7 : 0;
  number = codeConsonantOne(type, glyphs.first, number, word);
  number = codeConsonantTwo(type, glyphs.second, number, word);
  number = codeVowel(type, glyphs.vowel, number, word);
  number = codeTone(type, glyphs.tone, number, word);
  return codeConsonantThree(type, glyphs.third, number, word);
}

function inverseConsonantOne(code) {
  for (const [glyph, value] of CONSONANT_ONE) if (value === code) return glyph;
  throw invalid("VLIW word has an unsupported first consonant code", { code });
}

function inverseVowel(code) {
  for (const [glyph, value] of VOWEL) if (value === code) return glyph;
  throw invalid("VLIW word has an unsupported vowel code", { code });
}

function inverseTone(code) {
  for (const [glyph, value] of TONE) if (value === code) return glyph;
  throw invalid("VLIW word has an unsupported tone code", { code });
}

function inverseConsonantThree(code) {
  const glyph = CONSONANT_THREE_CANONICAL[code];
  if (!glyph) throw invalid("VLIW word has an unsupported final consonant code", { code });
  return glyph;
}

function toneGlyph(code) {
  const tone = inverseTone(code);
  return tone === "M" ? "" : tone;
}

export function decodePyacWord(value) {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff) {
    throw invalid("VLIW word must be an unsigned 16-bit number", { value });
  }
  if (value === 0) return "";
  const shortSort = value & 0x7;
  const longSort = value & 0x1f;
  if (shortSort === 0) {
    const first = inverseConsonantOne((value >> 3) & 0x1f);
    const vowel = inverseVowel((value >> 8) & 0x7);
    const tone = toneGlyph((value >> 11) & 0x3);
    const third = inverseConsonantThree((value >> 13) & 0x7);
    return `h${first}${vowel}${tone}${third}`;
  }
  if (shortSort === 7) {
    const first = inverseConsonantOne((value >> 3) & 0x1f);
    const vocal = CONSONANT_ONE_VOCAL.has(first);
    const second = (vocal ? CONSONANT_TWO_VOCAL : CONSONANT_TWO_ASPIRATE)[(value >> 8) & 0x7];
    const vowel = inverseVowel((value >> 11) & 0x7);
    const tone = toneGlyph((value >> 14) & 0x3);
    return `${first}${second}${vowel}${tone}h`;
  }
  if (longSort === 0x1e) {
    const first = inverseConsonantOne((value >> 5) & 0x1f);
    const vowel = inverseVowel((value >> 10) & 0x7);
    const tone = toneGlyph((value >> 13) & 0x3);
    return `${first}${vowel}${tone}`;
  }
  if (value > 0x800) {
    const first = inverseConsonantOne(value & 0x1f);
    const vocal = CONSONANT_ONE_VOCAL.has(first);
    const second = (vocal ? CONSONANT_TWO_VOCAL : CONSONANT_TWO_ASPIRATE)[(value >> 5) & 0x7];
    const vowel = inverseVowel((value >> 8) & 0x7);
    const tone = toneGlyph((value >> 11) & 0x3);
    const third = inverseConsonantThree((value >> 13) & 0x7);
    return `${first}${second}${vowel}${tone}${third}`;
  }
  throw invalid("VLIW word has no supported Pyac word class", { value });
}

export const WORD_CODE_TYPES = Object.freeze({ LONG_ROOT, SHORT_ROOT, LONG_GRAMMAR, SHORT_GRAMMAR });
