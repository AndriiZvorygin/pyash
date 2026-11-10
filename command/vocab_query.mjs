import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { resolveEnglishAlias } from "../program/library/translation/english_aliases.mjs";
import {
  KWON_LOOKUP_INDEX_PATHS,
  lookupKwonIndex
} from "../program/library/translation/kwon_lookup_index.mjs";

let cachedData = null;

async function loadJson(path) {
  const text = await fs.readFile(path, "utf8");
  return JSON.parse(text);
}

export async function loadVocabQueryData() {
  if (cachedData) return cachedData;
  const here = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolve(here, "..");
  const lyacRoot = resolve(repoRoot, "caterer/pyac/lyac");
  const [kwonEn, pyashWords, pyackwon, dictionaryEn] = await Promise.all([
    loadJson(resolve(lyacRoot, "kwon_en.json")),
    loadJson(resolve(lyacRoot, "pyashWords.json")),
    loadJson(resolve(lyacRoot, "pyackwon.json")),
    loadJson(resolve(lyacRoot, "dictionary_en.json"))
  ]);
  cachedData = {
    entries: [...kwonEn, ...pyashWords, ...pyackwon],
    blacklist: dictionaryEn?.en?.blacklist ?? {}
  };
  return cachedData;
}

function buildLine(entry) {
  if (!entry?.pya || !entry?.en) return null;
  return `${entry.pya} en ${entry.en}`;
}

function matchesPrefix(value, prefix) {
  return value.toLowerCase().startsWith(prefix);
}

const VOCABULARY_SOURCE_ORDER = new Map([
  ["caterer/pyac/lyac/kwon_en.json", 0],
  ["caterer/pyac/lyac/pyashWords.json", 1],
  ["caterer/pyac/lyac/pyackwon.json", 2]
]);

function vocabularyLocators(locators = []) {
  return locators
    .filter((locator) => locator?.inline?.pya && locator?.inline?.en
      && VOCABULARY_SOURCE_ORDER.has(locator.sourceId))
    .sort((left, right) => (
      VOCABULARY_SOURCE_ORDER.get(left.sourceId) - VOCABULARY_SOURCE_ORDER.get(right.sourceId)
      || left.rowIndex - right.rowIndex
    ));
}

function linesFromLocators(locators) {
  const lines = new Set();
  for (const locator of vocabularyLocators(locators)) {
    const line = buildLine(locator.inline);
    if (line) lines.add(line);
  }
  return [...lines];
}

async function queryIndexedVocabLines(input, { indexPaths = KWON_LOOKUP_INDEX_PATHS, root, onWarning } = {}) {
  const normalized = input.toLowerCase();
  const options = {
    ...(root ? { root } : {}),
    ...(typeof onWarning === "function" ? { onWarning } : {})
  };
  const [englishExact, pyacExact] = await Promise.all([
    lookupKwonIndex({ kind: "english", key: normalized, indexPath: indexPaths.english, ...options }),
    lookupKwonIndex({ kind: "pyac", key: normalized, indexPath: indexPaths.pyac, ...options })
  ]);
  const exactLines = linesFromLocators([...englishExact, ...pyacExact]);
  if (exactLines.length > 0) return exactLines;

  const blocked = englishExact
    .find((locator) => locator?.sourceId === "caterer/pyac/lyac/dictionary_en.json"
      && locator?.inline && Object.hasOwn(locator.inline, "blacklist"));
  if (blocked && ((typeof blocked.inline.blacklist === "string" && blocked.inline.blacklist.length > 0)
    || (Array.isArray(blocked.inline.blacklist) && blocked.inline.blacklist.length > 0))) {
    return [JSON.stringify(blocked.inline.blacklist)];
  }

  const [englishPrefix, pyacPrefix] = await Promise.all([
    lookupKwonIndex({ kind: "english", key: normalized, prefix: true, indexPath: indexPaths.english, ...options }),
    lookupKwonIndex({ kind: "pyac", key: normalized, prefix: true, indexPath: indexPaths.pyac, ...options })
  ]);
  const lines = linesFromLocators([...englishPrefix, ...pyacPrefix]);
  if (lines.length > 0) return lines;

  const alias = resolveEnglishAlias(normalized);
  if (alias && alias !== normalized) {
    const [aliasEnglishPrefix, aliasPyacPrefix] = await Promise.all([
      lookupKwonIndex({ kind: "english", key: alias, prefix: true, indexPath: indexPaths.english, ...options }),
      lookupKwonIndex({ kind: "pyac", key: alias, prefix: true, indexPath: indexPaths.pyac, ...options })
    ]);
    return linesFromLocators([...aliasEnglishPrefix, ...aliasPyacPrefix]);
  }
  return [];
}

export async function queryVocabLines(prefix, options = {}) {
  const input = String(prefix ?? "").trim();
  if (!input) return [];
  try {
    return await queryIndexedVocabLines(input, options);
  } catch (error) {
    if (options.indexPaths || options.root || error?.code !== "ENOENT") throw error;
  }

  return queryVocabLinesLegacy(input);
}

async function queryVocabLinesLegacy(input) {
  const normalized = input.toLowerCase();
  const { entries, blacklist } = await loadVocabQueryData();

  const exactLines = new Set();
  for (const entry of entries) {
    if (!entry?.pya || !entry?.en) continue;
    if (entry.en.trim().toLowerCase() === normalized || entry.pya.trim().toLowerCase() === normalized) {
      const line = buildLine(entry);
      if (line) exactLines.add(line);
    }
  }
  if (exactLines.size > 0) return [...exactLines];

  const blocked = blacklist[`X${normalized}`] ?? blacklist[`X${input}`];
  if ((typeof blocked === "string" && blocked.length > 0) || (Array.isArray(blocked) && blocked.length > 0)) {
    return [JSON.stringify(blocked)];
  }

  const lines = new Set();
  for (const entry of entries) {
    if (!entry?.pya || !entry?.en) continue;
    if (matchesPrefix(entry.pya, normalized) || matchesPrefix(entry.en, normalized)) {
      const line = buildLine(entry);
      if (line) lines.add(line);
    }
  }

  if (lines.size > 0) return [...lines];

  const alias = resolveEnglishAlias(normalized);
  if (alias && alias !== normalized) {
    for (const entry of entries) {
      if (!entry?.pya || !entry?.en) continue;
      if (matchesPrefix(entry.en, alias) || matchesPrefix(entry.pya, alias)) {
        const line = buildLine(entry);
        if (line) lines.add(line);
      }
    }
    if (lines.size > 0) return [...lines];
  }

  return [];
}
