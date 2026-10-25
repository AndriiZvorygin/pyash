import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import pyashWords from "../../../library/pyashWords.json" with { type: "json" };
import { encodePyacWord } from "../../../library/vliw/word_code.mjs";
import { loadEnglish30k, normalizeEnglish30kWord } from "./english30k_coverage.mjs";

export const ATOM_WORD_GENERATION_FORMAT = "pyac-atom-word-generation-v1";
export const ATOM_WORD_GENERATION_NAME = "translation_atom_word_generation";
export const DEFAULT_ATOM_WORD_PHONETIC_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../..",
  "pyachso2n",
  "phonetics.json.txt"
);
export const DEFAULT_ATOM_WORD_FREQUENCY_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../..",
  "pyachso2n",
  "English30k.txt"
);
export const DEFAULT_ATOM_WORD_LAYER_DIRECTORY = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../..",
  "pyachso2n"
);
export const DEFAULT_ATOM_WORD_LEGACY_PATH = resolve(
  DEFAULT_ATOM_WORD_LAYER_DIRECTORY,
  "pyashWords.txt"
);

export const ATOM_WORD_LAYERS = Object.freeze([16, 19, 24, 28, 32]);

// These are the NativeWeights values used by pyachso2n/rootWordPhon.js.
// Their role is phonetic evidence weighting. English30k rank remains the
// deterministic concept-ordering evidence used by the batch generator.
export const NATIVE_LANGUAGE_WEIGHTS = Object.freeze({
  zh: 19.15,
  es: 5.85,
  en: 7.76,
  hi: 7.60,
  ar: 5.38,
  pt: 3.08,
  bn: 5.11,
  ru: 3.27,
  pa: 2.09,
  de: 1.39,
  id: 5.99,
  te: 1.15,
  ta: 1.20,
  vi: 1.58,
  ko: 3.18,
  fr: 1.27,
  mr: 1.21,
  ur: 0.99,
  tr: 2.13,
  it: 0.90,
  zhy: 1.60,
  gu: 1.10,
  fa: 1.37,
  pl: 0.61,
  kn: 0.58,
  ml: 0.57,
  my: 0.50,
  sw: 6.30,
  am: 0.95,
  ro: 0.37,
  az: 0.34,
  nl: 0.32,
  ku: 0.31,
  ne: 0.25,
  si: 0.25,
  hu: 0.32,
  el: 0.18,
  cs: 0.15,
  sv: 0.13,
  ka: 0.08
});

const CONSONANTS = "mkypwnstlhf.crbgdzjvqx18";
const FINAL_CONSONANTS = "ptkfscqmnxbdgzjv";
const SECOND_CONSONANTS = "fscyrwlxzjv";
const VOWELS = "iaueo6";
const TONES = "72";
const LAYER_ALPHABETS = Object.freeze({
  16: new Set("mkypwnstlhfcaiu"),
  19: new Set("acefhiklmnoprstuwy"),
  24: new Set("abcdefghijklmnoprstuwyz"),
  28: new Set("6abcdefghijklmnopqrstuvwxyz"),
  32: new Set("12678abcdefghijklmnopqrstuvwxyz")
});

function invalid(message, details = {}) {
  const error = new Error(message);
  error.code = "invalid-atom-word-generation";
  error.details = details;
  return error;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function stableString(value) {
  return typeof value === "string" ? value : "";
}

function normalizeConcept(value) {
  return normalizeEnglish30kWord(value).replace(/[ _]+/gu, "-");
}

function normalizeGrammarConcept(value) {
  return normalizeEnglish30kWord(value).replace(/\s+/gu, "_");
}

function sourceKeyVariants(value) {
  const concept = normalizeConcept(value);
  if (!concept) return [];
  return [...new Set([
    `X${concept}`,
    `X${concept.replace(/-/gu, "_")}`,
    `X${concept.replace(/-/gu, " ")}`
  ])];
}

export function parsePhoneticCatalog(source) {
  if (typeof source !== "string") throw invalid("phonetic catalog must be text");
  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    throw invalid("phonetic catalog JSON is malformed", { cause: error.message });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw invalid("phonetic catalog must be an object");
  }
  return {
    format: "pyachso2n-phonetics-json-v1",
    entries: parsed,
    sourceHash: sha256(source)
  };
}

