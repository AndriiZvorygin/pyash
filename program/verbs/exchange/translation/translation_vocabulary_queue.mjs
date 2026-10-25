import { createHash } from "node:crypto";

import pyashWords from "../../../library/pyashWords.json" with { type: "json" };
import { loadEnglishGrammarCatalog } from "./english_grammar.mjs";
import { extractBoundedJsonObject } from "./english_verification.mjs";

export const TRANSLATION_VOCABULARY_QUEUE_INTENT = "mind";
export const TRANSLATION_VOCABULARY_QUEUE_LANE = "durable";

const FUNCTION_WORDS = new Set([
  "a", "an", "and", "are", "as", "be", "but", "by", "can", "for", "from", "in",
  "is", "it", "of", "on", "or", "such", "that", "the", "there", "this", "to", "within"
]);

const SEMANTIC_CORE_GLOSSES = new Set([
  "action", "activity", "body", "brain", "care", "cause", "change", "event", "feeling", "heart",
  "idea", "life", "mind", "object", "reaction", "thing", "type", "use", "work", "world"
]);

function invalid(message, details = {}) {
  const error = new Error(message);
  error.code = "invalid-translation-vocabulary-queue";
  error.details = details;
  return error;
}

function text(value) {
  return typeof value === "string" ? value.normalize("NFC").trim() : "";
}

function hash(value) {
  return createHash("sha256").update(String(value ?? "")).digest("hex");
}

function candidateIdentity(candidate) {
  return text(candidate?.id) || `${text(candidate?.surface)}:${text(candidate?.sourceRecordId)}`;
}

function normalizedWord(value) {
  return text(value).toLowerCase().replace(/[^a-z0-9_ -]+/gu, "").replace(/\s+/gu, " ");
}

function wordRoots(value) {
  const normalized = normalizedWord(value);
  if (!normalized) return [];
  const roots = new Set([normalized, ...normalized.split(/[ _-]+/gu)]);
  for (const word of [...roots]) {
    if (word.length > 4 && word.endsWith("ies")) roots.add(`${word.slice(0, -3)}y`);
    if (word.length > 4 && word.endsWith("es")) roots.add(word.slice(0, -2));
    if (word.length > 3 && word.endsWith("s")) roots.add(word.slice(0, -1));
    if (word.length > 5 && word.endsWith("ing")) roots.add(word.slice(0, -3));
    if (word.length > 4 && word.endsWith("ed")) roots.add(word.slice(0, -2));
  }
  return [...roots].filter((word) => word.length > 1);
}

function inventoryScore(entry, roots) {
  const english = normalizedWord(entry?.en);
  const parts = english.split("_");
  const exact = roots.has(english) ? 0 : 1;
  const related = parts.some((part) => roots.has(part)) ? 2 : 3;
  const simple = english.includes("_") ? 1 : 0;
  return exact * 100 + related * 10 + simple;
}

export function buildTranslationVocabularyInventory({ sourceText, candidates = [], grammarEntries = [] } = {}) {
  const roots = new Set(wordRoots(sourceText));
  for (const candidate of candidates) {
    for (const root of wordRoots(candidate?.surface)) roots.add(root);
    for (const context of candidate?.context ?? []) {
      for (const root of wordRoots(context)) roots.add(root);
    }
  }
  const semanticRoots = new Set([...roots].filter((root) => !FUNCTION_WORDS.has(root)));
  const entries = pyashWords
    .filter((entry) => {
      const english = normalizedWord(entry?.en);
      if (!english || !text(entry?.pya)) return false;
      const parts = english.split("_");
      return (!english.includes("_") && english.length <= 4)
        || roots.has(english)
        || SEMANTIC_CORE_GLOSSES.has(english)
        || (english.includes("_") && parts.some((part) => semanticRoots.has(part)));
    })
    .sort((left, right) => (
      inventoryScore(left, roots) - inventoryScore(right, roots)
      || normalizedWord(left.en).localeCompare(normalizedWord(right.en))
    ))
    .slice(0, 2800)
    .map((entry) => ({ english: entry.en, pyash: entry.pya }));
  const grammar = grammarEntries
    .filter((entry) => entry?.surface && Array.isArray(entry.pyashSequence))
    .map((entry) => ({
      english: entry.surface,
      pyash: [...entry.pyashSequence],
      kind: entry.kind,
      position: entry.position
    }));
  return { entries, grammar };
}

