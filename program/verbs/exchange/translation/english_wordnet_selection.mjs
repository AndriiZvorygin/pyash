import { createHash } from "node:crypto";

import {
  createQueuedMindTranslationVocabularySubmitter
} from "./translation_vocabulary_queue.mjs";
import { extractBoundedJsonObject } from "./english_verification.mjs";

export const ENGLISH_WORDNET_SELECTION_FORMAT = "english-wordnet-sense-selection-v1";
export const ENGLISH_WORDNET_SELECTION_DEFAULT_OUTPUT_TOKENS = 512;
export const ENGLISH_WORDNET_SELECTION_RESPONSE_FORMAT = Object.freeze({
  type: "object",
  required: ["verdict", "option", "confidence", "rationale"],
  additionalProperties: false,
  properties: {
    verdict: { type: "string", enum: ["accept", "uncertain"] },
    option: { type: "integer", minimum: 1 },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    rationale: { type: "string", maxLength: 240 }
  }
});

const ACCEPTED_CONFIDENCE = new Set(["high", "medium"]);

function invalid(message, details = {}) {
  const error = new Error(message);
  error.code = "invalid-english-wordnet-selection";
  error.details = details;
  return error;
}

function text(value) {
  return typeof value === "string" ? value.normalize("NFC").trim() : "";
}

function normalized(value) {
  return text(value).toLowerCase();
}

function bounded(value, maxChars) {
  const limit = Math.max(1, Math.trunc(Number(maxChars) || 1));
  const valueText = text(value);
  return valueText.length > limit ? `${valueText.slice(0, limit - 1)}…` : valueText;
}

function hash(value) {
  return createHash("sha256").update(String(value ?? "")).digest("hex");
}

function estimateTokens(value) {
  return [...String(value ?? "").matchAll(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*|[^\s]/gu)].length;
}

function senseRow(sense) {
  return {
    id: `${text(sense?.pos)}:${text(sense?.synset)}`,
    pos: text(sense?.pos),
    synset: text(sense?.synset),
    lemmas: [...new Set((sense?.lemmas ?? [sense?.lemma]).map(text).filter(Boolean))].slice(0, 6),
    gloss: bounded(sense?.gloss, 240)
  };
}

function partOfSpeechName(value) {
  const name = {
    a: "adjective",
    n: "noun",
    r: "adverb",
    s: "adjective",
    v: "verb"
  }[text(value)] ?? text(value);
  return name || "unknown";
}

function senseOption(sense, number) {
  const row = senseRow(sense);
  return [
    `OPTION ${number}`,
    `part of speech: ${partOfSpeechName(row.pos)}`,
    `lemmas: ${row.lemmas.join(", ") || "(none)"}`,
    `meaning: ${row.gloss || "(no gloss supplied)"}`
  ].join("\n");
}

export function englishWordNetSelectionId({ sourceHash, sourceRecordId, tokenIndex, surface } = {}) {
  const identity = [sourceHash, sourceRecordId, tokenIndex, normalized(surface)].join("\u0000");
  if (!sourceHash || !sourceRecordId || !normalized(surface)) {
    throw invalid("WordNet selection identity requires source hash, source record, and surface");
  }
  return `english-wordnet-selection-${hash(identity).slice(0, 24)}`;
}

export function englishWordNetSelectionQueueHandle({ sourceHash, decisionId, attempt = 1 } = {}) {
  if (!text(sourceHash) || !text(decisionId)) {
    throw invalid("WordNet selection queue handle requires source hash and decision id");
  }
  const retry = Math.max(1, Math.trunc(Number(attempt) || 1));
  return `english-wordnet-select-${hash(`${sourceHash}\u0000${decisionId}`).slice(0, 24)}${retry > 1 ? `-retry-${retry}` : ""}`;
}

