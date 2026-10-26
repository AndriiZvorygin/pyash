import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { buildProgram } from "../../../program.mjs";
import {
  buildTranslationVocabularyInventory,
  createQueuedMindTranslationVocabularySubmitter
} from "./translation_vocabulary_queue.mjs";
import { DERIVED_COMPOUND_STATUSES } from "./compound_coverage.mjs";
import { extractBoundedJsonObject } from "./english_verification.mjs";
import {
  DEFAULT_TRANSLATION_MODEL,
  loadTranslationModelCard,
  TRANSLATION_MODEL_CARDS_URL
} from "./translation_model_cards.mjs";
import {
  ENGLISH_WORDNET_SELECTION_DEFAULT_OUTPUT_TOKENS,
  ENGLISH_WORDNET_SELECTION_FORMAT
} from "./english_wordnet_selection.mjs";

export const ENGLISH_WORDNET_LINKER_FORMAT = "english-wordnet-linker-v1";
export const ENGLISH_WORDNET_LINKER_NAME = "translation_english_wordnet_linker";
export const ENGLISH_WORDNET_LINKER_CONFIG_URL = new URL("./english_wordnet_linker.pya", import.meta.url);
export const ENGLISH_WORDNET_LINKER_QUEUE_INTENT = "mind";
export const ENGLISH_WORDNET_LINKER_QUEUE_LANE = "durable";
export const ENGLISH_WORDNET_LINKER_DEFAULT_BATCH_SIZE = 200;
export const ENGLISH_WORDNET_LINKER_PROMPT_MAX_CHARS = 12000;
export const ENGLISH_WORDNET_LINKER_PROMPT_MAX_TOKENS = 3900;
export const ENGLISH_WORDNET_LINKER_DEFAULT_OUTPUT_TOKENS = 1024;
export const ENGLISH_WORDNET_LINKER_EDGE_MAX_DEGREE = 1;
export const ENGLISH_WORDNET_LINKER_DEFAULT_DUTY_SIZE = 4;
export const ENGLISH_WORDNET_LINKER_RESPONSE_FORMAT = Object.freeze({
  type: "object",
  required: ["verdict", "senses"],
  additionalProperties: false,
  properties: {
    verdict: { type: "string", enum: ["complete", "partial", "uncertain"] },
    senses: {
      minItems: 1,
      type: "array",
      items: {
        type: "object",
        required: ["id", "status", "rationale"],
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          status: { type: "string", enum: ["accept", "reject", "uncertain"] },
          targetEnglish: { type: "string" },
          rationale: { type: "string", maxLength: 120 }
        }
      }
    }
  }
});

const ACCEPTED_STATUSES = new Set(["accepted-existing", "accepted-edge", "accepted-deterministic", "accepted-llm"]);
const LINK_STATUSES = new Set(["accept", "reject", "uncertain"]);
const MAX_RATIONALE_CHARS = 1200;
const WORDNET_POS = new Set(["a", "n", "r", "s", "v"]);

function invalid(message, details = {}) {
  const error = new Error(message);
  error.code = "invalid-english-wordnet-linker";
  error.details = details;
  return error;
}

function text(value) {
  return typeof value === "string" ? value.normalize("NFC").trim() : "";
}

function normalized(value) {
  return text(value).toLowerCase().replace(/[ _-]+/gu, " ").replace(/\s+/gu, " ");
}

function bounded(value, maxChars) {
  const limit = Math.max(1, Math.trunc(Number(maxChars) || 1));
  const valueText = text(value);
  return valueText.length > limit ? `${valueText.slice(0, Math.max(0, limit - 1))}…` : valueText;
}

function matchingSourceTerms(lemmas, sourceTerms) {
  const rows = Array.isArray(sourceTerms) ? sourceTerms : [];
  return rows.filter((term) => {
    const variants = new Set(termVariants(term));
    return [...(lemmas ?? [])].some((lemma) => (
      termVariants(lemma).some((variant) => variants.has(variant))
    ));
  });
}

function compactSense(record, context) {
  const sourceTerms = Array.isArray(record?.sourceTerms) && record.sourceTerms.length > 0
    ? record.sourceTerms
    : [record?.lemmas?.[0] ?? ""];
  const contextByTerm = new Map((Array.isArray(context) ? context : []).map((row) => [
    normalized(row?.term),
    [...new Set((row?.sentences ?? []).map((sentence) => bounded(sentence, 280)))]
  ]));
  const sentences = sourceTerms.flatMap((term) => contextByTerm.get(normalized(term)) ?? []);
  return {
    id: text(record?.id),
    word: bounded(sourceTerms[0], 32),
    s: text(record?.source),
    p: text(record?.pos),
    g: bounded(record?.gloss, 56),
    l: (record?.lemmas ?? []).slice(0, 2).map((lemma) => bounded(lemma, 24)),
    sourceSentences: [...new Set(sentences)].slice(0, 3),
    choices: (record?.candidates ?? []).slice(0, 8).map((candidate) => ({
      targetEnglish: bounded(candidate?.target, 48),
      evidence: bounded(candidate?.evidence, 120)
    }))
  };
}

export function estimateEnglishWordNetSenseLinkPromptTokens(value) {
  return [...String(value ?? "").matchAll(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*|[^\s]/gu)].length;
}