export function parseAtomWordLists(wordLists) {
  if (!wordLists || typeof wordLists !== "object" || Array.isArray(wordLists)) {
    throw invalid("atom word lists must be an object");
  }
  const result = {};
  const sourceHashes = {};
  for (const layer of ATOM_WORD_LAYERS) {
    const source = wordLists[layer] ?? wordLists[String(layer)];
    if (typeof source !== "string") throw invalid("atom word list is missing", { layer });
    const words = source.split(/\r?\n/u).map((word) => word.trim()).filter(Boolean);
    const seen = new Set();
    for (const word of words) {
      if (seen.has(word)) throw invalid("atom word list contains a duplicate", { layer, word });
      seen.add(word);
      const alphabet = LAYER_ALPHABETS[layer];
      if ([...word].some((glyph) => !alphabet.has(glyph))) {
        throw invalid("atom word list contains a glyph outside its layer", { layer, word });
      }
    }
    result[layer] = words;
    sourceHashes[layer] = sha256(source);
  }
  return { words: result, sourceHashes };
}

export function parseLegacyPyashWords(source) {
  if (typeof source !== "string") throw invalid("legacy Pyash word source must be text");
  const entries = [];
  for (const [index, line] of source.split(/\r?\n/u).entries()) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const match = line.match(/^\s*(\S+)\s*\t\s*(.*?)\s*$/u);
    if (!match) throw invalid("legacy Pyash word source row is malformed", { index, line });
    entries.push({ pya: match[1], en: match[2].trim() });
  }
  return { entries, sourceHash: sha256(source) };
}

export async function loadAtomWordGenerationInputs({
  phoneticPath = DEFAULT_ATOM_WORD_PHONETIC_PATH,
  frequencyPath = DEFAULT_ATOM_WORD_FREQUENCY_PATH,
  layerDirectory = DEFAULT_ATOM_WORD_LAYER_DIRECTORY,
  legacyWordPath = DEFAULT_ATOM_WORD_LEGACY_PATH
} = {}) {
  const layers = await Promise.all(ATOM_WORD_LAYERS.map(async (layer) => [
    layer,
    await fs.readFile(resolve(layerDirectory, `${layer}GlyphWordList.txt`), "utf8")
  ]));
  const [phoneticSource, frequency, legacyWordSource, ...wordListSources] = await Promise.all([
    fs.readFile(phoneticPath, "utf8"),
    loadEnglish30k({ path: frequencyPath }),
    fs.readFile(legacyWordPath, "utf8"),
    ...layers.map(([, source]) => Promise.resolve(source))
  ]);
  const phonetics = parsePhoneticCatalog(phoneticSource);
  const legacyWords = parseLegacyPyashWords(legacyWordSource);
  const wordLists = parseAtomWordLists(Object.fromEntries(
    wordListSources.map((source, index) => [ATOM_WORD_LAYERS[index], source])
  ));
  return {
    format: ATOM_WORD_GENERATION_FORMAT,
    phonetics,
    frequency,
    wordLists,
    reservedEntries: legacyWords.entries,
    reservedWordSourceHash: legacyWords.sourceHash,
    sources: {
      phoneticPath: resolve(phoneticPath),
      frequencyPath: resolve(frequencyPath),
      layerDirectory: resolve(layerDirectory),
      legacyWordPath: resolve(legacyWordPath)
    }
  };
}