export function buildEnglishWordNetSenseSelectionPrompt({
  surface,
  sentence,
  senses = [],
  source = "Open English WordNet",
  maxChars = 12000,
  maxTokens = 3900,
  repairReason = ""
} = {}) {
  if (!text(surface) || !text(sentence) || !Array.isArray(senses) || senses.length < 2) {
    throw invalid("WordNet selection prompt requires one word, one sentence, and multiple senses");
  }
  const options = senses.map((sense, index) => senseOption(sense, index + 1)).join("\n");
  const prompt = [
    "You choose the meaning of one English word in one sentence.",
    "TASK: choose the one supplied option that matches the word's meaning here.",
    "Use the sentence grammar and nearby words. Compare all options.",
    "A familiar lemma alone is not evidence. Do not use knowledge outside this sentence and these options.",
    "If the sentence does not clearly choose one option, return verdict uncertain.",
    "Return one JSON object only. No markdown, explanation, Pyash words, or extra keys.",
    '{"verdict":"accept|uncertain","option":1,"confidence":"high|medium|low","rationale":"under 120 characters"}',
    `WORD TO CLASSIFY: ${bounded(surface, 80)}`,
    `SENTENCE: ${bounded(sentence, 1200)}`,
    `DATASET: ${bounded(source, 80) || "Open English WordNet"}`,
    "OPTIONS:",
    options,
    "ANSWER RULES:",
    "- option must be one option number shown above.",
    "- For accept, use high or medium confidence only.",
    "- For uncertain, still return the closest option number and use low confidence.",
    "- Keep rationale short and name the sentence clue.",
    ...(text(repairReason) ? [
      `REPAIR: the previous answer was invalid because ${bounded(repairReason, 240)}`,
      "Follow the answer rules and return one valid JSON object."
    ] : [])
  ].join("\n");
  const charBudget = Math.max(1000, Math.trunc(Number(maxChars) || 12000));
  const tokenBudget = Math.max(100, Math.trunc(Number(maxTokens) || 3900));
  const tokenEstimate = estimateTokens(prompt);
  if (prompt.length > charBudget || tokenEstimate >= tokenBudget) {
    throw invalid("WordNet selection prompt exceeds configured budget", {
      promptChars: prompt.length,
      tokenEstimate,
      charBudget,
      tokenBudget
    });
  }
  return prompt;
}

function providerResponseText(value) {
  if (value && typeof value === "object" && typeof value.response === "string") return value.response;
  const raw = String(value ?? "");
  try {
    const envelope = JSON.parse(raw);
    if (typeof envelope?.response === "string") return envelope.response;
    if (typeof envelope?.message?.content === "string") return envelope.message.content;
  } catch {
    // The bounded extractor handles direct or noisy provider text.
  }
  return raw;
}

export function parseEnglishWordNetSenseSelectionResponse(value, { senses = [] } = {}) {
  const payload = extractBoundedJsonObject(providerResponseText(value));
  if (!payload) return { valid: false, reason: "response did not contain one bounded JSON object" };
  const verdict = normalized(payload.verdict);
  if (!["accept", "uncertain"].includes(verdict)) {
    return { valid: false, reason: "selection verdict must be accept or uncertain" };
  }
  const allowed = new Map(senses.map((sense) => [
    `${text(sense?.pos)}:${text(sense?.synset)}`,
    sense
  ]));
  const hasOption = Object.prototype.hasOwnProperty.call(payload, "option");
  const option = Number(payload.option);
  const selectedByOption = Number.isInteger(option) && option >= 1 && option <= senses.length
    ? senses[option - 1]
    : null;
  const legacySenseId = text(payload.senseId);
  const selectedSense = hasOption
    ? selectedByOption
    : allowed.get(legacySenseId) ?? null;
  const senseId = selectedSense
    ? `${text(selectedSense.pos)}:${text(selectedSense.synset)}`
    : "";
  if (!selectedSense || !senseId || !allowed.has(senseId)) {
    return { valid: false, reason: hasOption
      ? "selected option is outside the supplied sense set"
      : "selected senseId is outside the supplied sense set" };
  }
  const confidence = normalized(payload.confidence);
  if (!["high", "medium", "low"].includes(confidence)) {
    return { valid: false, reason: "selection confidence must be high, medium, or low" };
  }
  const rationale = text(payload.rationale);
  if (!rationale) return { valid: false, reason: "selection rationale is empty" };
  if (rationale.length > 1200) return { valid: false, reason: "selection rationale exceeds the bounded limit" };
  if (verdict !== "accept") {
    return { valid: true, verdict, senseId, confidence, rationale, raw: providerResponseText(value) };
  }
  if (!ACCEPTED_CONFIDENCE.has(confidence)) {
    return { valid: false, reason: "selection confidence is below the accepted threshold" };
  }
  return {
    valid: true,
    verdict,
    senseId,
    sense: selectedSense,
    confidence,
    rationale,
    raw: providerResponseText(value)
  };
}