function promptCandidate(candidate) {
  return {
    id: candidateIdentity(candidate),
    surface: text(candidate?.surface),
    kind: text(candidate?.kind),
    context: Array.isArray(candidate?.context) ? [...candidate.context] : [],
    evidence: text(candidate?.evidence)
  };
}

export function buildTranslationVocabularyVerificationPrompt({
  language,
  sourceText,
  locator,
  candidates = [],
  inventory = null
} = {}) {
  if (!text(language)) throw invalid("vocabulary queue prompt requires a source language");
  if (!text(sourceText)) throw invalid("vocabulary queue prompt requires source text");
  if (!Array.isArray(candidates) || candidates.length === 0) {
    throw invalid("vocabulary queue prompt requires candidates");
  }
  return [
    "You are the bounded Pyash vocabulary review worker.",
    "Review unresolved source terms from one translation document.",
    "Use the supplied context and evidence to propose existing Pyash atoms, compounds, or grammar mappings.",
    "Keep derivational and grammatical endings separate from lexical heads.",
    "The deterministic parser's candidate sequences are heuristics only; they are not verified mappings.",
    "Do not reject a candidate merely because it is a common English word: these are terms the deterministic coverage pass could not resolve.",
    "Accept only a sequence grounded in the supplied inventory. Use uncertain when the inventory cannot support a defensible mapping.",
    "Reject only when the candidate is demonstrably not a translation target in its supplied context.",
    "Include one result entry for every supplied candidate, in supplied order.",
    "Use an empty pyashSequence for reject or uncertain. Never return an inventory row such as {english,pyash} as the top-level result.",
    "Return exactly one JSON object with this shape:",
    '{"verdict":"complete|partial|uncertain","candidates":[{"id":"...","status":"accept|reject|uncertain","pyashSequence":["..."],"rationale":"..."}]}',
    "Use only supplied candidate ids. Preserve uncertainty when the source evidence does not establish a mapping.",
    "Return the object immediately. Use no hidden reasoning or preface. Keep each rationale under 120 characters.",
    `SOURCE LANGUAGE: ${text(language)}`,
    `SOURCE LOCATOR: ${text(locator) || "unavailable"}`,
    "SOURCE TEXT:",
    sourceText,
    "AUTHORITATIVE PYASH ATOM AND COMPOUND INVENTORY (English gloss -> Pyash token):",
    (inventory?.entries ?? []).map(JSON.stringify).join("\n"),
    "AUTHORITATIVE PYASH GRAMMAR INVENTORY:",
    (inventory?.grammar ?? []).map(JSON.stringify).join("\n"),
    "CANDIDATES:",
    candidates.map(promptCandidate).map(JSON.stringify).join("\n")
  ].join("\n");
}

export function translationVocabularyQueueHandle({ sourceHash, candidates = [], attempt = 1 } = {}) {
  if (!text(sourceHash)) throw invalid("vocabulary queue handle requires source hash");
  if (!Array.isArray(candidates) || candidates.length === 0) {
    throw invalid("vocabulary queue handle requires candidates");
  }
  const identities = candidates.map(candidateIdentity).sort().join("\u0000");
  const suffix = Math.max(1, Math.trunc(Number(attempt) || 1)) > 1
    ? `-retry-${Math.max(1, Math.trunc(Number(attempt) || 1))}`
    : "";
  return `translation-vocabulary-${hash(`${sourceHash}\u0000${identities}`).slice(0, 24)}${suffix}`;
}