const IPA_REPLACEMENTS = [
  ["ي", "aj"], ["ﺶ", "s"], ["ﺷ", "s"], ["ت", "t"], ["ؤ", ""], ["ن", "n"],
  ["ﺗ", "t"], ["س", "s"], ["ط", "tˤ"], ["ﻷ", "lo"], ["ا", "a"], ["ﺔ", "t"],
  ["ﺃ", "ʔ"], ["ﺒ", "p"], ["ﺬ", "t"], ["ﺚ", "t"], ["ة", "t"], ["ل", "l"],
  ["ﻟ", "l"], ["ﺰ", "s"], ["ﺥ", "k"], ["ﻜ", "k"], ["ﺻ", "sˤ"], ["ب", "b"],
  ["ﻨ", "n"], ["ر", "r"], ["ﻦ", "n"], ["ى", "aj"], ["ﻗ", "q"], ["ث", "t"],
  ["ﺤ", "ħ"], ["ك", "k"], ["ﺴ", "s"], ["ع", "ʕ"], ["م", "ʕ"], ["ﻔ", "f"],
  ["ﺨ", "x"], ["ﻝ", "l"], ["ج", "dʒ"], ["ﻱ", "j"], ["ق", "g"], ["ﺧ", "x"],
  ["ﺜ", ""], ["ﻥ", "n"], ["\u064b", "n"], ["ﺎ", "a"], ["ﺋ", "ʔ"], ["ﺸ", "ʃ"],
  ["ﺍ", "a"], ["ﻀ", "ð"], ["ﻮ", "w"], ["ﻃ", "tˤ"], ["ح", "h"], ["ﺯ", "z"],
  ["ﺟ", "dʒ"], ["ﺠ", "dʒ"], ["ﻲ", "j"], ["ﻠ", "l"], ["ﻻ", "lo"], ["و", "w"],
  ["ﻤ", "m"], ["ﻴ", "ji"], ["ﻅ", "zˤ"], ["ﺂ", "ʔa:"], ["\u064f", "u"], ["ﻸ", "lo"],
  ["ف", "f"], ["ﺼ", "sˤ"], ["ﺆ", "ʔ"], ["ﺈ", "aʔ"], ["ﻺ", "lo"], ["ﺫ", "ð"],
  ["ﻐ", "ɣ"], ["ﺮ", "r"], ["ﻰ", "ji"], ["ش", "ʃ"], ["ز", "z"], ["ص", "sˤ"],
  ["خ", "x"], ["ﻳ", "ja"], ["ذ", "ð"], ["ه", "h"], ["ض", "dˤ"], ["ئ", "ʔ"],
  ["\u200b", ""], ["\\(..\\)", ""], ["\\(...\\)", ""], ["ˈ", ""], [",", ""],
  ["ˌ", ""], ["\\.", ""], ["\\^", ""], ["\\-", ""], ["_", ""], ['"', ""],
  ["ː", ""], [" ", ""], ["\n", ""], [":", ""], ["\u031d", ""], ["'", ""],
  ["[0-9]", ""], ["\u030a", ""], ["\\+", ""], ["`", ""], ["\u0303", ""],
  ["\u0329", ""], ["\u060c", ""], ["\u0361", ""], ["\ufeff", ""], ["\u032a", ""],
  ["y", "i"], ["Y", "i"], ["ɪ", "i"], ["ĩ", "i"], ["ɨ", "i"], ["ᵻ", "i"], ["I", "i"],
  ["ʏ", "i"], ["e", "e"], ["ɛ", "e"], ["ɜ", "e"], ["ø", "e"], ["œ̃", "e"], ["œ", "e"],
  ["E", "e"], ["æ", "a"], ["ɑ̃", "a"], ["ã", "a"], ["ɑ", "a"], ["ɐ̃", "a"], ["ɐ", "a"],
  ["A", "a"], ["ɒ", "o"], ["ʌ", "o"], ["o", "o"], ["ɔ", "o"], ["ɵ", "o"], ["õ", "o"],
  ["O", "o"], ["ʊ", "u"], ["ʉ", "u"], ["ũ", "u"], ["ɯ", "u"], ["ə", "6"], ["U", "u"],
  ["˨", "2"], ["˩", "2"], ["˥", "7"], ["˦", "7"], ["˧", ""], ["ʈ", "t"], ["t̪", "t"],
  ["ð", "d"], ["ɗ", "d"], ["ɖ", "d"], ["d", "d"], ["b", "b"], ["c", "k"], ["q", "k"],
  ["ʔ", "k"], ["ˀ", ""], ["ɟ", "g"], ["g", "g"], ["ɡ", "g"], ["ʟ", "l"], ["ɥ", "yw"],
  ["w̃", "w"], ["ʋ", "w"], ["l̩", "l"], ["ɫ", "l"], ["ɬ", "l"], ["ɭ", "l"], ["ʎ", "l"],
  ["L", "l"], ["j", "y"], ["ʲ", "y"], ["ɾ", "r"], ["ɹ", "r"], ["ɻ", "r"], ["ɚ", "r"],
  ["ʁ", "r"], ["R", "r"], ["ʀ", "r"], ["S", "s"], ["v", "v"], ["β", "b"], ["θ", "f"],
  ["ʃ", "c"], ["ʂ", "c"], ["ç", "c"], ["ɕ", "c"], ["ʒ", "j"], ["ʐ", "j"], ["ʑ", "j"],
  ["ʝ", "j"], ["x", "x"], ["ħ", "x"], ["h", "h"], ["ʰ", ""], ["ɣ", "x"], ["ʕ", "x"],
  ["؟", "x"], ["ˤ", ""], ["χ", "x"], ["m̩", "m"], ["ɳ", "n"], ["ŋ", "q"], ["ɲ", "q"]
];

