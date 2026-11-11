import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

import { readPyaTextValues } from "../../../command/pya_lookup.mjs";
import { extractBoundedJsonObject } from "./english_verification.mjs";
import { parseCompoundLexicon } from "./compound_lexicon.mjs";

export const COMPOUND_TRANSLATION_CACHE_NAME = "translation_compounds_lazy";
export const DEFAULT_COMPOUND_TRANSLATION_CONFIG = new URL(
  "./compound_translation_config.pya",
  import.meta.url
);
export const DEFAULT_COMPOUND_TRANSLATION_CACHE = new URL(
  "./compound_translation_cache.pya",
  import.meta.url
);

const config = readPyaTextValues(fileURLToPath(DEFAULT_COMPOUND_TRANSLATION_CONFIG), [
  "compound_translation_model",
  "compound_translation_prompt_revision",
  "compound_translation_languages"
]);

function configuredLanguages() {
  try {
    const values = JSON.parse(config.compound_translation_languages || "[]");
    if (Array.isArray(values) && values.every((value) => typeof value === "string" && value.trim())) {
      return Object.freeze(values.map((value) => value.trim().toLowerCase()));
    }
  } catch {
    // Keep imports usable while a damaged declarative config is repaired.
  }
  return Object.freeze(["chinese", "french", "russian", "hindi", "interlingua"]);
}

export const COMPOUND_TRANSLATION_MODEL = String(
  config.compound_translation_model || "qwen3.5:9b"
).trim();
export const COMPOUND_TRANSLATION_PROMPT_REVISION = String(
  config.compound_translation_prompt_revision || "qwen-compound-translation-v1"
).trim();
export const COMPOUND_TRANSLATION_LANGUAGES = configuredLanguages();

function invalid(message, details = {}) {
  const error = new Error(message);
  error.code = "invalid-compound-translation";
  error.details = details;
  return error;
}

function text(value) {
  return typeof value === "string" ? value.normalize("NFC").trim() : "";
}

function language(value) {
  return text(value).toLowerCase();
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
}

function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

