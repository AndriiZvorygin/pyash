import fs from "node:fs/promises";

let cachedEnglishPairs = null;
let cachedEnglishPairsError = null;
let cachedRussianPairs = null;
let cachedRussianPairsError = null;
let cachedFrenchPairs = null;
let cachedFrenchPairsError = null;
let cachedChinesePairs = null;
let cachedChinesePairsError = null;
let cachedInterlinguaPairs = null;
let cachedInterlinguaPairsError = null;
let cachedEnglishTemplates = null;
let cachedEnglishTemplatesError = null;
let cachedRussianTemplates = null;
let cachedRussianTemplatesError = null;
let cachedFrenchTemplates = null;
let cachedFrenchTemplatesError = null;
let cachedChineseTemplates = null;
let cachedChineseTemplatesError = null;
let cachedInterlinguaTemplates = null;
let cachedInterlinguaTemplatesError = null;

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

function buildTemplatePairsFromText(text, { label }) {
  const list = [];
  const lines = String(text).split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(ENTRY_REGEX);
    if (!match) continue;
    const key = normalizeText(JSON.parse(match[1]));
    const value = normalizeText(JSON.parse(match[2]));
    if (!key) {
      throw new Error("translation template pairs: entry missing su");
    }
    if (key.includes("__QUOTED_BLOCK__")) continue;
    list.push({ key, value: typeof value === "string" ? value : "" });
  }
  if (list.length === 0) {
    throw new Error(`translation template pairs missing: ${label ?? "unknown"}`);
  }
  return list;
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

export async function loadChineseTranslationPairs() {
  if (cachedChinesePairs) return cachedChinesePairs;
  if (cachedChinesePairsError) throw cachedChinesePairsError;
  try {
    const fileUrl = new URL("./pairs_chinese.pya", import.meta.url);
    const text = await fs.readFile(fileUrl, "utf8");
    cachedChinesePairs = buildPairsMapFromText(text, { label: "translation_pairs_chinese" });
    return cachedChinesePairs;
  } catch (err) {
    cachedChinesePairsError = err;
    throw err;
  }
}

export async function loadInterlinguaTranslationPairs() {
  if (cachedInterlinguaPairs) return cachedInterlinguaPairs;
  if (cachedInterlinguaPairsError) throw cachedInterlinguaPairsError;
  try {
    const fileUrl = new URL("./pairs_interlingua.pya", import.meta.url);
    const text = await fs.readFile(fileUrl, "utf8");
    cachedInterlinguaPairs = buildPairsMapFromText(text, { label: "translation_pairs_interlingua" });
    return cachedInterlinguaPairs;
  } catch (err) {
    cachedInterlinguaPairsError = err;
    throw err;
  }
}

export async function loadEnglishTranslationTemplates() {
  if (cachedEnglishTemplates) return cachedEnglishTemplates;
  if (cachedEnglishTemplatesError) throw cachedEnglishTemplatesError;
  try {
    const fileUrl = new URL("./pairs_english_templates.pya", import.meta.url);
    const text = await fs.readFile(fileUrl, "utf8");
    cachedEnglishTemplates = buildTemplatePairsFromText(text, { label: "translation_pairs_english_templates" });
    return cachedEnglishTemplates;
  } catch (err) {
    cachedEnglishTemplatesError = err;
    throw err;
  }
}

export async function loadRussianTranslationTemplates() {
  if (cachedRussianTemplates) return cachedRussianTemplates;
  if (cachedRussianTemplatesError) throw cachedRussianTemplatesError;
  try {
    const fileUrl = new URL("./pairs_russian_templates.pya", import.meta.url);
    const text = await fs.readFile(fileUrl, "utf8");
    cachedRussianTemplates = buildTemplatePairsFromText(text, { label: "translation_pairs_russian_templates" });
    return cachedRussianTemplates;
  } catch (err) {
    cachedRussianTemplatesError = err;
    throw err;
  }
}

export async function loadFrenchTranslationTemplates() {
  if (cachedFrenchTemplates) return cachedFrenchTemplates;
  if (cachedFrenchTemplatesError) throw cachedFrenchTemplatesError;
  try {
    const fileUrl = new URL("./pairs_french_templates.pya", import.meta.url);
    const text = await fs.readFile(fileUrl, "utf8");
    cachedFrenchTemplates = buildTemplatePairsFromText(text, { label: "translation_pairs_french_templates" });
    return cachedFrenchTemplates;
  } catch (err) {
    cachedFrenchTemplatesError = err;
    throw err;
  }
}

export async function loadChineseTranslationTemplates() {
  if (cachedChineseTemplates) return cachedChineseTemplates;
  if (cachedChineseTemplatesError) throw cachedChineseTemplatesError;
  try {
    const fileUrl = new URL("./pairs_chinese_templates.pya", import.meta.url);
    const text = await fs.readFile(fileUrl, "utf8");
    cachedChineseTemplates = buildTemplatePairsFromText(text, { label: "translation_pairs_chinese_templates" });
    return cachedChineseTemplates;
  } catch (err) {
    cachedChineseTemplatesError = err;
    throw err;
  }
}

export async function loadInterlinguaTranslationTemplates() {
  if (cachedInterlinguaTemplates) return cachedInterlinguaTemplates;
  if (cachedInterlinguaTemplatesError) throw cachedInterlinguaTemplatesError;
  try {
    const fileUrl = new URL("./pairs_interlingua_templates.pya", import.meta.url);
    const text = await fs.readFile(fileUrl, "utf8");
    cachedInterlinguaTemplates = buildTemplatePairsFromText(text, { label: "translation_pairs_interlingua_templates" });
    return cachedInterlinguaTemplates;
  } catch (err) {
    cachedInterlinguaTemplatesError = err;
    throw err;
  }
}
