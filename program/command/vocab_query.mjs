import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { resolveEnglishAlias } from "../verbs/exchange/translation/english_aliases.mjs";

let cachedData = null;

async function loadJson(path) {
  const text = await fs.readFile(path, "utf8");
  return JSON.parse(text);
}

async function loadData() {
  if (cachedData) return cachedData;
  const here = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolve(here, "../..");
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

export async function queryVocabLines(prefix) {
  const input = String(prefix ?? "").trim();
  if (!input) return [];
  const normalized = input.toLowerCase();
  const { entries, blacklist } = await loadData();

  const lines = new Set();
  for (const entry of entries) {
    if (!entry?.pya || !entry?.en) continue;
    if (
      matchesPrefix(entry.pya, normalized) ||
      matchesPrefix(entry.en, normalized)
    ) {
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

  const blocked = blacklist[`X${normalized}`] ?? blacklist[`X${input}`];
  if ((typeof blocked === "string" && blocked.length > 0) || (Array.isArray(blocked) && blocked.length > 0)) {
    return [JSON.stringify(blocked)];
  }

  return [];
}