function normalizeIpaTo32(value) {
  let word = stableString(value).toLowerCase();
  for (const [pattern, replacement] of IPA_REPLACEMENTS) word = word.replace(new RegExp(pattern, "g"), replacement);
  for (const glyph of word) {
    if (!LAYER_ALPHABETS[32].has(glyph)) {
      throw invalid("phonetic source contains an unsupported glyph", { value, glyph, normalized: word });
    }
  }
  return word;
}

export function normalizeIpaToLayer(value, layer) {
  if (!ATOM_WORD_LAYERS.includes(layer)) throw invalid("unsupported atom word layer", { layer });
  let word = normalizeIpaTo32(value);
  if (layer <= 28) word = word.replace(/[1278]/gu, "");
  if (layer <= 24) word = word.replace(/6/gu, "").replace(/v/gu, "w").replace(/q/gu, "n").replace(/x/gu, "c");
  if (layer <= 19) word = word.replace(/b/gu, "p").replace(/d/gu, "t").replace(/g/gu, "k").replace(/z/gu, "s").replace(/j/gu, "c");
  if (layer <= 16) word = word.replace(/e/gu, "i").replace(/o/gu, "u").replace(/r/gu, "y").replace(/h/gu, "k");
  for (const glyph of word) {
    if (!LAYER_ALPHABETS[layer].has(glyph)) {
      throw invalid("phonetic projection contains a glyph outside its layer", { layer, glyph, word });
    }
  }
  return word;
}

function arrayUnique(values) {
  return [...new Set(values)];
}

function addTypeOfGlyphToObject(allowed, target, weight, glyph) {
  if (!allowed.includes(glyph)) return;
  target[glyph] = (target[glyph] ?? 0) + weight;
}

function addGlyphs(profile, glyphWord, weight) {
  if (!glyphWord) return;
  const glyphs = [...glyphWord];
  const length = glyphs.length;
  const segmentLength = Math.ceil(length / 3);
  const middleStart = Math.floor(length / 3);
  const finalStart = length - (segmentLength + 1);
  for (const glyph of arrayUnique(glyphs)) {
    addTypeOfGlyphToObject(CONSONANTS, profile.consonants, weight, glyph);
    addTypeOfGlyphToObject(VOWELS, profile.vowels, weight, glyph);
    addTypeOfGlyphToObject(TONES, profile.tone, weight, glyph);
  }
  for (const glyph of arrayUnique(glyphs.slice(0, segmentLength))) {
    addTypeOfGlyphToObject(CONSONANTS, profile.initialConsonants, weight, glyph);
  }
  for (const glyph of arrayUnique(glyphs.slice(middleStart, middleStart + segmentLength))) {
    addTypeOfGlyphToObject(SECOND_CONSONANTS, profile.middleConsonants, weight, glyph);
  }
  for (const glyph of arrayUnique(glyphs.slice(finalStart))) {
    addTypeOfGlyphToObject(FINAL_CONSONANTS, profile.finalConsonants, weight, finalConsonantGlyph(glyph));
  }
}

function finalConsonantGlyph(glyph) {
  return { q: "n", b: "p", d: "t", g: "k", v: "f", z: "s", j: "c" }[glyph] ?? glyph;
}

function glyphEvidence(glyphWord) {
  const glyphs = [...glyphWord];
  const segmentLength = Math.ceil(glyphs.length / 3);
  const middleStart = Math.floor(glyphs.length / 3);
  const finalStart = glyphs.length - (segmentLength + 1);
  return {
    initialConsonants: arrayUnique(glyphs.slice(0, segmentLength)),
    middleConsonants: arrayUnique(glyphs.slice(middleStart, middleStart + segmentLength)),
    vowels: arrayUnique(glyphs.filter((glyph) => VOWELS.includes(glyph))),
    tones: arrayUnique(glyphs.filter((glyph) => TONES.includes(glyph))),
    finalConsonants: arrayUnique(glyphs.slice(finalStart).map(finalConsonantGlyph))
  };
}