function outputFits(records, maxOutputTokens) {
  const fixedOutputTokens = 192;
  // The response contract bounds each rationale to 120 characters. Keep enough room
  // for one compact decision per supplied sense while retaining repair headroom.
  const perSenseTokens = 128;
  return fixedOutputTokens + (records.length * perSenseTokens) < maxOutputTokens;
}

function termVariants(value) {
  const word = normalized(value);
  if (!word) return [];
  const variants = new Set([word]);
  if (word.endsWith("ies")) variants.add(`${word.slice(0, -3)}y`);
  if (word.endsWith("ves")) variants.add(`${word.slice(0, -3)}f`).add(`${word.slice(0, -3)}fe`);
  if (word.endsWith("es")) variants.add(word.slice(0, -2)).add(word.slice(0, -1));
  if (word.endsWith("s")) variants.add(word.slice(0, -1));
  if (word.endsWith("ing")) variants.add(word.slice(0, -3)).add(`${word.slice(0, -3)}e`);
  if (word.endsWith("ed")) variants.add(word.slice(0, -2));
  return [...variants].filter((variant) => variant.length > 1);
}

function hash(value) {
  return createHash("sha256").update(String(value ?? "")).digest("hex");
}

function senseKey(pos, synset) {
  return `${pos}:${synset}`;
}

function senseId(source) {
  return `english-wordnet-sense-${hash(source).slice(0, 24)}`;
}

function sequence(value) {
  if (Array.isArray(value)) {
    return value.filter((word) => typeof word === "string" && word.trim()).map((word) => word.trim());
  }
  return typeof value === "string" && value.trim() ? [value.trim()] : [];
}

function sequenceKey(value) {
  return sequence(value).join(" ");
}

function candidateId(record, target, pyashSequence) {
  return `${record.id}::${normalized(target)}::${sequenceKey(pyashSequence)}`;
}

function sourceTermSet(sourceTerms) {
  return new Set((Array.isArray(sourceTerms) ? sourceTerms : sourceTerms ? [sourceTerms] : [])
    .flatMap(termVariants));
}

function sourceMatches(lemmas, terms) {
  if (terms.size === 0) return true;
  return lemmas.some((lemma) => termVariants(lemma).some((variant) => terms.has(variant)));
}

function bridgeFor(wordnetIndex, source, resolveWord) {
  const bridge = wordnetIndex?.bridgeIndex?.get(source);
  if (!bridge) return null;
  const coverage = typeof resolveWord === "function" ? resolveWord(bridge.target) : null;
  const pyashSequence = sequence(bridge.pyashSequence).length > 0
    ? sequence(bridge.pyashSequence)
    : sequence(coverage?.pyashSequence);
  return {
    target: normalized(bridge.target),
    pyashSequence,
    targetPartOfSpeech: text(bridge.targetPartOfSpeech),
    certainty: text(bridge.certainty) || "contextual",
    evidence: text(bridge.evidence)
  };
}

function linkCandidate(record, target, pyashSequence, {
  targetPartOfSpeech = record.pos,
  certainty = "contextual",
  evidence = "",
  sourceLemma = "",
  edgeEligible = false
} = {}) {
  const targetName = normalized(target);
  const words = sequence(pyashSequence);
  if (!targetName || words.length === 0) return null;
  return {
    id: candidateId(record, targetName, words),
    target: targetName,
    pyashSequence: words,
    targetPartOfSpeech: text(targetPartOfSpeech) || record.pos,
    certainty: text(certainty) || "contextual",
    evidence: text(evidence),
    sourceLemmas: sourceLemma ? [sourceLemma] : [],
    edgeEligible: edgeEligible === true
  };
}

function singleSenseLemma(wordnetIndex, lemma, source) {
  if (!wordnetIndex || typeof wordnetIndex.lookup !== "function") return false;
  const senses = new Set(wordnetIndex.lookup(lemma).map((row) => `${row.pos}:${row.synset}`));
  return senses.size === 1 && senses.has(source);
}

function edgeNodeDegree(wordnetIndex, source) {
  return wordnetIndex?.relationGraph instanceof Map
    ? (wordnetIndex.relationGraph.get(source)?.length ?? 0)
    : 0;
}

function edgeDegreeLimit(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric)
    ? Math.max(0, Math.trunc(numeric))
    : ENGLISH_WORDNET_LINKER_EDGE_MAX_DEGREE;
}

function directCandidates(record, resolveWord, wordnetIndex, maxEdgeDegree) {
  if (typeof resolveWord !== "function") return [];
  const candidates = new Map();
  for (const lemma of record.lemmas) {
    const coverage = resolveWord(lemma);
    if (!coverage?.pyashSequence?.length || coverage.coverageType === "dictionary-alias") continue;
    const edgeEligible = singleSenseLemma(wordnetIndex, lemma, record.source)
      && edgeNodeDegree(wordnetIndex, record.source) <= maxEdgeDegree;
    const candidate = linkCandidate(record, coverage.canonicalEnglish || lemma, coverage.pyashSequence, {
      targetPartOfSpeech: record.pos,
      certainty: "deterministic",
      evidence: edgeEligible
        ? `leaf/edge WordNet node ${record.source} has one meaning for lemma ${lemma} and existing Pyash coverage`
        : `existing Pyash coverage for WordNet lemma ${lemma}`,
      sourceLemma: lemma,
      edgeEligible
    });
    if (!candidate) continue;
    const key = sequenceKey(candidate.pyashSequence);
    const prior = candidates.get(key);
    if (!prior) {
      candidates.set(key, candidate);
      continue;
    }
    prior.sourceLemmas = [...new Set([...prior.sourceLemmas, ...candidate.sourceLemmas])];
    prior.edgeEligible ||= candidate.edgeEligible;
    if (candidate.edgeEligible) prior.evidence = candidate.evidence;
  }
  return [...candidates.values()];
}

