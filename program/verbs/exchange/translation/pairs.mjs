import fs from "node:fs/promises";

let cachedEnglishPairs = null;
let cachedEnglishPairsError = null;
let cachedRussianPairs = null;
let cachedRussianPairsError = null;
let cachedFrenchPairs = null;
let cachedFrenchPairsError = null;

const ENTRY_REGEX = /^su text (\"(?:\\\\.|[^\"\\\\])*\") ob text (\"(?:\\\\.|[^\"\\\\])*\") ya$/;

function normalizeText(value) {
  if (typeof value !== "string") return value;
  return value.replaceAll("\\n", "\n");
}

function buildPairsMapFromText(text, { label }) {
  const map = new Map();
  const lines = String(text).split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(ENTRY_REGEX);
    if (!match) continue;
    const key = normalizeText(JSON.parse(match[1]));
    const value = normalizeText(JSON.parse(match[2]));
    if (!key) {
      throw new Error("translation pairs: entry missing su");
    }
    if (key.includes("__QUOTED_BLOCK__")) {
      continue;
    }
    if (map.has(key)) {
      const suffix = label ? ` in ${label}` : "";
      throw new Error(`translation pairs: duplicate key "${key}"${suffix}`);
    }
    map.set(key, typeof value === "string" ? value : "");
  }
  if (map.size === 0) {
    throw new Error(`translation pairs missing: ${label ?? "unknown"}`);
  }
  return map;
}

export async function loadEnglishTranslationPairs() {
  if (cachedEnglishPairs) return cachedEnglishPairs;
  if (cachedEnglishPairsError) throw cachedEnglishPairsError;
  try {
    const fileUrl = new URL("./pairs_english.pya", import.meta.url);
    const text = await fs.readFile(fileUrl, "utf8");
    cachedEnglishPairs = buildPairsMapFromText(text, { label: "translation_pairs_english" });
    return cachedEnglishPairs;
  } catch (err) {
    cachedEnglishPairsError = err;
    throw err;
  }
}

export async function loadRussianTranslationPairs() {
  if (cachedRussianPairs) return cachedRussianPairs;
  if (cachedRussianPairsError) throw cachedRussianPairsError;
  try {
    const fileUrl = new URL("./pairs_russian.pya", import.meta.url);
    const text = await fs.readFile(fileUrl, "utf8");
    cachedRussianPairs = buildPairsMapFromText(text, { label: "translation_pairs_russian" });
    return cachedRussianPairs;
  } catch (err) {
    cachedRussianPairsError = err;
    throw err;
  }
}

export async function loadFrenchTranslationPairs() {
  if (cachedFrenchPairs) return cachedFrenchPairs;
  if (cachedFrenchPairsError) throw cachedFrenchPairsError;
  try {
    const fileUrl = new URL("./pairs_french.pya", import.meta.url);
    const text = await fs.readFile(fileUrl, "utf8");
    cachedFrenchPairs = buildPairsMapFromText(text, { label: "translation_pairs_french" });
    return cachedFrenchPairs;
  } catch (err) {
    cachedFrenchPairsError = err;
    throw err;
  }
}
