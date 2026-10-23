import fs from "node:fs/promises";
import { createHash } from "node:crypto";

import { buildProgram } from "../../../program.mjs";

export const CHINESE_COMPOUND_LEXICON_NAME = "translation_compounds_chinese";

export const COMPOUND_LEXICON_NAMES = Object.freeze({
  chinese: CHINESE_COMPOUND_LEXICON_NAME,
  french: "translation_compounds_french",
  russian: "translation_compounds_russian",
  hindi: "translation_compounds_hindi",
  interlingua: "translation_compounds_interlingua"
});

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, stableValue(value[key])])
    );
  }
  return value;
}

function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

function compoundId(entry) {
  const identity = [
    entry.surface,
    entry.morphemes.join("\u0001"),
    entry.target,
    entry.provenance
  ].join("\u0000");
  return `compound-${createHash("sha256").update(identity).digest("hex").slice(0, 24)}`;
}

function invalid(message, details = {}) {
  const error = new Error(message);
  error.code = "invalid-compound-lexicon";
  error.details = details;
  return error;
}

function normalizeEntry(payload, surface, index, language) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw invalid("compound row payload must be an object", { index });
  }
  if (payload.surface !== surface) {
    throw invalid("compound row surface must match its Pyash key", { index, surface });
  }
  if (!Array.isArray(payload.morphemes) || payload.morphemes.length < 2 || payload.morphemes.some((item) => typeof item !== "string" || !item)) {
    throw invalid("compound row requires at least two ordered morphemes", { index, surface });
  }
  for (const field of ["target", "provenance", "confidence", "status"]) {
    if (typeof payload[field] !== "string" || !payload[field]) {
      throw invalid(`compound row requires ${field}`, { index, surface });
    }
  }
  if (payload.gloss !== undefined && typeof payload.gloss !== "string") {
    throw invalid("compound row gloss must be text", { index, surface });
  }
  if (payload.componentGlosses !== undefined && (
    !Array.isArray(payload.componentGlosses) ||
    payload.componentGlosses.length !== payload.morphemes.length ||
    payload.componentGlosses.some((item) => typeof item !== "string" || !item)
  )) {
    throw invalid("compound component glosses must match ordered morphemes", { index, surface });
  }
  if (payload.pyashSequence !== undefined && (
    !Array.isArray(payload.pyashSequence) ||
    payload.pyashSequence.length !== payload.morphemes.length ||
    payload.pyashSequence.some((item) => typeof item !== "string" || !item)
  )) {
    throw invalid("compound Pyash sequence must match ordered morphemes", { index, surface });
  }
  if (payload.componentLayers !== undefined && (
    !Array.isArray(payload.componentLayers) ||
    payload.componentLayers.length !== payload.morphemes.length ||
    payload.componentLayers.some((item) => !Number.isInteger(item) || item < 1)
  )) {
    throw invalid("compound component layers must match ordered morphemes", { index, surface });
  }
  if ((payload.pyashSequence === undefined) !== (payload.componentLayers === undefined)) {
    throw invalid("compound Pyash sequence and component layers must be paired", { index, surface });
  }
  if (payload.maxLayer !== undefined && (
    !Number.isInteger(payload.maxLayer) ||
    payload.maxLayer < 1 ||
    payload.componentLayers === undefined ||
    payload.maxLayer !== Math.max(...payload.componentLayers)
  )) {
    throw invalid("compound max layer must match component layers", { index, surface });
  }
  if (payload.evidence !== undefined && (typeof payload.evidence !== "string" || !payload.evidence)) {
    throw invalid("compound evidence must be text", { index, surface });
  }
  if (payload.rejectedCandidates !== undefined && (
    !Array.isArray(payload.rejectedCandidates) ||
    payload.rejectedCandidates.some((candidate) => (
      !candidate ||
      typeof candidate !== "object" ||
      !Array.isArray(candidate.pyashSequence) ||
      candidate.pyashSequence.length === 0 ||
      candidate.pyashSequence.some((item) => typeof item !== "string" || !item) ||
      !Array.isArray(candidate.componentLayers) ||
      candidate.componentLayers.length !== candidate.pyashSequence.length ||
      candidate.componentLayers.some((item) => !Number.isInteger(item) || item < 1) ||
      !Number.isInteger(candidate.maxLayer) ||
      candidate.maxLayer !== Math.max(...candidate.componentLayers) ||
      typeof candidate.reason !== "string" ||
      !candidate.reason
    ))
  )) {
    throw invalid("compound rejected candidates are malformed", { index, surface });
  }
  const entry = {
    id: compoundId(payload),
    language,
    surface,
    morphemes: [...payload.morphemes],
    target: payload.target,
    ...(payload.gloss === undefined ? {} : { gloss: payload.gloss }),
    ...(payload.componentGlosses === undefined ? {} : { componentGlosses: [...payload.componentGlosses] }),
    ...(payload.pyashSequence === undefined ? {} : { pyashSequence: [...payload.pyashSequence] }),
    ...(payload.componentLayers === undefined ? {} : { componentLayers: [...payload.componentLayers] }),
    ...(payload.maxLayer === undefined ? {} : { maxLayer: payload.maxLayer }),
    ...(payload.evidence === undefined ? {} : { evidence: payload.evidence }),
    ...(payload.rejectedCandidates === undefined ? {} : {
      rejectedCandidates: payload.rejectedCandidates.map((candidate) => ({
        pyashSequence: [...candidate.pyashSequence],
        componentLayers: [...candidate.componentLayers],
        maxLayer: candidate.maxLayer,
        reason: candidate.reason
      }))
    }),
    provenance: payload.provenance,
    confidence: payload.confidence,
    status: payload.status
  };
  return entry;
}