export function linkEnglishWordNetSense({
  sense,
  sourceTerm = "",
  resolveWord,
  wordnetIndex,
  edgeMaxDegree = ENGLISH_WORDNET_LINKER_EDGE_MAX_DEGREE
} = {}) {
  const source = senseKey(sense?.pos, sense?.synset);
  const record = {
    id: senseId(source),
    source,
    pos: text(sense?.pos),
    synset: text(sense?.synset),
    lemmas: [...new Set((sense?.lemmas ?? [sense?.lemma]).map(normalized).filter(Boolean))].sort(),
    gloss: text(sense?.gloss),
    sourceTerms: sourceTerm ? [normalized(sourceTerm)] : [],
    candidates: []
  };
  const existing = bridgeFor(wordnetIndex, source, resolveWord);
  if (existing?.target && existing.pyashSequence.length > 0) {
    return { ...record, status: "accepted-existing", link: existing };
  }
  record.candidates = directCandidates(record, resolveWord, wordnetIndex, edgeDegreeLimit(edgeMaxDegree));
  const edgeCandidates = record.candidates.filter((candidate) => candidate.edgeEligible);
  const linked = edgeCandidates.length === 1
    ? { status: "accepted-edge", link: edgeCandidates[0] }
    : record.candidates.length === 1
      ? { status: "accepted-deterministic", link: record.candidates[0] }
      : { status: "review" };
  return { ...record, ...linked };
}

function rowsForWordNetIndex(wordnetIndex) {
  if (!(wordnetIndex?.bySynset instanceof Map)) {
    throw invalid("WordNet linker requires an indexed WordNet resource");
  }
  return [...wordnetIndex.bySynset.entries()]
    .map(([key, rows]) => ({ key, rows: Array.isArray(rows) ? rows : [] }))
    .filter(({ key, rows }) => WORDNET_POS.has(key.slice(0, 1)) && key[1] === ":" && rows.length > 0)
    .sort((left, right) => left.key.localeCompare(right.key));
}

export function buildEnglishWordNetSenseLinkRecords({
  wordnetIndex,
  resolveWord,
  sourceTerms = [],
  limit = ENGLISH_WORDNET_LINKER_DEFAULT_BATCH_SIZE,
  edgeMaxDegree = ENGLISH_WORDNET_LINKER_EDGE_MAX_DEGREE
} = {}) {
  const terms = sourceTermSet(sourceTerms);
  const requestedTerms = [...new Set((Array.isArray(sourceTerms) ? sourceTerms : [sourceTerms])
    .map(normalized)
    .filter(Boolean))];
  const max = Math.max(1, Math.trunc(Number(limit) || ENGLISH_WORDNET_LINKER_DEFAULT_BATCH_SIZE));
  const maxEdgeDegree = edgeDegreeLimit(edgeMaxDegree);
  const records = [];
  for (const { key, rows } of rowsForWordNetIndex(wordnetIndex)) {
    const pos = key.slice(0, 1);
    const synset = key.slice(2);
    const lemmas = [...new Set(rows.map((row) => normalized(row?.lemma)).filter(Boolean))].sort();
    if (!sourceMatches(lemmas, terms)) continue;
    const gloss = text(rows.map((row) => row?.gloss).find(Boolean));
    const id = senseId(key);
    const record = {
      id,
      source: key,
      pos,
      synset,
      lemmas,
      gloss,
      sourceTerms: matchingSourceTerms(lemmas, requestedTerms),
      candidates: []
    };
    const existing = bridgeFor(wordnetIndex, key, resolveWord);
    if (existing?.target && existing.pyashSequence.length > 0) {
      record.status = "accepted-existing";
      record.link = existing;
    } else {
      record.candidates = directCandidates(record, resolveWord, wordnetIndex, maxEdgeDegree);
      const edgeCandidates = record.candidates.filter((candidate) => candidate.edgeEligible);
      record.edgeNode = {
        degree: edgeNodeDegree(wordnetIndex, key),
        singleSenseLemmas: record.candidates
          .filter((candidate) => candidate.edgeEligible)
          .flatMap((candidate) => candidate.sourceLemmas)
      };
      if (edgeCandidates.length === 1) {
        record.status = "accepted-edge";
        record.link = edgeCandidates[0];
      } else if (record.candidates.length === 1) {
        record.status = "accepted-deterministic";
        record.link = record.candidates[0];
      } else {
        record.status = "review";
      }
    }
    records.push(record);
    if (records.length >= max) break;
  }
  const senseCounts = new Map();
  for (const record of records) {
    for (const term of record.sourceTerms) {
      senseCounts.set(term, (senseCounts.get(term) ?? 0) + 1);
    }
  }
  return records.map((record) => {
    const ambiguous = record.sourceTerms.some((term) => (senseCounts.get(term) ?? 0) > 1);
    if (!ambiguous || !["accepted-edge", "accepted-deterministic"].includes(record.status)) {
      return record;
    }
    return { ...record, status: "review" };
  });
}