function providerResponseText(value) {
  if (value && typeof value === "object" && typeof value.response === "string") return value.response;
  const raw = String(value ?? "");
  try {
    const envelope = JSON.parse(raw);
    if (typeof envelope?.response === "string") return envelope.response;
    if (typeof envelope?.message?.content === "string") return envelope.message.content;
  } catch {
    // The bounded extractor below handles direct or fenced JSON text.
  }
  return raw;
}

function sameSequence(left, right) {
  const leftSequence = Array.isArray(left)
    ? left
    : typeof left === "string" && left.trim() ? left.trim().split(/\s+/u) : [];
  const rightSequence = Array.isArray(right)
    ? right
    : typeof right === "string" && right.trim() ? right.trim().split(/\s+/u) : [];
  return leftSequence.length > 0
    && leftSequence.length === rightSequence.length
    && leftSequence.every((word, index) => word === rightSequence[index]);
}

export function parseTranslationVocabularyVerificationResponse(value, {
  candidates = [],
  inventory = { entries: [], grammar: [] },
  requireComplete = false,
  recoverRows = false
} = {}) {
  const raw = providerResponseText(value);
  const payload = extractBoundedJsonObject(raw);
  if (!payload) return { valid: false, reason: "response did not contain one bounded JSON object" };
  const verdict = text(payload.verdict).toLowerCase();
  if (!["complete", "partial", "uncertain"].includes(verdict)) {
    return { valid: false, reason: "response verdict must be complete, partial, or uncertain" };
  }
  if (!Array.isArray(payload.candidates)) return { valid: false, reason: "response candidates must be an array" };
  if (candidates.length > 0 && payload.candidates.length === 0) {
    return { valid: false, reason: "response candidates must contain at least one decision" };
  }
  const byId = new Map(candidates.map((candidate) => [candidateIdentity(candidate), candidate]));
  const supplied = new Set();
  const links = [];
  const inventoryRows = [
    ...(inventory?.entries ?? []),
    ...(inventory?.grammar ?? [])
  ];
  for (const row of payload.candidates) {
    const id = text(row?.id);
    if (!id || !byId.has(id) || supplied.has(id)) {
      return { valid: false, reason: "response contains an unknown or duplicated candidate id" };
    }
    supplied.add(id);
    const status = text(row?.status).toLowerCase();
    if (!["accept", "reject", "uncertain"].includes(status)) {
      return { valid: false, reason: "candidate status must be accept, reject, or uncertain" };
    }
    const rationale = text(row?.rationale);
    if (!rationale) return { valid: false, reason: "candidate rationale is empty" };
    if (rationale.length > 1200 && !recoverRows) {
      return { valid: false, reason: "candidate rationale exceeds the bounded limit" };
    }
    const boundedRationale = rationale.length > 1200 ? rationale.slice(0, 1200) : rationale;
    const pyashSequence = Array.isArray(row?.pyashSequence)
      ? row.pyashSequence.filter((word) => typeof word === "string" && word.trim()).map((word) => word.trim())
      : [];
    if (status === "accept") {
      if (pyashSequence.length === 0) {
        if (!recoverRows) return { valid: false, reason: "accepted candidate requires a Pyash sequence" };
        links.push({ id, status: "uncertain", rationale: `automatic safe downgrade: ${boundedRationale}` });
        continue;
      }
      if (!inventoryRows.some((entry) => sameSequence(entry?.pyash ?? entry?.pyashSequence, pyashSequence))) {
        if (!recoverRows) return { valid: false, reason: "accepted candidate sequence is outside the supplied inventory" };
        links.push({ id, status: "uncertain", rationale: `automatic safe downgrade: ${boundedRationale}` });
        continue;
      }
    }
    links.push({ id, status, ...(status === "accept" ? { pyashSequence } : {}), rationale: boundedRationale });
  }
  if (requireComplete && supplied.size !== candidates.length) {
    return { valid: false, reason: "response did not contain one decision for every supplied candidate id" };
  }
  return { valid: true, verdict, links, raw };
}