export function parseCompoundLexicon(source, { name, language } = {}) {
  if (typeof source !== "string") throw invalid("compound lexicon source must be text");
  if (typeof name !== "string" || !name) throw invalid("compound lexicon requires a map name");
  if (typeof language !== "string" || !language) throw invalid("compound lexicon requires a language");
  const sentences = buildProgram(source).sentences;
  const header = sentences.find((sentence) => (
    sentence?.mood === "def" &&
    sentence?.be === "map" &&
    sentence?.su?.name === name
  ));
  if (!header) throw invalid("compound lexicon has no canonical map header");

  const seen = new Set();
  const entries = [];
  for (const [index, sentence] of sentences.entries()) {
    if (sentence?.mood !== "ya" || typeof sentence.su?.text !== "string") continue;
    if (typeof sentence.ob?.text !== "string") {
      throw invalid("compound row requires a JSON text payload", { index });
    }
    let payload;
    try {
      payload = JSON.parse(sentence.ob.text);
    } catch (error) {
      throw invalid("compound row JSON payload is malformed", { index, cause: error.message });
    }
    const entry = normalizeEntry(payload, sentence.su.text, index, language);
    if (seen.has(entry.surface)) throw invalid("compound surface is duplicated", { surface: entry.surface });
    seen.add(entry.surface);
    entries.push(entry);
  }
  if (!entries.length) throw invalid("compound lexicon has no rows");
  return entries;
}

export function parseChineseCompoundLexicon(source) {
  return parseCompoundLexicon(source, {
    name: CHINESE_COMPOUND_LEXICON_NAME,
    language: "chinese"
  });
}

export async function loadCompoundLexicon({ url, name, language } = {}) {
  if (!(url instanceof URL) && typeof url !== "string") {
    throw invalid("compound lexicon requires a source URL");
  }
  return parseCompoundLexicon(await fs.readFile(url, "utf8"), { name, language });
}

export async function loadChineseCompoundLexicon({ url = new URL("./compound_lexicon_chinese.pya", import.meta.url) } = {}) {
  return loadCompoundLexicon({
    url,
    name: CHINESE_COMPOUND_LEXICON_NAME,
    language: "chinese"
  });
}

export function queryCompoundLexicon(entries, criteria = {}, options = {}) {
  const rows = typeof entries === "string"
    ? parseCompoundLexicon(entries, options)
    : entries;
  if (!Array.isArray(rows)) throw invalid("compound query requires parsed rows");
  return rows.filter((entry) => {
    if (criteria.id !== undefined && entry.id !== criteria.id) return false;
    if (criteria.surface !== undefined && entry.surface !== criteria.surface) return false;
    if (criteria.morpheme !== undefined && !entry.morphemes.includes(criteria.morpheme)) return false;
    if (criteria.target !== undefined && entry.target !== criteria.target) return false;
    if (criteria.status !== undefined && entry.status !== criteria.status) return false;
    if (criteria.confidence !== undefined && entry.confidence !== criteria.confidence) return false;
    if (criteria.provenance !== undefined && entry.provenance !== criteria.provenance) return false;
    if (criteria.glossIncludes !== undefined && !entry.gloss?.includes(criteria.glossIncludes)) return false;
    if (criteria.pyashWord !== undefined && !entry.pyashSequence?.includes(criteria.pyashWord)) return false;
    if (criteria.maxLayer !== undefined && entry.maxLayer !== criteria.maxLayer) return false;
    return true;
  });
}

export function queryChineseCompoundLexicon(entries, criteria = {}) {
  return queryCompoundLexicon(entries, criteria, {
    name: CHINESE_COMPOUND_LEXICON_NAME,
    language: "chinese"
  });
}

export function canonicalCompoundPayload(entry) {
  return stableJson({
    surface: entry.surface,
    morphemes: entry.morphemes,
    target: entry.target,
    gloss: entry.gloss ?? null,
    componentGlosses: entry.componentGlosses ?? null,
    pyashSequence: entry.pyashSequence ?? null,
    componentLayers: entry.componentLayers ?? null,
    maxLayer: entry.maxLayer ?? null,
    evidence: entry.evidence ?? null,
    rejectedCandidates: entry.rejectedCandidates ?? null,
    provenance: entry.provenance,
    confidence: entry.confidence,
    status: entry.status
  });
}
