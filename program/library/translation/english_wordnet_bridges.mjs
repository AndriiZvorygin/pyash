import { readFile } from "node:fs/promises";

import { buildProgram } from "../../program.mjs";

export const ENGLISH_WORDNET_BRIDGE_FORMAT = "english-wordnet-bridge-v1";
export const ENGLISH_WORDNET_BRIDGE_NAME = "translation_english_wordnet_bridges";
export const ENGLISH_WORDNET_BRIDGE_CONFIG_URL = new URL("./english_wordnet_bridges.pya", import.meta.url);

const WORDNET_POS = new Set(["a", "n", "r", "v", "s"]);
const CERTAINTIES = new Set(["deterministic", "contextual"]);
const METADATA_KEYS = new Set(["format", "source", "source-hash", "mode"]);

function invalid(message, details = {}) {
  const error = new Error(message);
  error.code = "invalid-english-wordnet-bridge";
  error.details = details;
  return error;
}

function textAt(sentence, role) {
  return typeof sentence?.[role]?.text === "string" ? sentence[role].text.trim() : "";
}

function senseKey(value, index) {
  const key = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!/^[anrvs]:[^\s]+$/u.test(key)) {
    throw invalid("WordNet bridge source must be a POS-prefixed sense key", { index, source: value });
  }
  return key;
}

function targetName(sentence, index) {
  const target = typeof sentence?.ob?.name === "string" ? sentence.ob.name.trim().toLowerCase() : "";
  if (!target) throw invalid("WordNet bridge row requires an English target anchor", { index });
  return target;
}

export function parseEnglishWordNetBridgeCatalog(source) {
  if (typeof source !== "string") throw invalid("WordNet bridge source must be text");
  const sentences = buildProgram(source).sentences;
  const header = sentences.find((sentence) => (
    sentence?.mood === "def"
      && sentence?.be === "map"
      && sentence?.su?.name === ENGLISH_WORDNET_BRIDGE_NAME
  ));
  if (!header) throw invalid("WordNet bridge source has no canonical map header");

  const metadata = {};
  for (const sentence of sentences) {
    const key = textAt(sentence, "su");
    if (sentence?.mood !== "ya" || !METADATA_KEYS.has(key)) continue;
    const value = textAt(sentence, "ob");
    if (value) metadata[key] = value;
  }
  if (metadata.format !== ENGLISH_WORDNET_BRIDGE_FORMAT) {
    throw invalid("WordNet bridge source has an unsupported format", { format: metadata.format });
  }
  if (!metadata.source) throw invalid("WordNet bridge source requires provenance");

  const entries = [];
  const seen = new Set();
  for (const [index, sentence] of sentences.entries()) {
    if (sentence?.mood !== "ya") continue;
    const sourceKey = textAt(sentence, "su");
    if (!sourceKey || METADATA_KEYS.has(sourceKey)) continue;
    const key = senseKey(sourceKey, index);
    if (seen.has(key)) throw invalid("WordNet bridge sense is duplicated", { index, source: key });
    seen.add(key);
    const target = targetName(sentence, index);
    const targetPartOfSpeech = textAt(sentence, "as");
    if (!WORDNET_POS.has(targetPartOfSpeech)) {
      throw invalid("WordNet bridge target part of speech is unsupported", {
        index,
        source: key,
        targetPartOfSpeech
      });
    }
    const certainty = textAt(sentence, "with") || "contextual";
    if (!CERTAINTIES.has(certainty)) {
      throw invalid("WordNet bridge certainty is unsupported", { index, source: key, certainty });
    }
    const evidence = textAt(sentence, "via");
    if (!evidence) throw invalid("WordNet bridge row requires provenance evidence", { index, source: key });
    entries.push({
      source: key,
      target,
      targetPartOfSpeech,
      certainty,
      evidence
    });
  }
  return {
    format: ENGLISH_WORDNET_BRIDGE_FORMAT,
    source: metadata.source,
    mode: metadata.mode || "sense-level semantic bridge",
    entries
  };
}

export function buildEnglishWordNetBridgeIndex({ entries = [] } = {}) {
  const bySense = new Map();
  for (const entry of entries) {
    if (!entry?.source || !entry?.target) continue;
    if (bySense.has(entry.source)) {
      throw invalid("WordNet bridge sense is duplicated", { source: entry.source });
    }
    bySense.set(entry.source, { ...entry });
  }
  return {
    entries: [...bySense.values()].map((entry) => ({ ...entry })),
    bySense,
    lookup(source) {
      const entry = bySense.get(typeof source === "string" ? source.trim().toLowerCase() : "");
      return entry ? { ...entry } : null;
    }
  };
}

export async function loadEnglishWordNetBridges({ configUrl = ENGLISH_WORDNET_BRIDGE_CONFIG_URL } = {}) {
  return parseEnglishWordNetBridgeCatalog(await readFile(configUrl, "utf8"));
}