function inventoryRowKey(row) {
  return `${normalized(row?.english)}\u0000${sequenceKey(row?.pyash)}`;
}

function acceptedCompoundRow(record) {
  const status = text(record?.status);
  const accepted = DERIVED_COMPOUND_STATUSES.slice(0, 2).includes(status);
  const english = normalized(record?.target ?? record?.surface ?? record?.english);
  const pyash = sequence(record?.pyashSequence ?? record?.pyash);
  if (!accepted || !english || pyash.length < 2) return null;
  return { english, pyash };
}

export function buildEnglishWordNetSenseLinkInventory({
  records = [],
  grammarEntries = [],
  anchors = [],
  compoundRecords = [],
  baseInventory
} = {}) {
  const inventory = baseInventory ?? buildTranslationVocabularyInventory({
    sourceText: records.map((record) => `${record.gloss} ${record.lemmas.join(" ")}`).join(" "),
    candidates: records.map((record) => ({
      surface: record.lemmas.join(" "),
      context: [record.gloss]
    })),
    grammarEntries
  });
  const rows = [...(inventory.entries ?? [])];
  const seen = new Set(rows.map(inventoryRowKey));
  for (const anchor of [
    ...records.flatMap((record) => record.candidates ?? []),
    ...anchors,
    ...compoundRecords.map(acceptedCompoundRow).filter(Boolean)
  ]) {
    const row = {
      english: anchor?.target ?? anchor?.english,
      pyash: anchor?.pyashSequence ?? anchor?.pyash
    };
    if (!normalized(row.english) || sequence(row.pyash).length === 0) continue;
    const key = inventoryRowKey(row);
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ english: normalized(row.english), pyash: sequence(row.pyash) });
  }
  return {
    entries: rows.slice(0, 2800),
    grammar: [...(inventory.grammar ?? [])]
  };
}

export function buildEnglishWordNetSenseLinkPrompt({
  records = [],
  inventory = { entries: [], grammar: [] },
  source = "Open English WordNet",
  context = [],
  maxChars = ENGLISH_WORDNET_LINKER_PROMPT_MAX_CHARS,
  maxTokens = ENGLISH_WORDNET_LINKER_PROMPT_MAX_TOKENS,
  repairReason = ""
} = {}) {
  if (!Array.isArray(records) || records.length === 0) {
    throw invalid("WordNet linker prompt requires sense records");
  }
  const senseRows = records.map((record) => JSON.stringify(compactSense(record, context))).join("\n");
  const fixed = [
    "You are the bounded Pyash WordNet sense-linking worker.",
    "For each supplied WordNet sense, decide whether its source sentence supports one of the choices on that same row.",
    "Use the original source sentence, gloss, lemmas, and choice evidence as the only decision context.",
    "Accept only the sense and choice that best fits the source sentence; reject unrelated senses.",
    "Use uncertain only when the supplied sentence leaves two or more choices genuinely plausible.",
    "A sense row with no choices cannot be accepted; use reject or uncertain.",
    "Choose targetEnglish only from the choices listed on that same sense row.",
    "For an accepted link, targetEnglish must exactly match one listed choice.",
    "Return the English anchor and sense decision only; the host pipeline derives the Pyash sequence.",
    "Never return Pyash tokens, pyashSequence, or a concatenated phrase.",
    "Preserve uncertainty when the choices or sense evidence are insufficient.",
    "Return exactly one JSON object with this shape:",
    '{"verdict":"complete|partial|uncertain","senses":[{"id":"...","status":"accept|reject|uncertain","targetEnglish":"...","rationale":"..."}]}',
    "Include exactly one result for every supplied sense id. Never return an empty senses array.",
    "For reject or uncertain, omit targetEnglish.",
    ...(text(repairReason) ? [
      `AUTOMATIC CONTRACT REPAIR: ${bounded(repairReason, 300)}`,
      "Return every supplied sense id exactly once, and include targetEnglish for every accepted row. Never return Pyash tokens."
    ] : []),
    `SOURCE: ${text(source) || "Open English WordNet"}`,
    "Each row contains only one source word, its original source sentence, its WordNet sense, and its allowed choices.",
    "WORDNET SENSES AND PER-SENSE CHOICES:",
    senseRows
  ];
  const budget = Math.max(1000, Math.trunc(Number(maxChars) || ENGLISH_WORDNET_LINKER_PROMPT_MAX_CHARS));
  const tokenBudget = Math.max(100, Math.trunc(Number(maxTokens) || ENGLISH_WORDNET_LINKER_PROMPT_MAX_TOKENS));
  const prompt = fixed.join("\n");
  const tokenEstimate = estimateEnglishWordNetSenseLinkPromptTokens(prompt);
  if (prompt.length > budget || tokenEstimate >= tokenBudget) {
    throw invalid("WordNet linker prompt exceeds configured prompt budget", {
      budget,
      promptChars: prompt.length,
      tokenBudget,
      tokenEstimate,
      senseCount: records.length
    });
  }
  return prompt;
}