export function applyTranslationVocabularyVerificationResponse(result, response) {
  if (!result || typeof result !== "object") throw invalid("vocabulary apply requires a translation result");
  if (!response?.valid || !Array.isArray(response.links)) throw invalid("vocabulary apply requires a valid response");
  const byId = new Map(response.links.map((link) => [link.id, link]));
  const candidates = (result.vocabularyCandidates ?? []).map((candidate) => {
    const link = byId.get(candidateIdentity(candidate));
    if (!link) return { ...candidate };
    const verificationStatus = link.status === "accept"
      ? "accepted-llm"
      : link.status === "reject" ? "rejected-llm" : "uncertain-llm";
    return {
      ...candidate,
      status: verificationStatus,
      ...(link.status === "accept" ? { pyashSequence: [...link.pyashSequence] } : {}),
      verificationStatus,
      verificationRationale: link.rationale
    };
  });
  const accepted = new Map(candidates
    .filter((candidate) => candidate.status === "accepted-llm")
    .map((candidate) => [candidate.id, candidate]));
  const records = (result.records ?? []).map((record) => {
    const recordCandidates = candidates.filter((candidate) => candidate.sourceRecordId === record.id);
    const acceptedBySurface = new Map(recordCandidates
      .filter((candidate) => accepted.has(candidate.id))
      .map((candidate) => [text(candidate.surface).toLowerCase(), candidate]));
    if (acceptedBySurface.size === 0) return { ...record };
    const tokens = (record.tokens ?? []).map((token) => {
      const candidate = acceptedBySurface.get(text(token.surface).toLowerCase());
      return candidate
        ? { ...token, coverageType: "llm", pyashSequence: [...candidate.pyashSequence], evidence: `Housekeeper vocabulary link: ${candidate.verificationRationale}` }
        : { ...token };
    });
    const unresolved = (record.unresolved ?? []).filter((surface) => !acceptedBySurface.has(text(surface).toLowerCase()));
    return {
      ...record,
      tokens,
      unresolved,
      ...(unresolved.length === 0 && record.status === "unresolved" ? { status: "provisional" } : {})
    };
  });
  const counts = Object.fromEntries(["resolved", "provisional", "unresolved"].map((status) => [
    status,
    records.filter((record) => record.status === status).length
  ]));
  return {
    ...result,
    records,
    vocabularyCandidates: candidates,
    counts,
    resolved: records.filter((record) => record.status === "resolved"),
    provisional: records.filter((record) => record.status === "provisional"),
    unresolved: records.filter((record) => record.status === "unresolved")
  };
}