function emptyProfile() {
  return {
    consonants: {},
    vowels: {},
    initialConsonants: {},
    middleConsonants: {},
    finalConsonants: {},
    tone: {}
  };
}

export function buildWeightedPhoneticProfile(phoneticEntry, {
  layer = 16,
  weights = NATIVE_LANGUAGE_WEIGHTS
} = {}) {
  if (!phoneticEntry || typeof phoneticEntry !== "object") {
    throw invalid("phonetic entry must be an object");
  }
  const profile = emptyProfile();
  const languages = [];
  const evidence = [];
  for (const [language, weight] of Object.entries(weights)) {
    const phonetic = stableString(phoneticEntry[language]);
    if (!phonetic.trim()) continue;
    const glyphWord = normalizeIpaToLayer(phonetic, layer);
    addGlyphs(profile, glyphWord, weight);
    languages.push(language);
    evidence.push({ language, weight, glyphWord, ...glyphEvidence(glyphWord) });
  }
  if (languages.length === 0) throw invalid("phonetic entry has no weighted language evidence");
  return { profile, languages, layer, evidence };
}

function candidateShape(word, kind = "root") {
  const glyphs = [...word];
  if (kind === "grammar") {
    if (glyphs.length === 2) {
      return [
        { role: "initial", glyph: glyphs[0] },
        { role: "vowel", glyph: glyphs[1] }
      ];
    }
    if (glyphs.length === 3) {
      return [
        { role: "initial", glyph: glyphs[0] },
        { role: "vowel", glyph: glyphs[1] },
        { role: "tone", glyph: glyphs[2] }
      ];
    }
    if (glyphs.length === 4 && glyphs.at(-1) === "h") {
      return [
        { role: "initial", glyph: glyphs[0] },
        { role: "middle", glyph: glyphs[1] },
        { role: "vowel", glyph: glyphs[2] }
      ];
    }
    if (glyphs.length === 5 && glyphs.at(-1) === "h") {
      return [
        { role: "initial", glyph: glyphs[0] },
        { role: "middle", glyph: glyphs[1] },
        { role: "vowel", glyph: glyphs[2] },
        { role: "tone", glyph: glyphs[3] }
      ];
    }
    return [];
  }
  if (glyphs.length === 5 && glyphs[0] === "h") {
    return [
      { role: "initial", glyph: glyphs[1] },
      { role: "vowel", glyph: glyphs[2] },
      { role: "tone", glyph: glyphs[3] },
      { role: "final", glyph: glyphs[4] }
    ];
  }
  if (glyphs.length === 4 && glyphs[0] === "h") {
    return [
      { role: "initial", glyph: glyphs[1] },
      { role: "vowel", glyph: glyphs[2] },
      { role: "final", glyph: glyphs[3] }
    ];
  }
  if (glyphs.length === 5) {
    return [
      { role: "initial", glyph: glyphs[0] },
      { role: "middle", glyph: glyphs[1] },
      { role: "vowel", glyph: glyphs[2] },
      { role: "tone", glyph: glyphs[3] },
      { role: "final", glyph: glyphs[4] }
    ];
  }
  if (glyphs.length !== 4) return [];
  return [
    { role: "initial", glyph: glyphs[0] },
    { role: "middle", glyph: glyphs[1] },
    { role: "vowel", glyph: glyphs[2] },
    { role: "final", glyph: glyphs[3] }
  ];
}

export function buildPhoneticContributors(word, evidence = [], { kind = "root" } = {}) {
  return candidateShape(word, kind).map(({ role, glyph }) => {
    const evidenceKey = {
      initial: "initialConsonants",
      middle: "middleConsonants",
      vowel: "vowels",
      tone: "tones",
      final: "finalConsonants"
    }[role];
    const sources = evidence.filter((source) => source[evidenceKey]?.includes(glyph));
    return {
      role,
      glyph,
      languages: sources.map((source) => source.language),
      languageCount: sources.length,
      populationWeight: roundSupport(sources.reduce((total, source) => total + source.weight, 0))
    };
  });
}

function roundSupport(value) {
  return Math.round(value * 1000000) / 1000000;
}

