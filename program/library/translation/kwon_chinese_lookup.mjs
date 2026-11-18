import fs from "node:fs/promises";
import { parse } from "../../understand/index.mjs";
import {
  acceptedChineseCharacterAtomRows,
  parseChineseCharacterAtomLinks
} from "./chinese_character_atom_refinery.mjs";

const KWON_CHINESE_URL = new URL("../../../caterer/pyac/lyac/kwon_zh.json", import.meta.url);
const PINYIN_INDEX_URL = new URL("./kwon_chinese_pinyin.pya", import.meta.url);
const ACCEPTED_LINKS_URL = new URL("./chinese_character_atom_links.pya", import.meta.url);

let kwonChinesePromise = null;
let pinyinIndexPromise = null;

function normalize(value) {
  return String(value ?? "").trim().normalize("NFC").toLowerCase();
}

async function loadKwonChineseIndex() {
  if (!kwonChinesePromise) {
    kwonChinesePromise = Promise.all([
      fs.readFile(KWON_CHINESE_URL, "utf8"),
      fs.readFile(ACCEPTED_LINKS_URL, "utf8")
    ]).then(([source, linksSource]) => {
      const sourceRows = JSON.parse(source);
      if (!Array.isArray(sourceRows)) throw new Error("Kwon Chinese vocabulary must be an array");
      const rows = acceptedChineseCharacterAtomRows(sourceRows, parseChineseCharacterAtomLinks(linksSource));
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
  return kwonChinesePromise;
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

export async function lookupKwonChineseByPyash(pyash) {
  const index = await loadKwonChineseIndex();
  return [...(index.get(normalize(pyash)) ?? [])];
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