export async function reconcileTranslationVocabularyCandidates({
  result,
  sourceText,
  candidates = [],
  handleId,
  awaitHandle,
  submit,
  maxRepairAttempts = 1
} = {}) {
  if (!result || typeof result !== "object") throw invalid("vocabulary reconciliation requires a translation result");
  if (!Array.isArray(candidates) || candidates.length === 0 || !text(handleId)) return { result, queue: null };
  if (typeof awaitHandle !== "function") throw invalid("vocabulary reconciliation requires an await function");
  if (typeof submit !== "function") throw invalid("vocabulary reconciliation requires a submit function");
  const grammarCatalog = await loadEnglishGrammarCatalog();
  const inventory = buildTranslationVocabularyInventory({ sourceText, candidates, grammarEntries: grammarCatalog.entries });
  const prompt = buildTranslationVocabularyVerificationPrompt({
    language: result.language,
    sourceText,
    locator: result.locator,
    candidates,
    inventory
  });
  const repairLimit = Math.min(1, Math.max(0, Math.trunc(Number(maxRepairAttempts) || 0)));
  let attempt = 1;
  let raw = await awaitHandle(handleId);
  let response = parseTranslationVocabularyVerificationResponse(raw, { candidates, inventory, requireComplete: true });
  let repairHandleId = "";
  while (!response.valid && attempt <= repairLimit) {
    attempt += 1;
    repairHandleId = translationVocabularyQueueHandle({ sourceHash: result.sourceHash, candidates, attempt });
    const repairPrompt = [
      prompt,
      "AUTOMATIC CONTRACT REPAIR:",
      `The previous response failed deterministic validation: ${response.reason}`,
      "Return every supplied candidate id exactly once with a valid status, rationale, and inventory-backed Pyash sequence for accepted rows."
    ].join("\n");
    const queued = await submit({ handleId: repairHandleId, prompt: repairPrompt, candidates, inventory, result, maxOutputTokens: 8192 });
    if (text(queued?.status || queued?.ob?.text).toLowerCase() !== "queued") {
      response = { valid: false, reason: `automatic repair queue submission failed for ${repairHandleId}` };
      break;
    }
    raw = await awaitHandle(repairHandleId);
    response = parseTranslationVocabularyVerificationResponse(raw, { candidates, inventory, requireComplete: true });
  }
  let recovered = false;
  if (!response.valid) {
    const safeResponse = parseTranslationVocabularyVerificationResponse(raw, {
      candidates,
      inventory,
      recoverRows: true
    });
    if (safeResponse.valid && safeResponse.links.length > 0) {
      response = { ...safeResponse, recovered: true };
      recovered = true;
    }
  }
  const settled = response.valid
    ? applyTranslationVocabularyVerificationResponse(result, response)
    : applyTranslationVocabularyVerificationResponse(result, {
      valid: true,
      links: candidates.map((candidate) => ({
        id: candidateIdentity(candidate),
        status: "uncertain",
        rationale: `automatic model-response repair exhausted: ${response.reason}`
      }))
    });
  const settledWithRecovery = recovered
    ? {
      ...settled,
      vocabularyCandidates: settled.vocabularyCandidates.map((candidate) => response.links.some((link) => link.id === candidateIdentity(candidate))
        ? candidate
        : {
          ...candidate,
          status: "uncertain-llm",
          verificationStatus: "uncertain-llm",
          verificationRationale: "automatic row recovery found no decision for this candidate"
        })
    }
    : settled;
  const queue = {
    ...(result.vocabularyQueue ?? {}),
    handleId,
    status: "complete",
    outcome: response.valid ? (recovered ? "partial" : "applied") : "uncertain",
    verificationAttempts: attempt,
    ...(repairHandleId ? { repairHandleId } : {}),
    ...(response.valid ? {} : { reason: response.reason })
  };
  return {
    result: {
      ...settledWithRecovery,
      vocabularyQueue: queue,
      vocabularyCandidates: settledWithRecovery.vocabularyCandidates.map((candidate) => ({
        ...candidate,
        queue: { ...(candidate.queue ?? {}), ...queue, candidateIds: [candidateIdentity(candidate)] }
      }))
    },
    response,
    queue
  };
}