function buildPhoneticSupport(contributors) {
  if (!contributors.length) {
    return {
      minimumPopulationWeight: 0,
      totalPopulationWeight: 0,
      minimumLanguageCount: 0,
      totalLanguageCount: 0
    };
  }
  return {
    minimumPopulationWeight: Math.min(...contributors.map((entry) => entry.populationWeight)),
    totalPopulationWeight: roundSupport(contributors.reduce((total, entry) => total + entry.populationWeight, 0)),
    minimumLanguageCount: Math.min(...contributors.map((entry) => entry.languageCount)),
    totalLanguageCount: contributors.reduce((total, entry) => total + entry.languageCount, 0)
  };
}

function objectToWeightedArray(value) {
  return Object.keys(value).map((key) => [key, value[key]]);
}

function addWeighted(typeList, start) {
  return Object.keys(typeList).map((end) => [
    start[0] + end,
    typeList[end] + start[1]
  ]);
}

function averageWeight(entries) {
  return entries.map(([word, weight]) => {
    let length = word.length;
    if (word[0] === "h" || word.at(-1) === "h") length -= 1;
    return [word, length > 0 ? weight / length | 0 : weight];
  });
}

export function generateRootCandidates(profile) {
  const vowels = profile.vowels;
  const initials = objectToWeightedArray(profile.initialConsonants);
  const middles = profile.middleConsonants;
  const finals = profile.finalConsonants;
  const tones = profile.tone;
  let cvf = initials.flatMap((start) => addWeighted(vowels, start));
  let csvf = initials.flatMap((start) => addWeighted(middles, start));
  csvf = csvf.flatMap((start) => addWeighted(vowels, start));
  const words = [];
  if (Object.keys(tones).length > 0) {
    const cvtf = cvf.flatMap((start) => addWeighted(tones, start)).flatMap((start) => addWeighted(finals, start));
    const csvtf = csvf.flatMap((start) => addWeighted(tones, start)).flatMap((start) => addWeighted(finals, start));
    words.push(...cvtf.map(([word, weight]) => [`h${word}`, weight]), ...csvtf);
  }
  cvf = cvf.flatMap((start) => addWeighted(finals, start));
  csvf = csvf.flatMap((start) => addWeighted(finals, start));
  words.push(...cvf.map(([word, weight]) => [`h${word}`, weight]), ...csvf);
  return averageWeight(words).sort((left, right) => right[1] - left[1]);
}

export function generateGrammarCandidates(profile) {
  const vowels = profile.vowels;
  const initials = objectToWeightedArray(profile.initialConsonants);
  const middles = profile.middleConsonants;
  const tones = profile.tone;
  const words = [];
  let cv = initials.flatMap((start) => addWeighted(vowels, start));
  let ccv = initials.flatMap((start) => addWeighted(middles, start));
  ccv = ccv.flatMap((start) => addWeighted(vowels, start));
  if (Object.keys(tones).length > 0) {
    words.push(
      ...cv.flatMap((start) => addWeighted(tones, start)),
      ...ccv.flatMap((start) => addWeighted(tones, start)).map(([word, weight]) => [`${word}h`, weight])
    );
  }
  words.push(
    ...cv,
    ...ccv.map(([word, weight]) => [`${word}h`, weight])
  );
  return averageWeight(words).sort((left, right) => right[1] - left[1]);
}

function normalizeHnuc(value) {
  if (typeof value === "number" && Number.isInteger(value)) return `0x${value.toString(16)}`;
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase().replace(/^0x0+/u, "0x") || "0x0";
}

function usedInventory(entries) {
  const words = new Set();
  const hnucs = new Set();
  for (const entry of entries ?? []) {
    if (typeof entry?.pya !== "string" || !entry.pya) continue;
    words.add(entry.pya);
    try {
      hnucs.add(normalizeHnuc(encodePyacWord(entry.pya)));
    } catch {
      if (entry.hnuc !== undefined) hnucs.add(normalizeHnuc(entry.hnuc));
    }
  }
  return { words, hnucs };
}

function frequencyRecord(frequency, concept) {
  const normalized = normalizeEnglish30kWord(concept);
  return frequency?.rows?.find((row) => row.normalizedWord === normalized) ?? null;
}

function findPhoneticEntry(phonetics, concept) {
  for (const key of sourceKeyVariants(concept)) {
    if (phonetics?.entries?.[key]) return { key, entry: phonetics.entries[key] };
  }
  return null;
}

