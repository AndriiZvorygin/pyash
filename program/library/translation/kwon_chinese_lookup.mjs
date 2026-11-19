import fs from "node:fs/promises";
import { parse } from "../../understand/index.mjs";
import {
  acceptedChineseCharacterAtomRows,
  parseChineseCharacterAtomLinks
} from "./chinese_character_atom_refinery.mjs";
import {
  lookupCowChineseFormsByWordNetSenses,
  parseCowWordNetCrosswalkPya
} from "./cow_wordnet_crosswalk.mjs";
import { loadEnglishGrammarCatalog } from "./english_grammar.mjs";

const KWON_CHINESE_URL = new URL("../../../caterer/pyac/lyac/kwon_zh.json", import.meta.url);
const PINYIN_INDEX_URL = new URL("./kwon_chinese_pinyin.pya", import.meta.url);
const ACCEPTED_LINKS_URL = new URL("./chinese_character_atom_links.pya", import.meta.url);
const COW_WORDNET_CROSSWALK_URL = new URL("./cow_wordnet_crosswalk.pya", import.meta.url);

let chineseIndexPromise = null;
let pinyinIndexPromise = null;
let cowWordNetIndexPromise = null;

function normalize(value) {
  return String(value ?? "").trim().normalize("NFC").toLowerCase();
}

async function loadChineseIndex() {
  if (!chineseIndexPromise) {
    chineseIndexPromise = Promise.all([
      fs.readFile(KWON_CHINESE_URL, "utf8"),
      fs.readFile(ACCEPTED_LINKS_URL, "utf8"),
      loadEnglishGrammarCatalog()
    ]).then(([source, linksSource, grammarCatalog]) => {
      const sourceRows = JSON.parse(source);
      if (!Array.isArray(sourceRows)) throw new Error("Kwon Chinese vocabulary must be an array");
      const rootRows = acceptedChineseCharacterAtomRows(sourceRows, parseChineseCharacterAtomLinks(linksSource));
      const rootTargetsByCharacter = new Map();
      const rootCharactersByPyash = new Map();
      for (const row of rootRows) {
        const characterTargets = rootTargetsByCharacter.get(row.character) ?? new Set();
        characterTargets.add(normalize(row.pya));
        rootTargetsByCharacter.set(row.character, characterTargets);
        const pyashCharacters = rootCharactersByPyash.get(normalize(row.pya)) ?? new Set();
        pyashCharacters.add(row.character);
        rootCharactersByPyash.set(normalize(row.pya), pyashCharacters);
      }
      const grammarRows = grammarCatalog.chineseCharacterLinks
        .filter((link) => {
          const characterTargets = rootTargetsByCharacter.get(link.character);
          if (characterTargets?.size > 0 && !characterTargets.has(normalize(link.pya))) return false;
          const pyashCharacters = rootCharactersByPyash.get(normalize(link.pya));
          return !pyashCharacters?.size || pyashCharacters.has(link.character);
        })
        .map((link) => ({
          character: link.character,
          english: link.english,
          pya: link.pya,
          source: "pyash-grammar"
        }));
      const seenMappings = new Set();
      const rows = [...rootRows, ...grammarRows].filter((row) => {
        const key = `${normalize(row.pya)}\u0000${row.character}`;
        if (seenMappings.has(key)) return false;
        seenMappings.add(key);
        return true;
      });
      const byPyash = new Map();
      for (const row of rows) {
        const pyash = normalize(row?.pya);
        const chinese = String(row?.character ?? "").trim().normalize("NFC");
        const english = String(row?.english ?? "").trim();
        if (!pyash || !chinese || !english) continue;
        const matches = byPyash.get(pyash) ?? [];
        matches.push({ pyash, chinese, english });
        byPyash.set(pyash, matches);
      }
      for (const matches of byPyash.values()) {
        matches.sort((left, right) => left.english.localeCompare(right.english)
          || left.chinese.localeCompare(right.chinese));
      }
      return byPyash;
    });
  }
  return chineseIndexPromise;
}

async function loadPinyinIndex() {
  if (!pinyinIndexPromise) {
    pinyinIndexPromise = fs.readFile(PINYIN_INDEX_URL, "utf8").then((source) => {
      const byChinese = new Map();
      const characterGlosses = new Map();
      for (const line of source.split(/\r?\n/u)) {
        if (!line.trim()) continue;
        const sentence = parse(line.trim());
        const chinese = String(sentence?.su?.text ?? "").trim().normalize("NFC");
        const value = String(sentence?.ob?.text ?? "").trim();
        if (!chinese || chinese.startsWith("meta:") || !value) continue;
        const readings = [...new Set(value.split(" || ").map((reading) => reading.trim()).filter(Boolean))];
        if (chinese.startsWith("character:") && readings.length > 0) {
          characterGlosses.set(normalize(chinese.slice("character:".length)), readings);
        } else if (readings.length > 0) {
          byChinese.set(normalize(chinese), readings);
        }
      }
      return { byChinese, characterGlosses };
    });
  }
  return pinyinIndexPromise;
}

async function loadCowWordNetIndex() {
  if (!cowWordNetIndexPromise) {
    cowWordNetIndexPromise = fs.readFile(COW_WORDNET_CROSSWALK_URL, "utf8")
      .then(parseCowWordNetCrosswalkPya);
  }
  return cowWordNetIndexPromise;
}

export async function lookupChineseByPyash(pyash) {
  const index = await loadChineseIndex();
  return [...(index.get(normalize(pyash)) ?? [])];
}

export async function lookupChineseByWordNetSenses(senseIds) {
  if (!Array.isArray(senseIds) || senseIds.length === 0) return [];
  const crosswalk = await loadCowWordNetIndex();
  return lookupCowChineseFormsByWordNetSenses(crosswalk, senseIds);
}

export async function lookupChinesePinyin(chinese) {
  const { byChinese } = await loadPinyinIndex();
  return [...(byChinese.get(normalize(chinese)) ?? [])];
}

export async function lookupChineseCharacterGlosses(chinese) {
  const { characterGlosses } = await loadPinyinIndex();
  return [...String(chinese ?? "").normalize("NFC")].map((character) => ({
    character,
    glosses: [...(characterGlosses.get(normalize(character)) ?? [])].slice(0, 4)
  }));
}
