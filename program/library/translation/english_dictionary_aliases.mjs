import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ENGLISH_DICTIONARY_ALIAS_FORMAT = "english-dictionary-alias-v1";
export const ENGLISH_DICTIONARY_DEFAULT_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../",
  "caterer",
  "pyac",
  "lyac",
  "dictionary_en.json"
);

function invalid(message, details = {}) {
  const error = new Error(message);
  error.code = "invalid-english-dictionary-alias";
  error.details = details;
  return error;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeLookupWord(value) {
  return typeof value === "string"
    ? value.normalize("NFC").trim().toLowerCase().replace(/\s+/gu, " ")
    : "";
}

function lookupVariants(value) {
  const normalized = normalizeLookupWord(value);
  if (!normalized) return [];
  return [...new Set([
    normalized,
    normalized.replace(/ /gu, "_"),
    normalized.replace(/ /gu, "-")
  ])];
}

function parseBlacklist(source) {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw invalid("English dictionary source has no blacklist map");
  }
  const entries = [];
  for (const [sourceKey, alternatives] of Object.entries(source)) {
    if (!sourceKey.startsWith("X")) continue;
    if (typeof alternatives !== "string") {
      throw invalid("English dictionary blacklist value must be text", { sourceKey });
    }
    const surface = sourceKey.slice(1).replace(/_/gu, " ");
    if (!normalizeLookupWord(surface)) continue;
    entries.push({ sourceKey, surface, alternatives });
  }
  return entries;
}

export function parseEnglishDictionaryBlacklist(source, {
  sourceHash = "",
  path = ""
} = {}) {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw invalid("English dictionary source must be an object");
  }
  const entries = parseBlacklist(source?.en?.blacklist);
  return {
    format: ENGLISH_DICTIONARY_ALIAS_FORMAT,
    path,
    sourceHash,
    entries
  };
}

export async function loadEnglishDictionaryBlacklist({
  path = ENGLISH_DICTIONARY_DEFAULT_PATH
} = {}) {
  const text = await fs.readFile(path, "utf8");
  let source;
  try {
    source = JSON.parse(text);
  } catch (error) {
    throw invalid("English dictionary source JSON is malformed", { cause: error.message });
  }
  return parseEnglishDictionaryBlacklist(source, {
    path: resolve(path),
    sourceHash: sha256(text)
  });
}

function buildAtomicLookup(atomicEntries) {
  const lookup = new Map();
  for (const entry of atomicEntries ?? []) {
    if (typeof entry?.en !== "string" || typeof entry?.pya !== "string") continue;
    const english = entry.en.trim();
    const pya = entry.pya.trim();
    if (!english || !pya) continue;
    for (const variant of lookupVariants(english)) {
      const rows = lookup.get(variant) ?? [];
      rows.push({ en: english, pya, hnuc: entry.hnuc });
      lookup.set(variant, rows);
    }
  }
  return lookup;
}

function uniqueTargets(matches) {
  const targets = new Map();
  for (const match of matches) {
    if (!targets.has(match.pya)) targets.set(match.pya, match);
  }
  return targets;
}

export function buildEnglishDictionaryAliases({
  dictionary,
  atomicEntries = []
} = {}) {
  if (!dictionary?.entries || !Array.isArray(dictionary.entries)) {
    throw invalid("English dictionary aliases require parsed blacklist entries");
  }
  const atomicLookup = buildAtomicLookup(atomicEntries);
  const aliases = new Map();
  const records = [];
  for (const entry of dictionary.entries) {
    const matches = [];
    for (const alternative of entry.alternatives.split(",")) {
      const candidate = alternative.trim();
      if (!candidate) continue;
      for (const variant of lookupVariants(candidate)) {
        for (const target of atomicLookup.get(variant) ?? []) {
          matches.push({ ...target, alternative: candidate });
        }
      }
    }
    const targets = uniqueTargets(matches);
    if (targets.size !== 1) continue;
    const target = [...targets.values()][0];
    const surface = normalizeLookupWord(entry.surface);
    aliases.set(surface, target.en);
    records.push({
      surface,
      canonicalEnglish: target.en,
      pyashSequence: [target.pya],
      hnuc: target.hnuc,
      sourceKey: entry.sourceKey,
      alternative: target.alternative,
      evidence: `unique existing Pyash target from ${entry.sourceKey}`
    });
  }
  return { aliases, records };
}