export function wordNetSenseLinkQueueHandle({ sourceHash, records = [], attempt = 1 } = {}) {
  const source = text(sourceHash);
  const ids = records.map((record) => text(record?.id)).filter(Boolean).sort().join("\u0000");
  if (!source || !ids) throw invalid("WordNet linker queue handle requires source hash and records");
  const retry = Math.max(1, Math.trunc(Number(attempt) || 1));
  return `english-wordnet-link-${hash(`${source}\u0000${ids}`).slice(0, 24)}${retry > 1 ? `-retry-${retry}` : ""}`;
}

function partitionSenseRecords(records, options) {
  const batches = [];
  let batch = [];
  for (const record of records) {
    const recordTerms = new Set(record.sourceTerms ?? []);
    const sameSourceWord = batch.length > 0
      && recordTerms.size > 0
      && batch.every((candidate) => [...recordTerms].some((term) => (candidate.sourceTerms ?? []).includes(term)));
    if (batch.length >= options.maxDutySenses && !sameSourceWord) {
      batches.push(batch);
      batch = [];
    }
    const candidate = [...batch, record];
    try {
      buildEnglishWordNetSenseLinkPrompt({ ...options, records: candidate });
      if (!outputFits(candidate, options.maxOutputTokens)) {
        throw invalid("WordNet linker output budget cannot hold one result per sense", {
          maxOutputTokens: options.maxOutputTokens,
          senseCount: candidate.length
        });
      }
      batch = candidate;
    } catch (error) {
      if (batch.length === 0) throw error;
      batches.push(batch);
      batch = [record];
      buildEnglishWordNetSenseLinkPrompt({ ...options, records: batch });
      if (!outputFits(batch, options.maxOutputTokens)) {
        throw invalid("WordNet linker output budget cannot hold one sense result", {
          maxOutputTokens: options.maxOutputTokens
        });
      }
    }
  }
  if (batch.length > 0) batches.push(batch);
  return batches;
}

export async function submitEnglishWordNetSenseLinks({
  records = [],
  inventory,
  sourceHash,
  source = "Open English WordNet",
  context = [],
  maxChars = ENGLISH_WORDNET_LINKER_PROMPT_MAX_CHARS,
  maxTokens = ENGLISH_WORDNET_LINKER_PROMPT_MAX_TOKENS,
  maxOutputTokens = ENGLISH_WORDNET_LINKER_DEFAULT_OUTPUT_TOKENS,
  maxDutySenses = ENGLISH_WORDNET_LINKER_DEFAULT_DUTY_SIZE,
  submit,
  attempt = 1
} = {}) {
  if (!Array.isArray(records)) throw invalid("WordNet linker records must be an array");
  const pending = records.filter((record) => !ACCEPTED_STATUSES.has(record?.status));
  const decisionPending = pending.filter((record) => (
    Array.isArray(record?.candidates) && record.candidates.length > 0
  ));
  const skipped = pending.filter((record) => !decisionPending.includes(record));
  if (decisionPending.length === 0) {
    return { submitted: false, records: [...records], pending: [], skipped };
  }
  if (typeof submit !== "function") throw invalid("WordNet linker requires a queue submitter");
  const promptOptions = {
    inventory,
    source,
    context,
    maxChars,
    maxTokens,
    maxOutputTokens,
    maxDutySenses: Math.max(1, Math.trunc(Number(maxDutySenses) || ENGLISH_WORDNET_LINKER_DEFAULT_DUTY_SIZE))
  };
  const batches = partitionSenseRecords(decisionPending, promptOptions);
  const queues = [];
  const prompts = [];
  const responses = [];
  const pendingQueues = new Map();
  for (const batch of batches) {
    const handleId = wordNetSenseLinkQueueHandle({ sourceHash, records: batch, attempt });
    const prompt = buildEnglishWordNetSenseLinkPrompt({ records: batch, ...promptOptions });
    const response = await submit({
      handleId,
      prompt,
      candidates: batch,
      inventory,
      sourceHash,
      maxOutputTokens
    });
    const status = text(response?.status || response?.ob?.text).toLowerCase();
    if (status !== "queued") {
      throw invalid("WordNet linker queue submission was not accepted", { handleId, response });
    }
    const queue = {
      handleId,
      status: "queued",
      intent: ENGLISH_WORDNET_LINKER_QUEUE_INTENT,
      lane: ENGLISH_WORDNET_LINKER_QUEUE_LANE,
      attempt: Math.max(1, Math.trunc(Number(attempt) || 1)),
      senseCount: batch.length
    };
    queues.push(queue);
    prompts.push(prompt);
    responses.push(response);
    for (const record of batch) pendingQueues.set(record.id, queue);
  }
  return {
    submitted: true,
    handleId: queues.length === 1 ? queues[0].handleId : "",
    prompt: prompts.length === 1 ? prompts[0] : prompts,
    response: responses.length === 1 ? responses[0] : responses,
    queue: queues.length === 1 ? queues[0] : null,
    queues,
    pending: decisionPending,
    skipped,
    records: records.map((record) => pendingQueues.has(record.id)
      ? { ...record, queue: pendingQueues.get(record.id) }
      : { ...record })
  };
}

function inventoryMatch({ targetEnglish, record }) {
  const targetName = normalized(targetEnglish);
  return (record?.candidates ?? []).find((option) => (
    normalized(option?.target ?? option?.english) === targetName
  )) ?? null;
}