export function createQueuedMindEnglishWordNetSenseSelectionSubmitter(options = {}) {
  return createQueuedMindTranslationVocabularySubmitter({
    maxOutputTokens: ENGLISH_WORDNET_SELECTION_DEFAULT_OUTPUT_TOKENS,
    ...options,
    responseFormat: ENGLISH_WORDNET_SELECTION_RESPONSE_FORMAT
  });
}

export async function createDefaultQueuedMindEnglishWordNetSenseSelectionSubmitter(options = {}) {
  const [{ interpret }, { parse }] = await Promise.all([
    import("../../../bridge/index.mjs"),
    import("../../../understand/index.mjs")
  ]);
  return createQueuedMindEnglishWordNetSenseSelectionSubmitter({ interpret, parse, ...options });
}

export async function selectEnglishWordNetSense({
  decision,
  sourceHash,
  submit,
  awaitHandle,
  source = "Open English WordNet",
  maxChars = 12000,
  maxTokens = 3900,
  maxOutputTokens = ENGLISH_WORDNET_SELECTION_DEFAULT_OUTPUT_TOKENS,
  maxRepairAttempts = 1
} = {}) {
  if (!decision?.id || !Array.isArray(decision.senses) || decision.senses.length < 2) {
    throw invalid("WordNet selection requires one ambiguous decision with multiple senses");
  }
  if (typeof submit !== "function") throw invalid("WordNet selection requires a queue submitter");
  if (typeof awaitHandle !== "function") throw invalid("WordNet selection requires an await function");
  const handleId = englishWordNetSelectionQueueHandle({ sourceHash, decisionId: decision.id });
  const prompt = buildEnglishWordNetSenseSelectionPrompt({
    surface: decision.surface,
    sentence: decision.sentence,
    senses: decision.senses,
    source,
    maxChars,
    maxTokens
  });
  const queued = await submit({
    handleId,
    prompt,
    candidates: decision.senses,
    sourceHash,
    maxOutputTokens
  });
  if (normalized(queued?.status || queued?.ob?.text) !== "queued") {
    throw invalid("WordNet selection queue submission was not accepted", { handleId, queued });
  }
  const queue = { handleId, status: "queued", senseCount: decision.senses.length };
  let attempt = 1;
  let raw = await awaitHandle(handleId);
  let response = parseEnglishWordNetSenseSelectionResponse(raw, { senses: decision.senses });
  let repairHandleId = "";
  while (!response.valid && attempt <= Math.min(1, Math.max(0, Math.trunc(Number(maxRepairAttempts) || 0)))) {
    attempt += 1;
    repairHandleId = englishWordNetSelectionQueueHandle({ sourceHash, decisionId: decision.id, attempt });
    const repairPrompt = buildEnglishWordNetSenseSelectionPrompt({
      surface: decision.surface,
      sentence: decision.sentence,
      senses: decision.senses,
      source,
      maxChars,
      maxTokens,
      repairReason: response.reason
    });
    const repairQueued = await submit({
      handleId: repairHandleId,
      prompt: repairPrompt,
      candidates: decision.senses,
      sourceHash,
      maxOutputTokens
    });
    if (normalized(repairQueued?.status || repairQueued?.ob?.text) !== "queued") break;
    raw = await awaitHandle(repairHandleId);
    response = parseEnglishWordNetSenseSelectionResponse(raw, { senses: decision.senses });
  }
  if (!response.valid || response.verdict !== "accept") {
    return {
      decision,
      queue: {
        ...queue,
        status: "complete",
        outcome: "error",
        verificationAttempts: attempt,
        ...(repairHandleId ? { repairHandleId } : {}),
        error: response.reason || "selection remained uncertain",
        raw: response.raw || raw
      },
      error: response.reason || "selection remained uncertain",
      raw: response.raw || raw
    };
  }
  return {
    decision,
    sense: response.sense,
    confidence: response.confidence,
    rationale: response.rationale,
    queue: {
      ...queue,
      status: "complete",
      outcome: "applied",
      verificationAttempts: attempt,
      ...(repairHandleId ? { repairHandleId } : {})
    }
  };
}