function sourceEvidence({ phonetics, frequency, wordLists, sources, reservedWordSourceHash }) {
  return {
    ...(phonetics?.sourceHash ? { phoneticSourceHash: phonetics.sourceHash } : {}),
    ...(frequency?.sourceHash ? { frequencySourceHash: frequency.sourceHash } : {}),
    ...(wordLists?.sourceHashes ? { layerSourceHashes: wordLists.sourceHashes } : {}),
    ...(reservedWordSourceHash ? { reservedWordSourceHash } : {}),
    ...(sources ? { sources } : {})
  };
}

function compareCandidateSupport(left, right) {
  for (const field of [
    "minimumPopulationWeight",
    "totalPopulationWeight",
    "minimumLanguageCount",
    "totalLanguageCount"
  ]) {
    const difference = right.phoneticSupport[field] - left.phoneticSupport[field];
    if (difference !== 0) return difference;
  }
  return right.score - left.score;
}

function candidateRows(generated, available, used, evidence, candidateKind) {
  const availableWords = Array.isArray(available)
    ? available
    : typeof available === "string"
      ? available.split(/\r?\n/u).map((word) => word.trim()).filter(Boolean)
      : [];
  const availableSet = new Set(availableWords);
  const seen = new Set();
  const rows = [];
  let rejectedWord = 0;
  let rejectedHnuc = 0;
  for (const [word, score] of generated) {
    if (seen.has(word)) continue;
    seen.add(word);
    if (!availableSet.has(word) || used.words.has(word)) {
      rejectedWord += 1;
      continue;
    }
    let hnuc;
    try {
      hnuc = encodePyacWord(word);
    } catch {
      rejectedWord += 1;
      continue;
    }
    const normalizedHnuc = normalizeHnuc(hnuc);
    if (used.hnucs.has(normalizedHnuc)) {
      rejectedHnuc += 1;
      continue;
    }
    const phoneticContributors = buildPhoneticContributors(word, evidence, { kind: candidateKind });
    rows.push({
      word,
      hnuc: `0x${hnuc.toString(16).toUpperCase()}`,
      score,
      phoneticContributors,
      phoneticSupport: buildPhoneticSupport(phoneticContributors)
    });
  }
  rows.sort(candidateKind === "root"
    ? compareCandidateSupport
    : (left, right) => right.score - left.score);
  return { rows, rejectedWord, rejectedHnuc };
}