function providerResponseText(value) {
  if (value && typeof value === "object" && typeof value.response === "string") {
    return value.response;
  }
  const raw = String(value ?? "");
  try {
    const envelope = JSON.parse(raw);
    if (envelope && typeof envelope.response === "string") return envelope.response;
  } catch {
    // The bounded extractor below handles direct or noisy provider text.
  }
  return raw;
}

export function parseEnglishWordNetSenseLinkResponse(value, {
  records = [],
  inventory,
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
  if (!Array.isArray(payload.senses)) return { valid: false, reason: "response senses must be an array" };
  if (records.length > 0 && payload.senses.length === 0) {
    return { valid: false, reason: "response senses must contain at least one decision" };
  }
  const byId = new Map(records.map((record) => [record.id, record]));
  const seen = new Set();
  const links = [];
  for (const row of payload.senses) {
    const id = text(row?.id);
    if (!id || !byId.has(id) || seen.has(id)) return { valid: false, reason: "response contains an unknown or duplicated sense id" };
    seen.add(id);
    const status = text(row?.status).toLowerCase();
    if (!LINK_STATUSES.has(status)) return { valid: false, reason: "sense status must be accept, reject, or uncertain" };
    const rationale = text(row?.rationale);
    if (!rationale) return { valid: false, reason: "sense rationale is empty" };
    if (rationale.length > MAX_RATIONALE_CHARS && !recoverRows) {
      return { valid: false, reason: "sense rationale exceeds the bounded limit" };
    }
    const boundedRationale = bounded(rationale, MAX_RATIONALE_CHARS);
    if (status === "accept") {
      if (Object.hasOwn(row, "pyashSequence")) {
        return { valid: false, reason: "response must choose targetEnglish; Pyash sequence is derived" };
      }
      const targetEnglish = normalized(row?.targetEnglish);
      if (!targetEnglish) {
        if (!recoverRows) return { valid: false, reason: "accepted sense requires targetEnglish" };
        links.push({
          id,
          status: "uncertain",
          rationale: `automatic safe downgrade: ${bounded(boundedRationale, MAX_RATIONALE_CHARS - 28)}`
        });
        continue;
      }
      const match = inventoryMatch({ targetEnglish, record: byId.get(id) });
      const pyashSequence = sequence(match?.pyashSequence ?? match?.pyash);
      if (!match || pyashSequence.length === 0) {
        if (!recoverRows) return { valid: false, reason: "accepted sense target is outside the supplied sense choices" };
        links.push({
          id,
          status: "uncertain",
          rationale: `automatic safe downgrade: ${boundedRationale}`
        });
        continue;
      }
      links.push({
        id,
        status,
        target: targetEnglish,
        pyashSequence,
        targetPartOfSpeech: byId.get(id).pos,
        certainty: "contextual",
        rationale: boundedRationale,
        evidence: `Housekeeper WordNet sense link: ${boundedRationale}`
      });
    } else {
      links.push({ id, status, rationale: boundedRationale });
    }
  }
  if (requireComplete && seen.size !== records.length) {
    return { valid: false, reason: "response did not contain one decision for every supplied sense id" };
  }
  return { valid: true, verdict, links, raw };
}

export function applyEnglishWordNetSenseLinkResponse(records, response) {
  if (!Array.isArray(records)) throw invalid("WordNet linker apply requires records");
  if (!response?.valid || !Array.isArray(response.links)) throw invalid("WordNet linker apply requires a valid response");
  const byId = new Map(response.links.map((link) => [link.id, link]));
  const updated = records.map((record) => {
    const link = byId.get(record.id);
    if (!link) return { ...record };
    if (link.status === "accept") {
      return {
        ...record,
        status: "accepted-llm",
        link: {
          target: link.target,
          pyashSequence: [...link.pyashSequence],
          targetPartOfSpeech: link.targetPartOfSpeech,
          certainty: link.certainty,
          evidence: link.evidence
        },
        verificationRationale: link.rationale
      };
    }
    return {
      ...record,
      status: link.status === "reject" ? "rejected-llm" : "uncertain-llm",
      verificationRationale: link.rationale
    };
  });
  return {
    records: updated,
    accepted: updated.filter((record) => ACCEPTED_STATUSES.has(record.status)),
    rejected: updated.filter((record) => record.status === "rejected-llm"),
    uncertain: updated.filter((record) => record.status === "uncertain-llm" || record.status === "review")
  };
}

export function buildEnglishWordNetSenseBridgeIndex(records = []) {
  const bridges = new Map();
  for (const record of records) {
    if (!ACCEPTED_STATUSES.has(record?.status) || !record?.link?.target) continue;
    const source = senseKey(record.pos, record.synset);
    const pyashSequence = sequence(record.link.pyashSequence);
    if (!source || pyashSequence.length === 0) continue;
    bridges.set(source, {
      target: normalized(record.link.target),
      pyashSequence,
      targetPartOfSpeech: text(record.link.targetPartOfSpeech) || text(record.pos),
      certainty: text(record.link.certainty) || "contextual",
      evidence: text(record.link.evidence) || text(record.verificationRationale)
    });
  }
  return bridges;
}

export async function reconcileEnglishWordNetSenseLinks({
  records = [],
  inventory,
  sourceHash,
  context = [],
  source = "Open English WordNet",
  maxChars = ENGLISH_WORDNET_LINKER_PROMPT_MAX_CHARS,
  maxTokens = ENGLISH_WORDNET_LINKER_PROMPT_MAX_TOKENS,
  maxOutputTokens = ENGLISH_WORDNET_LINKER_DEFAULT_OUTPUT_TOKENS,
  queues = [],
  awaitHandle,
  submit,
  maxRepairAttempts = 1
} = {}) {
  if (!Array.isArray(records)) throw invalid("WordNet linker reconciliation requires records");
  if (!Array.isArray(queues) || queues.length === 0) return { records: [...records], queues: [] };
  if (typeof awaitHandle !== "function") throw invalid("WordNet linker reconciliation requires an await function");
  if (typeof submit !== "function") throw invalid("WordNet linker reconciliation requires a submit function");
  const repairLimit = Math.min(1, Math.max(0, Math.trunc(Number(maxRepairAttempts) || 0)));
  let current = records.map((record) => ({ ...record }));
  const reconciledQueues = [];
  for (const queue of queues) {
    const batch = current.filter((record) => record.queue?.handleId === queue.handleId);
    if (batch.length === 0) continue;
    let queueState = { ...queue };
    let attempt = 1;
    let raw = await awaitHandle(queue.handleId);
    let response = parseEnglishWordNetSenseLinkResponse(raw, {
      records: batch,
      inventory,
      requireComplete: true
    });
    while (!response.valid && attempt <= repairLimit) {
      attempt += 1;
      const repairHandleId = wordNetSenseLinkQueueHandle({ sourceHash, records: batch, attempt });
      const repairPrompt = buildEnglishWordNetSenseLinkPrompt({
        records: batch,
        inventory,
        source,
        context,
        maxChars,
        maxTokens,
        repairReason: response.reason
      });
      const queued = await submit({
        handleId: repairHandleId,
        prompt: repairPrompt,
        candidates: batch,
        inventory,
        sourceHash,
        maxOutputTokens
      });
      const status = text(queued?.status || queued?.ob?.text).toLowerCase();
      if (status !== "queued") {
        response = { valid: false, reason: `automatic repair queue submission failed for ${repairHandleId}` };
        break;
      }
      queueState = { ...queueState, repairHandleId };
      raw = await awaitHandle(repairHandleId);
      response = parseEnglishWordNetSenseLinkResponse(raw, {
        records: batch,
        inventory,
        requireComplete: true
      });
    }
    let recovered = false;
    if (!response.valid) {
      const safeResponse = parseEnglishWordNetSenseLinkResponse(raw, {
        records: batch,
        inventory,
        recoverRows: true
      });
      if (safeResponse.valid && safeResponse.links.length > 0) {
        response = { ...safeResponse, recovered: true };
        recovered = true;
      }
    }
    if (response.valid) {
      current = applyEnglishWordNetSenseLinkResponse(current, response).records;
      if (recovered) {
        const linked = new Set(response.links.map((link) => link.id));
        current = current.map((record) => batch.some((candidate) => candidate.id === record.id) && !linked.has(record.id)
          ? {
            ...record,
            status: "uncertain-llm",
            verificationAttempts: attempt,
            verificationRationale: "automatic row recovery found no decision for this sense"
          }
          : record);
      }
    } else {
      current = current.map((record) => batch.some((candidate) => candidate.id === record.id)
        ? {
          ...record,
          status: "uncertain-llm",
          verificationAttempts: attempt,
          verificationRationale: `automatic model-response repair exhausted: ${response.reason}`
        }
        : record);
    }
    const outcome = response.valid ? (recovered ? "partial" : "applied") : "uncertain";
    current = current.map((record) => batch.some((candidate) => candidate.id === record.id)
      ? { ...record, queue: { ...record.queue, ...queueState, status: "complete", outcome } }
      : record);
    reconciledQueues.push({
      ...queueState,
      status: "complete",
      outcome,
      verificationAttempts: attempt,
      ...(response.valid ? {} : { reason: response.reason })
    });
  }
  return { records: current, queues: reconciledQueues };
}

function renderTargetName(value) {
  const target = normalized(value);
  if (!target || !/^[a-z0-9][a-z0-9_-]*(?: [a-z0-9][a-z0-9_-]*)*$/iu.test(target)) {
    throw invalid("WordNet bridge target cannot be rendered as a Pyash name", { target: value });
  }
  return target;
}

export function renderEnglishWordNetSenseLinksPya({
  records = [],
  source = "Open English WordNet",
  sourceHash = "",
  name = "translation_english_wordnet_bridges"
} = {}) {
  const accepted = records
    .filter((record) => ACCEPTED_STATUSES.has(record?.status) && record?.link?.target && sequence(record.link.pyashSequence).length > 0)
    .sort((left, right) => left.source.localeCompare(right.source));
  const seen = new Set();
  const lines = [
    `su name ${name} be map def`,
    `su text "format" ob text ${JSON.stringify("english-wordnet-bridge-v1")} ya`,
    `su text "source" ob text ${JSON.stringify(source)} ya`,
    `su text "source-hash" ob text ${JSON.stringify(sourceHash)} ya`,
    `su text "mode" ob text ${JSON.stringify("sense-level semantic bridge")} ya`
  ];
  for (const record of accepted) {
    if (seen.has(record.source)) continue;
    seen.add(record.source);
    const target = renderTargetName(record.link.target);
    const certainty = ["accepted-edge", "accepted-deterministic"].includes(record.status)
      ? "deterministic"
      : "contextual";
    const evidence = record.link.evidence || record.evidence || `WordNet ${record.source} accepted anchor ${target}`;
    lines.push(`su text ${JSON.stringify(record.source)} ob name ${target} as text ${JSON.stringify(record.pos)} with text ${JSON.stringify(certainty)} via text ${JSON.stringify(evidence)} ya`);
  }
  lines.push("prah");
  return `${lines.join("\n")}\n`;
}

export function parseEnglishWordNetLinkerConfig(source) {
  if (typeof source !== "string") throw invalid("WordNet linker configuration must be text");
  const sentences = buildProgram(source).sentences;
  const header = sentences.find((sentence) => (
    sentence?.mood === "def"
      && sentence?.be === "map"
      && sentence?.su?.name === ENGLISH_WORDNET_LINKER_NAME
  ));
  if (!header) throw invalid("WordNet linker configuration has no canonical map header");
  const metadata = {};
  for (const sentence of sentences) {
    if (sentence?.mood !== "ya" || typeof sentence.su?.text !== "string") continue;
    if (typeof sentence.ob?.text === "string") metadata[sentence.su.text] = sentence.ob.text;
    if (Number.isInteger(sentence.ob?.num)) metadata[sentence.su.text] = sentence.ob.num;
  }
  if (metadata.format !== ENGLISH_WORDNET_LINKER_FORMAT) {
    throw invalid("WordNet linker configuration has an unsupported format", { format: metadata.format });
  }
  if (metadata["selection-format"] && metadata["selection-format"] !== ENGLISH_WORDNET_SELECTION_FORMAT) {
    throw invalid("WordNet linker configuration has an unsupported selection format", {
      format: metadata["selection-format"]
    });
  }
  return {
    format: metadata.format,
    queueIntent: metadata["queue-intent"] || ENGLISH_WORDNET_LINKER_QUEUE_INTENT,
    queueLane: metadata["queue-lane"] || ENGLISH_WORDNET_LINKER_QUEUE_LANE,
    model: metadata.model || DEFAULT_TRANSLATION_MODEL,
    maxBatch: Math.max(1, Math.trunc(Number(metadata["max-batch"]) || ENGLISH_WORDNET_LINKER_DEFAULT_BATCH_SIZE)),
    maxDutySenses: Math.max(1, Math.trunc(Number(metadata["max-duty-senses"]) || ENGLISH_WORDNET_LINKER_DEFAULT_DUTY_SIZE)),
    promptMaxChars: Math.max(1000, Math.trunc(Number(metadata["prompt-max-chars"]) || ENGLISH_WORDNET_LINKER_PROMPT_MAX_CHARS)),
    promptMaxTokens: Math.max(100, Math.trunc(Number(metadata["prompt-max-tokens"]) || ENGLISH_WORDNET_LINKER_PROMPT_MAX_TOKENS)),
    maxOutputTokens: Math.max(100, Math.trunc(Number(metadata["max-output-tokens"]) || ENGLISH_WORDNET_LINKER_DEFAULT_OUTPUT_TOKENS)),
    selectionFormat: metadata["selection-format"] || ENGLISH_WORDNET_SELECTION_FORMAT,
    selectionMaxOutputTokens: Math.max(100, Math.trunc(Number(metadata["selection-max-output-tokens"]) || ENGLISH_WORDNET_SELECTION_DEFAULT_OUTPUT_TOKENS)),
    edgeMaxDegree: Math.max(0, Math.trunc(Number(metadata["edge-max-degree"]) || ENGLISH_WORDNET_LINKER_EDGE_MAX_DEGREE))
  };
}

export async function loadEnglishWordNetLinkerConfig({
  configUrl = ENGLISH_WORDNET_LINKER_CONFIG_URL,
  modelCardsUrl = TRANSLATION_MODEL_CARDS_URL
} = {}) {
  const config = parseEnglishWordNetLinkerConfig(await readFile(configUrl, "utf8"));
  const card = await loadTranslationModelCard({ model: config.model, url: modelCardsUrl });
  return {
    ...config,
    promptMaxTokens: card.safeInputTokens,
    maxOutputTokens: Math.min(config.maxOutputTokens, card.safeOutputTokens),
    selectionMaxOutputTokens: Math.min(config.selectionMaxOutputTokens, card.safeOutputTokens),
    modelCard: card
  };
}

export function createQueuedMindEnglishWordNetSenseLinkSubmitter(options = {}) {
  return createQueuedMindTranslationVocabularySubmitter({
    maxOutputTokens: ENGLISH_WORDNET_LINKER_DEFAULT_OUTPUT_TOKENS,
    ...options,
    responseFormat: ENGLISH_WORDNET_LINKER_RESPONSE_FORMAT
  });
}

export async function createDefaultQueuedMindEnglishWordNetSenseLinkSubmitter(options = {}) {
  const [{ interpret }, { parse }] = await Promise.all([
    import("../../../bridge/index.mjs"),
    import("../../../understand/index.mjs")
  ]);
  return createQueuedMindEnglishWordNetSenseLinkSubmitter({ interpret, parse, ...options });
}