function uniqueCandidates(candidates) {
  const seen = new Set();
  return candidates.filter((candidate) => {
    const key = `${text(candidate?.surface).toLowerCase()}\u0000${text(candidate?.kind)}`;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function submitTranslationVocabularyCandidates({
  result,
  sourceText,
  submit,
  submittedAt = new Date().toISOString(),
  attempt = 1
} = {}) {
  if (!result || typeof result !== "object") throw invalid("vocabulary queue requires a translation result");
  if (!text(sourceText)) throw invalid("vocabulary queue requires source text");
  const candidates = Array.isArray(result.vocabularyCandidates) ? result.vocabularyCandidates : [];
  if (candidates.length === 0) {
    return { result, submitted: false, submittedCount: 0, handleId: "", candidates: [] };
  }
  if (typeof submit !== "function") throw invalid("vocabulary queue requires a submit function");
  const batch = uniqueCandidates(candidates);
  const handleId = translationVocabularyQueueHandle({ sourceHash: result.sourceHash, candidates: batch, attempt });
  const grammarCatalog = await loadEnglishGrammarCatalog();
  const inventory = buildTranslationVocabularyInventory({
    sourceText,
    candidates: batch,
    grammarEntries: grammarCatalog.entries
  });
  const prompt = buildTranslationVocabularyVerificationPrompt({
    language: result.language,
    sourceText,
    locator: result.locator,
    candidates: batch,
    inventory
  });
  const response = await submit({
    handleId,
    prompt,
    candidates: batch,
    inventory,
    result
  });
  const status = text(response?.status || response?.ob?.text).toLowerCase();
  if (status !== "queued") {
    throw invalid("vocabulary queue submission was not accepted", { handleId, response });
  }
  const queue = {
    handleId,
    status: "queued",
    intent: TRANSLATION_VOCABULARY_QUEUE_INTENT,
    lane: TRANSLATION_VOCABULARY_QUEUE_LANE,
    submittedAt,
    candidateCount: batch.length,
    attempt: Math.max(1, Math.trunc(Number(attempt) || 1))
  };
  return {
    result: {
      ...result,
      vocabularyCandidates: candidates.map((candidate) => ({
        ...candidate,
        queue: {
          ...queue,
          candidateIds: [candidateIdentity(candidate)]
        }
      })),
      vocabularyQueue: queue
    },
    submitted: true,
    submittedCount: batch.length,
    handleId,
    candidates: batch,
    prompt,
    response
  };
}

const DEFAULT_TRANSLATION_VOCABULARY_RESPONSE_FORMAT = {
  type: "object",
  required: ["verdict", "candidates"],
  additionalProperties: false,
  properties: {
    verdict: { type: "string", enum: ["complete", "partial", "uncertain"] },
    candidates: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "status", "pyashSequence", "rationale"],
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          status: { type: "string", enum: ["accept", "reject", "uncertain"] },
          pyashSequence: { type: "array", items: { type: "string" } },
          rationale: { type: "string", maxLength: 120 }
        }
      }
    }
  }
};

export function createQueuedMindTranslationVocabularySubmitter({
  interpret,
  parse,
  responseFormat = DEFAULT_TRANSLATION_VOCABULARY_RESPONSE_FORMAT,
  maxOutputTokens = 4096
} = {}) {
  if (typeof interpret !== "function") throw invalid("queued vocabulary submitter requires interpret");
  if (typeof parse !== "function") throw invalid("queued vocabulary submitter requires parse");
  if (!responseFormat || typeof responseFormat !== "object") {
    throw invalid("queued vocabulary submitter requires a response format");
  }
  return async ({ handleId, prompt, maxOutputTokens: requestedMaxOutputTokens } = {}) => {
    const outputTokens = Math.max(1, Math.trunc(Number(requestedMaxOutputTokens ?? maxOutputTokens) || 4096));
    const jobSpec = {
      kind: "ollama-generate",
      prompt: String(prompt ?? ""),
      stream: false,
      think: false,
      format: responseFormat,
      options: {
        temperature: 0,
        num_predict: outputTokens
      }
    };
    const response = await interpret(parse(
      `su name ${JSON.stringify(handleId)} ob text ${JSON.stringify(JSON.stringify(jobSpec))} vyah start future be gpu mind do`
    ));
    return { ...response, status: text(response?.ob?.text) };
  };
}

export async function createDefaultQueuedMindTranslationVocabularySubmitter(options = {}) {
  const [{ interpret }, { parse }] = await Promise.all([
    import("../../../bridge/index.mjs"),
    import("../../../understand/index.mjs")
  ]);
  return createQueuedMindTranslationVocabularySubmitter({ interpret, parse, ...options });
}