export function buildAtomWordProposal({
  concept,
  phonetics,
  frequency,
  wordLists,
  existingEntries = pyashWords,
  minLayer = 16,
  maxLayer = 32,
  weights = NATIVE_LANGUAGE_WEIGHTS,
  candidateLimit = 12,
  sources,
  skipExistingConcept = false,
  reservedEntries = [],
  reservedWordSourceHash,
  candidateGenerator = generateRootCandidates,
  candidateKind = "root"
} = {}) {
  const normalizedConcept = normalizeConcept(concept);
  if (!normalizedConcept) throw invalid("atom word concept must be non-empty text");
  if (!ATOM_WORD_LAYERS.includes(minLayer) || !ATOM_WORD_LAYERS.includes(maxLayer) || minLayer > maxLayer) {
    throw invalid("atom word layer range is invalid", { minLayer, maxLayer });
  }
  const existing = skipExistingConcept
    ? null
    : (existingEntries ?? []).find((entry) => normalizeConcept(entry?.en) === normalizedConcept);
  if (existing) {
    return {
      format: ATOM_WORD_GENERATION_FORMAT,
      concept: normalizedConcept,
      status: "already-present",
      existing: { en: existing.en, pya: existing.pya, hnuc: existing.hnuc },
      ...sourceEvidence({ phonetics, frequency, wordLists, sources, reservedWordSourceHash })
    };
  }
  const phoneticMatch = findPhoneticEntry(phonetics, normalizedConcept);
  if (!phoneticMatch) {
    return {
      format: ATOM_WORD_GENERATION_FORMAT,
      concept: normalizedConcept,
      status: "missing-phonetic-evidence",
      frequency: frequencyRecord(frequency, normalizedConcept),
      ...sourceEvidence({ phonetics, frequency, wordLists, sources, reservedWordSourceHash })
    };
  }
  const used = usedInventory([...(existingEntries ?? []), ...reservedEntries]);
  const layers = [];
  let selected = null;
  let rejectedWord = 0;
  let rejectedHnuc = 0;
  for (const layer of ATOM_WORD_LAYERS.filter((value) => value >= minLayer && value <= maxLayer)) {
    const weighted = buildWeightedPhoneticProfile(phoneticMatch.entry, { layer, weights });
    const generated = candidateGenerator(weighted.profile);
    const rows = candidateRows(
      generated,
      wordLists?.words?.[layer] ?? wordLists?.[layer] ?? [],
      used,
      weighted.evidence,
      candidateKind
    );
    rejectedWord += rows.rejectedWord;
    rejectedHnuc += rows.rejectedHnuc;
    const layerResult = {
      layer,
      languages: weighted.languages,
      generatedCandidates: generated.length,
      availableCandidates: rows.rows.length,
      candidates: rows.rows.slice(0, candidateLimit)
    };
    layers.push(layerResult);
    if (!selected && rows.rows[0]) selected = { layer, ...rows.rows[0] };
  }
  if (!selected) {
    return {
      format: ATOM_WORD_GENERATION_FORMAT,
      concept: normalizedConcept,
      status: "no-non-overlapping-candidate",
      frequency: frequencyRecord(frequency, normalizedConcept),
      phoneticKey: phoneticMatch.key,
      phoneticLanguages: Object.keys(weights).filter((language) => stableString(phoneticMatch.entry[language]).trim()),
      rejectedWord,
      rejectedHnuc,
      layers,
      ...sourceEvidence({ phonetics, frequency, wordLists, sources, reservedWordSourceHash })
    };
  }
  return {
    format: ATOM_WORD_GENERATION_FORMAT,
    concept: normalizedConcept,
    status: "candidate",
    frequency: frequencyRecord(frequency, normalizedConcept),
    phoneticKey: phoneticMatch.key,
    phoneticLanguages: Object.keys(weights).filter((language) => stableString(phoneticMatch.entry[language]).trim()),
    selected,
    rejectedWord,
    rejectedHnuc,
    layers,
    ...sourceEvidence({ phonetics, frequency, wordLists, sources, reservedWordSourceHash })
  };
}

export function buildGrammarWordProposal({
  concept,
  sourceConcept = concept,
  existingEntries = pyashWords,
  ...options
} = {}) {
  const normalizedGrammarConcept = normalizeGrammarConcept(concept);
  const normalizedSourceConcept = normalizeConcept(sourceConcept).replace(/_$/u, "");
  if (!normalizedGrammarConcept.endsWith("_")) {
    throw invalid("grammar word concept must end with an underscore", { concept });
  }
  if (!normalizedSourceConcept) throw invalid("grammar word source concept must be non-empty", { sourceConcept });
  const existing = (existingEntries ?? []).find((entry) => normalizeGrammarConcept(entry?.en) === normalizedGrammarConcept);
  if (existing) {
    return {
      format: ATOM_WORD_GENERATION_FORMAT,
      category: "grammar",
      concept: normalizedGrammarConcept,
      sourceConcept: normalizedSourceConcept,
      status: "already-present",
      existing: { en: existing.en, pya: existing.pya, hnuc: existing.hnuc },
      ...sourceEvidence(options)
    };
  }
  const proposal = buildAtomWordProposal({
    ...options,
    concept: normalizedSourceConcept,
    existingEntries,
    reservedEntries: options.reservedEntries,
    skipExistingConcept: true,
    candidateGenerator: generateGrammarCandidates,
    candidateKind: "grammar"
  });
  return {
    ...proposal,
    category: "grammar",
    concept: normalizedGrammarConcept,
    sourceConcept: normalizedSourceConcept
  };
}

export function renderAtomWordProposalPya(proposal, {
  name = ATOM_WORD_GENERATION_NAME
} = {}) {
  if (!proposal || typeof proposal !== "object" || !proposal.concept) {
    throw invalid("atom word proposal must contain a concept");
  }
  const key = proposal.concept.replace(/[^a-z0-9-]/gu, "-");
  return [
    `su name ${name} be map def`,
    `su text "format" ob text "${ATOM_WORD_GENERATION_FORMAT}" ya`,
    `su text ${JSON.stringify(key)} ob text ${JSON.stringify(JSON.stringify(proposal))} ya`,
    "prah",
    ""
  ].join("\n");
}

