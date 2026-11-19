#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadChineseCompoundLexicon, parseCompoundLexicon } from "../program/library/translation/compound_lexicon.mjs";
import {
  acceptedChineseCharacterAtomRows,
  parseChineseCharacterAtomLinks
} from "../program/library/translation/chinese_character_atom_refinery.mjs";
import { loadEnglishGrammarCatalog } from "../program/library/translation/english_grammar.mjs";

const COMMAND_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(COMMAND_DIR, "..");
const KWON_CHINESE_PATH = path.join(REPOSITORY_ROOT, "caterer", "pyac", "lyac", "kwon_zh.json");
const ACCEPTED_LINKS_PATH = path.join(REPOSITORY_ROOT, "program", "library", "translation", "chinese_character_atom_links.pya");
const CEDICT_PATH = path.resolve(REPOSITORY_ROOT, "..", "hkestlat", "cedict_1_0_ts_utf-8_mdbg.txt");
const VERIFIED_COMPOUNDS_PATH = path.join(REPOSITORY_ROOT, "program", "library", "translation", "compound_coverage_wordnet_verified.pya");
const OUTPUT_PATH = path.join(REPOSITORY_ROOT, "program", "library", "translation", "kwon_chinese_pinyin.pya");

const TONE_MARKS = {
  a: ["ā", "á", "ǎ", "à"],
  e: ["ē", "é", "ě", "è"],
  i: ["ī", "í", "ǐ", "ì"],
  o: ["ō", "ó", "ǒ", "ò"],
  u: ["ū", "ú", "ǔ", "ù"],
  "ü": ["ǖ", "ǘ", "ǚ", "ǜ"]
};

function toneMarkSyllable(input) {
  const match = String(input ?? "").trim().toLowerCase().match(/^(.+?)([1-5])$/u);
  if (!match) return String(input ?? "").trim().toLowerCase().replace(/u:/gu, "ü").replace(/v/gu, "ü");
  const tone = Number(match[2]);
  let syllable = match[1].replace(/u:/gu, "ü").replace(/v/gu, "ü");
  if (tone === 5) return syllable;

  let vowel = syllable.includes("a")
    ? "a"
    : syllable.includes("e")
      ? "e"
      : syllable.includes("ou")
        ? "o"
        : [...syllable].reverse().find((character) => Object.hasOwn(TONE_MARKS, character));
  if (!vowel) return `${syllable}${tone}`;
  const replacement = TONE_MARKS[vowel]?.[tone - 1];
  if (!replacement) return `${syllable}${tone}`;
  return syllable.replace(vowel, replacement);
}

function toneMarkPinyin(value) {
  return String(value ?? "").trim().split(/\s+/u).filter(Boolean).map(toneMarkSyllable).join(" ");
}

function renderText(value) {
  return JSON.stringify(String(value));
}

const kwonRows = JSON.parse(await fs.readFile(KWON_CHINESE_PATH, "utf8"));
if (!Array.isArray(kwonRows)) throw new Error(`Kwon Chinese vocabulary must be an array: ${KWON_CHINESE_PATH}`);
const wantedForms = new Set(kwonRows.map((row) => String(row?.zh ?? "").trim().normalize("NFC")).filter(Boolean));
const acceptedLinks = parseChineseCharacterAtomLinks(await fs.readFile(ACCEPTED_LINKS_PATH, "utf8"));
for (const row of acceptedChineseCharacterAtomRows(kwonRows, acceptedLinks)) wantedForms.add(row.character);
const grammarCatalog = await loadEnglishGrammarCatalog();
for (const link of grammarCatalog.chineseCharacterLinks) wantedForms.add(link.character);
const chineseCompoundRows = await loadChineseCompoundLexicon();
for (const row of chineseCompoundRows) {
  if (row.surface) wantedForms.add(String(row.surface).trim().normalize("NFC"));
  if (row.sourceSurfaces?.chinese) wantedForms.add(String(row.sourceSurfaces.chinese).trim().normalize("NFC"));
}
const verifiedCompoundSource = await fs.readFile(VERIFIED_COMPOUNDS_PATH, "utf8");
const verifiedCompoundRows = parseCompoundLexicon(verifiedCompoundSource, {
  name: "translation_compounds_derived_curated",
  language: "canonical"
});
for (const row of verifiedCompoundRows) {
  if (row.sourceSurfaces?.chinese) wantedForms.add(String(row.sourceSurfaces.chinese).trim().normalize("NFC"));
  const chineseParts = row.sourceMorphemesByLanguage?.chinese;
  if (Array.isArray(chineseParts) && chineseParts.length > 0) wantedForms.add(chineseParts.join("").normalize("NFC"));
}
const wantedCharacters = new Set([...wantedForms].flatMap((form) => [...form])
  .filter((character) => /\p{Script=Han}/u.test(character)));
const pinyinByForm = new Map();
const glossesByCharacter = new Map();
const cedict = await fs.readFile(CEDICT_PATH, "utf8");
for (const line of cedict.split(/\r?\n/u)) {
  if (!line || line.startsWith("#")) continue;
  const match = line.match(/^(\S+)\s+(\S+)\s+\[([^\]]+)\]/u);
  if (!match) continue;
  const pinyin = toneMarkPinyin(match[3]);
  const definitions = line.slice(match[0].length).trim().replace(/^\/+|\/+$/gu, "").split("/")
    .map((definition) => definition.trim())
    .filter((definition) => definition && !/^CL:/u.test(definition));
  for (const form of [match[1], match[2]]) {
    const normalizedForm = form.normalize("NFC");
    if (wantedForms.has(normalizedForm) && pinyin) {
      const readings = pinyinByForm.get(normalizedForm) ?? new Set();
      readings.add(pinyin);
      pinyinByForm.set(normalizedForm, readings);
    }
    if ([...normalizedForm].length === 1 && wantedCharacters.has(normalizedForm)) {
      const glosses = glossesByCharacter.get(normalizedForm) ?? new Set();
      definitions.forEach((definition) => glosses.add(definition));
      glossesByCharacter.set(normalizedForm, glosses);
    }
  }
}

const rows = [...pinyinByForm.entries()]
  .sort(([left], [right]) => left.localeCompare(right))
  .map(([form, readings]) => `su text ${renderText(form)} ob text ${renderText([...readings].sort().join(" || "))} ya`);
const characterRows = [...glossesByCharacter.entries()]
  .sort(([left], [right]) => left.localeCompare(right))
  .map(([character, glosses]) => `su text ${renderText(`character:${character}`)} ob text ${renderText([...glosses].slice(0, 8).join(" || "))} ya`);
const output = [
  "su name kwon_chinese_pinyin_index be map def",
  `su text "meta:source" ob text "CC-CEDICT 1.0; projected onto Kwon forms and accepted Chinese compounds; https://cc-cedict.org/wiki/" ya`,
  `su text "meta:attribution" ob text "Copyright Paul Andrew Denisowski and CC-CEDICT contributors" ya`,
  `su text "meta:license" ob text "CC BY-SA 4.0" ya`,
  ...rows,
  ...characterRows,
  "prah",
  ""
].join("\n");
await fs.writeFile(OUTPUT_PATH, output, "utf8");
process.stdout.write(`indexed Pinyin for ${pinyinByForm.size} of ${wantedForms.size} Chinese forms and glosses for ${glossesByCharacter.size} characters in ${OUTPUT_PATH}\n`);