function hash(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function filePath(value) {
  return value instanceof URL ? fileURLToPath(value) : path.resolve(String(value));
}

function componentGlosses(compound) {
  const values = compound?.componentGlosses ?? compound?.morphemes ?? compound?.sourceMorphemes;
  return Array.isArray(values) ? values.map(text).filter(Boolean) : [];
}

function requestIdentity(compound) {
  return `compound-translation-${hash(stableJson({
    target: text(compound?.target),
    componentGlosses: componentGlosses(compound),
    pyashSequence: Array.isArray(compound?.pyashSequence) ? compound.pyashSequence.map(text) : [],
    promptRevision: COMPOUND_TRANSLATION_PROMPT_REVISION
  })).slice(0, 24)}`;
}

function normalizeSearchText(value) {
  return text(value)
    .toLowerCase()
    .replace(/[\u2010-\u2015_-]+/gu, " ")
    .replace(/[^\p{L}\p{N} ]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function containsCompound(source, target) {
  const sourceWords = normalizeSearchText(source).split(" ").filter(Boolean);
  const targetWords = normalizeSearchText(target).split(" ").filter(Boolean);
  if (!sourceWords.length || !targetWords.length || targetWords.length > sourceWords.length) return false;
  for (let index = 0; index <= sourceWords.length - targetWords.length; index += 1) {
    if (targetWords.every((word, offset) => sourceWords[index + offset] === word)) return true;
  }
  return false;
}

export function selectCompoundDemands(sourceText, records = []) {
  if (typeof sourceText !== "string") throw invalid("compound demand selection requires source text");
  if (!Array.isArray(records)) throw invalid("compound demand selection requires compound records");
  const seen = new Set();
  return records
    .filter((record) => {
      const status = text(record?.status);
      const accepted = ["accepted-delimited", "accepted-curated"].includes(status)
        || ["accepted-deterministic", "accepted-llm", "repaired-llm"].includes(text(record?.verificationStatus));
      return accepted && componentGlosses(record).length >= 2 && containsCompound(sourceText, record.target);
    })
    .sort((left, right) => text(left.target).localeCompare(text(right.target)))
    .filter((record) => {
      const id = requestIdentity(record);
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
}

function responseObject(value) {
  const payload = extractBoundedJsonObject(value);
  if (!payload) return null;
  if (payload.translations !== undefined) return payload;
  const nested = payload.message?.content ?? payload.response;
  return typeof nested === "string" ? extractBoundedJsonObject(nested) : null;
}

export function parseCompoundTranslationResponse(value, {
  languages = COMPOUND_TRANSLATION_LANGUAGES,
  maxResponseChars = 12000
} = {}) {
  const raw = String(value ?? "");
  if (raw.length > maxResponseChars) return { valid: false, reason: "response exceeds the bounded character limit" };
  const allowed = new Set(languages.map(language));
  const payload = responseObject(raw);
  if (!payload || !Array.isArray(payload.translations)) {
    return { valid: false, reason: "response did not contain a translations array" };
  }
  const seen = new Set();
  const translations = [];
  for (const row of payload.translations) {
    const targetLanguage = language(row?.language);
    const surface = text(row?.surface);
    if (!allowed.has(targetLanguage)) return { valid: false, reason: `response language is outside the requested set: ${targetLanguage}` };
    if (!surface) return { valid: false, reason: "translation surface is empty" };
    if (seen.has(targetLanguage)) return { valid: false, reason: `response language is duplicated: ${targetLanguage}` };
    seen.add(targetLanguage);
    const morphemes = Array.isArray(row?.morphemes)
      ? row.morphemes.map(text).filter(Boolean)
      : surface.split(/[\s-]+/u).map(text).filter(Boolean);
    translations.push({
      language: targetLanguage,
      surface,
      morphemes,
      rationale: text(row?.rationale)
    });
  }
  if (!translations.length) return { valid: false, reason: "response translations array is empty" };
  return { valid: true, translations, raw };
}

export function buildCompoundTranslationPrompt({
  compound,
  languages = COMPOUND_TRANSLATION_LANGUAGES,
  context = [],
  repairReason = ""
} = {}) {
  const target = text(compound?.target);
  const parts = componentGlosses(compound);
  if (!target || parts.length < 2) throw invalid("compound translation prompt requires a compound target and components");
  const requested = languages.map(language).filter(Boolean);
  if (!requested.length) throw invalid("compound translation prompt requires languages");
  return [
    "Translate one English lexical compound for the requested language set.",
    "Preserve the semantic modifier-to-head order where the target language uses a transparent compound.",
    "Prefer the ordinary lexical translation over an explanation or an idiomatic paraphrase.",
    "Return exactly one JSON object and no prose outside it.",
    '{"translations":[{"language":"...","surface":"...","morphemes":["..."],"rationale":"..."}]}',
    `TARGET ENGLISH COMPOUND: ${target}`,
    `ORDERED ENGLISH COMPONENTS: ${JSON.stringify(parts)}`,
    `PYASH COMPONENTS: ${JSON.stringify(compound?.pyashSequence ?? [])}`,
    `LANGUAGES: ${JSON.stringify(requested)}`,
    `CONTEXT: ${JSON.stringify(context.map(text).filter(Boolean))}`,
    repairReason ? `PREVIOUS CONTRACT FAILURE: ${repairReason}` : ""
  ].filter(Boolean).join("\n");
}

function cacheEntry(compound, requestId, model = COMPOUND_TRANSLATION_MODEL) {
  const parts = componentGlosses(compound);
  return {
    surface: text(compound.target),
    morphemes: parts,
    sourceMorphemes: parts,
    target: text(compound.target),
    gloss: text(compound.target),
    componentGlosses: parts,
    ...(Array.isArray(compound.pyashSequence) ? { pyashSequence: [...compound.pyashSequence] } : {}),
    ...(Array.isArray(compound.componentLayers) ? { componentLayers: [...compound.componentLayers], maxLayer: compound.maxLayer } : {}),
    ...(text(compound.head) ? { head: text(compound.head) } : { head: parts.at(-1) }),
    sourceSurfaces: {},
    sourceMorphemesByLanguage: {},
    coverageStatus: "translation-cache",
    translationStatus: "partial",
    translationRequestId: requestId,
    translationModel: model,
    translationPromptRevision: COMPOUND_TRANSLATION_PROMPT_REVISION,
    provenance: "compound_translation_cache.pya",
    confidence: "lazy-qwen",
    status: "translation-cache"
  };
}

function mergeTranslation(entry, response, model) {
  const sourceSurfaces = { ...(entry.sourceSurfaces ?? {}) };
  const sourceMorphemesByLanguage = { ...(entry.sourceMorphemesByLanguage ?? {}) };
  for (const translation of response.translations) {
    sourceSurfaces[translation.language] = translation.surface;
    sourceMorphemesByLanguage[translation.language] = translation.morphemes;
  }
  return {
    ...entry,
    sourceSurfaces,
    sourceMorphemesByLanguage,
    translationModel: text(model) || entry.translationModel,
    translationStatus: "partial"
  };
}

function renderCacheEntry(entry) {
  const payload = {
    surface: entry.surface,
    morphemes: entry.morphemes,
    sourceMorphemes: entry.sourceMorphemes,
    target: entry.target,
    gloss: entry.gloss,
    componentGlosses: entry.componentGlosses,
    pyashSequence: entry.pyashSequence,
    componentLayers: entry.componentLayers,
    maxLayer: entry.maxLayer,
    head: entry.head,
    sourceSurfaces: entry.sourceSurfaces,
    sourceMorphemesByLanguage: entry.sourceMorphemesByLanguage,
    coverageStatus: entry.coverageStatus,
    translationStatus: entry.translationStatus,
    translationRequestId: entry.translationRequestId,
    translationModel: entry.translationModel,
    translationPromptRevision: entry.translationPromptRevision,
    provenance: entry.provenance,
    confidence: entry.confidence,
    status: entry.status,
    evidence: "lazy translation is persisted only when this compound is demanded by an integration"
  };
  return `su text ${JSON.stringify(entry.surface)} ob text ${JSON.stringify(JSON.stringify(payload))} ya`;
}

export function renderCompoundTranslationCache(entries, { name = COMPOUND_TRANSLATION_CACHE_NAME } = {}) {
  if (!Array.isArray(entries)) throw invalid("compound translation cache requires entries");
  return [
    `su name ${name} be map def`,
    ...entries.slice().sort((left, right) => left.surface.localeCompare(right.surface)).map(renderCacheEntry),
    "prah",
    ""
  ].join("\n");
}

export async function loadCompoundTranslationCache({ cachePath = DEFAULT_COMPOUND_TRANSLATION_CACHE, name = COMPOUND_TRANSLATION_CACHE_NAME } = {}) {
  try {
    const source = await fs.readFile(cachePath, "utf8");
    if (!source.includes("su text ")) return [];
    return parseCompoundLexicon(source, { name, language: "multilingual" });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

async function writeCache(entries, cachePath, name) {
  const filename = filePath(cachePath);
  await fs.mkdir(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.tmp-${process.pid}`;
  await fs.writeFile(temporary, renderCompoundTranslationCache(entries, { name }), "utf8");
  await fs.rename(temporary, filename);
}

const TRANSLATION_RESPONSE_FORMAT = {
  type: "object",
  required: ["translations"],
  additionalProperties: false,
  properties: {
    translations: {
      type: "array",
      items: {
        type: "object",
        required: ["language", "surface", "morphemes", "rationale"],
        additionalProperties: false,
        properties: {
          language: { type: "string" },
          surface: { type: "string" },
          morphemes: { type: "array", items: { type: "string" } },
          rationale: { type: "string" }
        }
      }
    }
  }
};

export function createQueuedCompoundTranslator({ executor, model = "qwen3.5:9b" } = {}) {
  if (typeof executor !== "function") throw invalid("queued compound translator requires an executor");
  return async ({ compound, languages, context = [], requestId, phase = "translate", attempt = 1, repairReason = "" } = {}) => {
    const prompt = buildCompoundTranslationPrompt({ compound, languages, context, repairReason });
    const response = await executor({
      model,
      prompt,
      profile: "translation_direct",
      sampling: {
        format: TRANSLATION_RESPONSE_FORMAT,
        num_predict: 512
      },
      identity: `${requestId}-${phase}-${Math.max(1, Math.trunc(Number(attempt) || 1))}`,
      operation: `compound-${phase}`
    });
    return {
      text: String(response?.text ?? ""),
      handleId: response?.request?.handleId ?? null,
      model,
      metadata: response?.metadata ?? null
    };
  };
}

export async function createDefaultQueuedCompoundTranslator({
  root = process.cwd(),
  housekeeperUrl = process.env.PYA_GPU_HOUSEKEEPER_URL ?? "",
  gpuId = process.env.PYA_GPU_ID ?? "gpu-0",
  timeoutMs = Number(process.env.PYA_CRITERION_OLLAMA_TIMEOUT_MS || 900000),
  model = COMPOUND_TRANSLATION_MODEL
} = {}) {
  const { createQueuedOllamaExecutor } = await import("../../runtime/criterion/ollama.mjs");
  const queued = createQueuedOllamaExecutor({ root, housekeeperUrl, gpuId, timeoutMs, runId: "compound-translation" });
  return createQueuedCompoundTranslator({ executor: queued.executor, model });
}

export async function ensureCompoundTranslations({
  compounds = [],
  languages = COMPOUND_TRANSLATION_LANGUAGES,
  cachePath = DEFAULT_COMPOUND_TRANSLATION_CACHE,
  translate = null,
  context = [],
  maxRepairAttempts = 1,
  onEvent
} = {}) {
  if (!Array.isArray(compounds)) throw invalid("compound translation requires compounds");
  const requestedLanguages = [...new Set(languages.map(language).filter(Boolean))];
  if (!requestedLanguages.length) throw invalid("compound translation requires languages");
  let entries = await loadCompoundTranslationCache({ cachePath });
  const results = [];
  let changed = false;
  const emit = (event, details) => {
    if (typeof onEvent === "function") onEvent({ event, ...details });
  };
  for (const compound of compounds) {
    const target = text(compound?.target);
    const parts = componentGlosses(compound);
    if (!target || parts.length < 2) continue;
    const requestId = requestIdentity(compound);
    let entry = entries.find((candidate) => candidate.translationRequestId === requestId);
    const missing = requestedLanguages.filter((targetLanguage) => !entry?.sourceSurfaces?.[targetLanguage]);
    if (!missing.length) {
      results.push({ target, requestId, status: "cache-hit", languages: requestedLanguages });
      emit("cache-hit", { target, requestId, languages: requestedLanguages });
      continue;
    }
    if (typeof translate !== "function") {
      results.push({ target, requestId, status: "missing-translator", languages: missing });
      emit("missing-translator", { target, requestId, languages: missing });
      continue;
    }
    if (!entry) {
      entry = cacheEntry(compound, requestId);
      entries.push(entry);
    }
    let attempt = 1;
    let repairReason = "";
    let response = null;
    let parsed = { valid: false, reason: "translation was not attempted" };
    while (attempt <= 1 + Math.min(1, Math.max(0, Math.trunc(Number(maxRepairAttempts) || 0)))) {
      const rawResponse = await translate({
        compound,
        languages: missing,
        context,
        requestId,
        phase: attempt === 1 ? "translate" : "repair",
        attempt,
        repairReason
      });
      response = rawResponse;
      parsed = parseCompoundTranslationResponse(rawResponse?.text ?? rawResponse, { languages: missing });
      if (parsed.valid) break;
      repairReason = parsed.reason;
      attempt += 1;
    }
    if (!parsed.valid) {
      results.push({ target, requestId, status: "failed", languages: missing, reason: parsed.reason });
      emit("failed", { target, requestId, languages: missing, reason: parsed.reason });
      continue;
    }
    entry = mergeTranslation(entry, parsed, response?.model);
    const complete = requestedLanguages.every((targetLanguage) => entry.sourceSurfaces?.[targetLanguage]);
    entry.translationStatus = complete ? "complete" : "partial";
    const index = entries.findIndex((candidate) => candidate.translationRequestId === requestId);
    entries[index] = entry;
    await writeCache(entries, cachePath, COMPOUND_TRANSLATION_CACHE_NAME);
    changed = true;
    const status = complete ? "translated" : "partial";
    results.push({ target, requestId, status, languages: parsed.translations.map((item) => item.language), handleId: response?.handleId ?? null });
    emit(status, { target, requestId, languages: parsed.translations.map((item) => item.language), handleId: response?.handleId ?? null });
  }
  return {
    cachePath: filePath(cachePath),
    requested: compounds.length,
    changed,
    entries,
    results,
    counts: {
      hits: results.filter((result) => result.status === "cache-hit").length,
      translated: results.filter((result) => result.status === "translated").length,
      partial: results.filter((result) => result.status === "partial").length,
      failed: results.filter((result) => result.status === "failed").length,
      missingTranslator: results.filter((result) => result.status === "missing-translator").length
    }
  };
}
