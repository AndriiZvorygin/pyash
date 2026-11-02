import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildProgram } from "../../program.mjs";
import { getRefinery, runRefinery } from "../../bridge/refinery.mjs";
import { doRemember, forget, remember } from "../../remember/index.mjs";
import { interpret } from "../../bridge/index.mjs";
import { parse } from "../../understand/index.mjs";
import { resolveConfigText } from "../../configure/env.mjs";
import { builtInSignatures } from "../../verbs/index.mjs";
import { clearSignatureHandlers, registerSignatureHandler } from "../../bridge/signature.mjs";
import { createGpuHousekeeperAdapter } from "../../runtime/gpu/housekeeper_adapter.mjs";
import {
  ENGLISH_WORDNET_SENSE_COMPOUNDS_CONFIG_URL,
  ENGLISH_WORDNET_SENSE_COMPOUNDS_NAME,
  ENGLISH_WORDNET_SENSE_COMPOUNDS_PROMPT_REVISION,
  ENGLISH_WORDNET_SENSE_COMPOUNDS_PARALLELISM,
  ENGLISH_WORDNET_SENSE_COMPOUNDS_MAX_OUTPUT_TOKENS,
  ENGLISH_WORDNET_SENSE_TRANSLATION_CACHE_NAME,
  buildKwonLinkedAtomicChoices,
  buildSenseCompoundWorklist,
  buildSenseDerivedCompoundCandidates,
  createQueuedMindWordNetSenseTranslationTransport,
  parseWordNetSenseTranslationCache,
  renderWordNetSenseTranslationCache,
  translateWordNetSenseWave
} from "./english_wordnet_sense_compounds.mjs";
import {
  buildEnglishWordNetBridgeIndex,
  loadEnglishWordNetBridges
} from "./english_wordnet_bridges.mjs";
import { loadPyacWordLayerIndex } from "./pyac_complexity.mjs";
import { DEFAULT_ATOM_WORD_LAYER_DIRECTORY } from "./atom_word_generation.mjs";
import { loadEnglishLemmaCatalog } from "./english_lemmas.mjs";
import {
  createDefaultQueuedMindCompoundVerifier,
  verifyCompoundCoverage
} from "./compound_verification.mjs";
import {
  ENGLISH_WORDNET_COMPOUND_DECISIONS_URL,
  loadEnglishWordNetCompoundDecisions,
  renderEnglishWordNetCompoundDecisions
} from "./english_wordnet_compound_decisions.mjs";
import { runVocabSuggest } from "../../../command/vocab_suggest.mjs";
import { loadDefaultConfig } from "../../../command/run_pya_helpers.mjs";
import { prepareWordNetFrequencyAllocation } from "../../../command/wordnet_frequency_allocate.mjs";
import {
  acceptedDecision,
  promoteAcceptedCompounds,
  wordNetCompoundDecisionRecord
} from "../../../command/wordnet_frequency_compound_sweep.mjs";

export const WORDNET_SENSE_COMPOUND_REFINERY_NAME = "translation wordnet sense compounds";
export const WORDNET_SENSE_COMPOUND_REFINERY_URL = ENGLISH_WORDNET_SENSE_COMPOUNDS_CONFIG_URL;
export const WORDNET_SENSE_COMPOUND_CACHE_NAME = ENGLISH_WORDNET_SENSE_TRANSLATION_CACHE_NAME;

export function wordNetSenseCompoundRunId({ sourceHash, promptRevision = ENGLISH_WORDNET_SENSE_COMPOUNDS_PROMPT_REVISION } = {}) {
  return `wordnet-sense-compounds-${hash(`${text(sourceHash)}\u0000${text(promptRevision)}`).slice(0, 24)}`;
}

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const ARTIFACT_ROOT = join(REPOSITORY_ROOT, "artifacts");
const CONFIG_MAP_NAME = "translation_wordnet_sense_compound_config";
const PROGRESS_NAME = "translation_wordnet_sense_compound_progress";
const WORKLIST_NAME = "translation_wordnet_sense_compound_worklist";
const COMPONENT_MAP_NAME = "translation_wordnet_sense_compound_component_mappings";
const CANDIDATE_NAME = "translation_wordnet_sense_compound_candidates";
const DECISION_BATCH_NAME = "translation_wordnet_sense_compound_decisions";
const READY_PROGRESS = new Set(["accepted", "rejected", "uncertain", "no-compound-candidate"]);
let definitionPromise = null;

function invalid(message, details = {}) {
  const error = new Error(message);
  error.code = "invalid-wordnet-sense-compound-refinery";
  error.details = details;
  return error;
}

function text(value) {
  return typeof value === "string" ? value.normalize("NFC").trim() : "";
}

function hash(value) {
  return createHash("sha256").update(String(value ?? "")).digest("hex");
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function mapFact(name, map, filename = "") {
  return {
    mood: "ya",
    su: { name },
    be: "map",
    ob: {
      map,
      ...(filename ? { filename } : {})
    }
  };
}

function outputHandle(sentence) {
  const name = text(sentence?.to?.name);
  if (!name) throw invalid("sense compound stage requires a named map output", { sentence });
  return name;
}

function mapValue(name) {
  return remember(name)?.ob?.map ?? {};
}

function renderRowsPya(name, format, records = [], metadata = {}) {
  const lines = [`su name ${name} be map def`, `su text "format" ob text ${JSON.stringify(format)} ya`];
  for (const [key, value] of Object.entries(metadata).sort(([left], [right]) => left.localeCompare(right))) {
    lines.push(`su text ${JSON.stringify(key)} ob text ${JSON.stringify(String(value))} ya`);
  }
  for (const record of records) {
    const id = text(record?.id ?? record?.senseId ?? record?.candidateId);
    if (!id) throw invalid("sense compound artifact row has no stable identity", { name });
    lines.push(`su text ${JSON.stringify(id)} ob text ${JSON.stringify(JSON.stringify(record))} ya`);
  }
  lines.push("prah", "");
  return lines.join("\n");
}

function parseRowsPya(source, expectedName) {
  const sentences = buildProgram(source).sentences;
  const header = sentences.find((sentence) => sentence?.mood === "def"
    && sentence?.be === "map"
    && sentence?.su?.name === expectedName);
  if (!header) throw invalid("sense compound artifact has no expected Pyash map", { expectedName });
  const records = [];
  const seen = new Set();
  for (const [index, sentence] of sentences.entries()) {
    if (sentence?.mood !== "ya" || typeof sentence.su?.text !== "string") continue;
    if (sentence.su.text === "format" || sentence.su.text.startsWith("meta:")) continue;
    if (typeof sentence.ob?.text !== "string") throw invalid("sense compound artifact row is missing JSON text", { index });
    let record;
    try {
      record = JSON.parse(sentence.ob.text);
    } catch (error) {
      throw invalid("sense compound artifact row is malformed", { index, cause: error.message });
    }
    if (record?.id !== sentence.su.text || seen.has(record.id)) {
      throw invalid("sense compound artifact row identity is mismatched or duplicated", { index, id: sentence.su.text });
    }
    seen.add(record.id);
    records.push(record);
  }
  return records;
}

async function atomicWrite(path, contents) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await rm(temporary, { force: true });
  await writeFile(temporary, contents, "utf8");
  await rename(temporary, path);
}

async function readIfPresent(path) {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return "";
    throw error;
  }
}

function parseConfig(source) {
  const sentences = buildProgram(source).sentences;
  const header = sentences.find((sentence) => sentence?.mood === "def"
    && sentence?.be === "map"
    && sentence?.su?.name === CONFIG_MAP_NAME);
  if (!header) throw invalid("sense compound refinery configuration has no map header");
  const values = {};
  for (const sentence of sentences) {
    if (sentence?.mood !== "ya" || typeof sentence.su?.text !== "string") continue;
    const key = sentence.su.text;
    if (typeof sentence.ob?.text === "string") values[key] = sentence.ob.text;
    else if (typeof sentence.ob?.num === "number") values[key] = sentence.ob.num;
  }
  const languages = text(values["comparison-languages"])
    .split(",").map((language) => language.trim().toLowerCase()).filter(Boolean);
  if (!languages.length) throw invalid("sense compound refinery requires comparison languages");
  return {
    model: text(values.model),
    languages,
    promptRevision: text(values["prompt-revision"]) || ENGLISH_WORDNET_SENSE_COMPOUNDS_PROMPT_REVISION,
    maxOutputTokens: Number(values["max-output-tokens"]) || ENGLISH_WORDNET_SENSE_COMPOUNDS_MAX_OUTPUT_TOKENS,
    parallelism: Number(values.parallelism) || ENGLISH_WORDNET_SENSE_COMPOUNDS_PARALLELISM,
    maximumSenses: Number(values["max-senses-per-launch"]) || 64,
    verificationBatchSize: Number(values["verification-batch-size"]) || 32
  };
}

function modelName(row) {
  return text(typeof row === "string" ? row : row?.name ?? row?.model);
}

function queueState(queue = {}) {
  const jobs = Array.isArray(queue.jobs) ? queue.jobs : Array.isArray(queue.items) ? queue.items : [];
  const queued = Number(queue.queueDepth ?? queue.depth ?? jobs.length);
  const running = Number(queue.runningCount ?? queue.activeCount ?? queue.runningJobs?.length ?? 0);
  return {
    queued: Number.isFinite(queued) ? Math.max(0, queued) : jobs.length,
    running: Number.isFinite(running) ? Math.max(0, running) : 0
  };
}

async function inspectHousekeeper({ model, dependencies }) {
  if (typeof dependencies.inspectHousekeeper === "function") {
    return dependencies.inspectHousekeeper({ model });
  }
  const url = text(process.env.PYA_GPU_HOUSEKEEPER_URL
    || resolveConfigText("gpu housekeeper url", { rememberFn: remember }));
  if (!url) throw invalid("sense compound refinery requires the configured GPU Housekeeper URL");
  const housekeeper = createGpuHousekeeperAdapter({ baseUrl: url });
  const [queue, advertisedModels] = await Promise.all([
    housekeeper.getQueue(),
    housekeeper.getOllamaModels()
  ]);
  const models = Array.isArray(advertisedModels) ? advertisedModels : advertisedModels?.models ?? [];
  if (!models.map(modelName).includes(model)) {
    throw invalid("configured GPU Housekeeper does not advertise the sense translation model", { model });
  }
  return {
    host: (() => {
      try { return new URL(url).host; } catch { return "configured-housekeeper"; }
    })(),
    model,
    ...queueState(queue)
  };
}

async function ensureRefinery({ interpretFn = interpret } = {}) {
  if (getRefinery(WORDNET_SENSE_COMPOUND_REFINERY_NAME)) return getRefinery(WORDNET_SENSE_COMPOUND_REFINERY_NAME);
  if (!definitionPromise) {
    definitionPromise = readFile(WORDNET_SENSE_COMPOUND_REFINERY_URL, "utf8")
      .then((source) => buildProgram(source).sentences)
      .then(async (sentences) => {
        for (const sentence of sentences) await interpretFn(sentence);
        const refinery = getRefinery(WORDNET_SENSE_COMPOUND_REFINERY_NAME);
        if (!refinery) throw invalid("sense compound refinery definition was not registered");
        return refinery;
      })
      .catch((error) => {
        definitionPromise = null;
        throw error;
      });
  }
  return definitionPromise;
}

async function loadInventory({ context, dependencies }) {
  const allocation = context.allocation ?? await (dependencies.prepareAllocation ?? prepareWordNetFrequencyAllocation)();
  const bridgeCatalog = await (dependencies.loadBridges ?? loadEnglishWordNetBridges)();
  const bridgeIndex = (dependencies.buildBridgeIndex ?? buildEnglishWordNetBridgeIndex)({
    entries: bridgeCatalog.entries,
    resolveTarget: allocation.resolveWord
  });
  const layerIndex = await (dependencies.loadLayerIndex ?? (() => loadPyacWordLayerIndex({
    directory: DEFAULT_ATOM_WORD_LAYER_DIRECTORY
  })) )();
  const lemmaCatalog = await (dependencies.loadLemmaCatalog ?? loadEnglishLemmaCatalog)();
  const deprecatedSurfaces = lemmaCatalog.entries
    .filter((entry) => entry.status === "deprecated-duplicate")
    .map((entry) => entry.surface);
  const deprecated = new Set(deprecatedSurfaces.map((word) => word.toLowerCase()));
  const linkedEntries = [...bridgeIndex.bySense.values()].filter((entry) => !deprecated.has(text(entry.target).toLowerCase()));
  const linkedSenseIds = linkedEntries.map((entry) => entry.source);
  const linkedAtomicSenses = linkedEntries.filter((entry) => entry.targetKind === "atom"
    && Array.isArray(entry.pyashSequence) && entry.pyashSequence.length === 1);
  const fullWorklist = buildSenseCompoundWorklist({
    residualSenses: allocation.allocation.residual,
    relations: allocation.wordnetIndex.relations,
    linkedSenseIds,
    linkedAtomicSenses
  });
  const progressPath = join(context.artifactDirectory, "progress.pya");
  const translationPath = join(context.artifactDirectory, "sense-translations.pya");
  const progressSource = await (dependencies.readFile ?? readIfPresent)(progressPath);
  const translationSource = await (dependencies.readFile ?? readIfPresent)(translationPath);
  const progressRecords = progressSource ? parseRowsPya(progressSource, PROGRESS_NAME) : [];
  const progressBySense = new Map(progressRecords.map((record) => [record.senseId, record]));
  const parsedTranslationState = translationSource
    ? parseWordNetSenseTranslationCache(translationSource)
    : { records: [], bySense: new Map() };
  const currentTranslations = parsedTranslationState.records.filter((record) => (
    record.wordNetHash === allocation.sourceHash
      && record.promptRevision === context.config.promptRevision
      && stableJson(record.languages ?? []) === stableJson(context.config.languages)
  ));
  const translationState = {
    records: currentTranslations,
    bySense: new Map(currentTranslations.map((record) => [record.senseId, record]))
  };
  const atomInventoryHash = hash(stableJson(linkedAtomicSenses.map((entry) => [
    entry.source, entry.target, entry.pyashSequence, entry.targetId
  ]).sort((left, right) => left[0].localeCompare(right[0]))));
  const pending = fullWorklist.filter((sense) => {
    const progress = progressBySense.get(sense.senseId);
    if (!progress || !READY_PROGRESS.has(progress.status) || progress.atomInventoryHash !== atomInventoryHash) return true;
    return false;
  }).slice(0, context.config.maximumSenses);
  const dataHash = hash(stableJson({
    sourceHash: allocation.sourceHash,
    coverageHash: allocation.coverageHash,
    atomInventoryHash,
    pending: pending.map((row) => row.senseId)
  }));
  const worklistPath = join(context.artifactDirectory, "worklist.pya");
  await atomicWrite(worklistPath, renderRowsPya(WORKLIST_NAME, "wordnet-sense-compound-worklist-v1", pending, {
    "source-hash": allocation.sourceHash,
    "atom-inventory-hash": atomInventoryHash,
    "worklist-hash": dataHash,
    "eligible-sense-count": fullWorklist.length,
    "remaining-sense-count": fullWorklist.filter((sense) => {
      const progress = progressBySense.get(sense.senseId);
      return !progress || !READY_PROGRESS.has(progress.status) || progress.atomInventoryHash !== atomInventoryHash;
    }).length
  }));
  context.allocation = allocation;
  context.bridgeIndex = bridgeIndex;
  context.linkedAtomicSenses = linkedAtomicSenses;
  context.deprecatedSurfaces = deprecatedSurfaces;
  context.layerIndex = layerIndex;
  context.progressRecords = progressRecords;
  context.translationState = translationState;
  context.fullWorklist = fullWorklist;
  context.atomInventoryHash = atomInventoryHash;
  context.worklist = pending;
  context.worklistPath = worklistPath;
  return {
    "worklist-path": worklistPath,
    "worklist-hash": dataHash,
    "source-hash": allocation.sourceHash,
    "atom-inventory-hash": atomInventoryHash,
    "eligible-sense-count": fullWorklist.length,
    "selected-sense-count": pending.length,
    "remaining-sense-count": fullWorklist.filter((sense) => {
      const progress = progressBySense.get(sense.senseId);
      return !progress || !READY_PROGRESS.has(progress.status) || progress.atomInventoryHash !== atomInventoryHash;
    }).length,
    "housekeeper-host": context.housekeeperState?.host ?? "",
    "housekeeper-queue-depth": context.housekeeperState?.queued ?? 0,
    "housekeeper-running-count": context.housekeeperState?.running ?? 0
  };
}

async function translateSelected({ context, worklist }) {
  const selected = context.worklist ?? parseRowsPya(await readFile(worklist["worklist-path"], "utf8"), WORKLIST_NAME);
  const cached = context.translationState?.records ?? [];
  const cachePath = join(context.artifactDirectory, "sense-translations.pya");
  const transport = context.dependencies.translationTransport
    ?? createQueuedMindWordNetSenseTranslationTransport({
      interpret: context.interpretFn,
      parse: context.parseFn,
      model: context.config.model,
      maxOutputTokens: context.config.maxOutputTokens
    });
  const response = await translateWordNetSenseWave({
    senses: selected,
    cachedRecords: cached,
    wordNetHash: context.allocation?.sourceHash ?? worklist["source-hash"],
    languages: context.config.languages,
    promptRevision: context.config.promptRevision,
    parallelism: context.config.parallelism,
    maxAttempts: 2,
    submit: transport.submit,
    awaitHandle: transport.await,
    onCache: async (records) => {
      await atomicWrite(cachePath, renderWordNetSenseTranslationCache(records, {
        "source-hash": worklist["source-hash"],
        "prompt-revision": context.config.promptRevision,
        model: context.config.model
      }));
    }
  });
  if (response.records.length === 0) {
    await atomicWrite(cachePath, renderWordNetSenseTranslationCache(cached, {
      "source-hash": worklist["source-hash"],
      "prompt-revision": context.config.promptRevision,
      model: context.config.model
    }));
  }
  context.translationState = { records: response.records, bySense: new Map(response.records.map((record) => [record.senseId, record])) };
  context.translationFailures = response.failures;
  const content = await readFile(cachePath, "utf8");
  return {
    "translation-cache-path": cachePath,
    "translation-cache-hash": hash(content),
    "translated-count": response.completedCount,
    "submitted-count": response.submittedCount,
    "failed-count": response.failures.length,
    "failure-sense-ids": response.failures.map((failure) => failure.senseId),
    "failure-details": response.failures,
    "partial-sense-ids": response.records.filter((record) => record.status !== "complete").map((record) => record.senseId)
  };
}

function collectComponentGlosses(translations) {
  return [...new Set(translations.flatMap((translation) => (translation.components ?? [])
    .map((component) => text(component.gloss).replace(/\s+/gu, " "))
    .filter(Boolean)))];
}

function normalizeGloss(value) {
  return text(value).toLowerCase().replace(/[_-]+/gu, " ").replace(/\s+/gu, " ");
}

async function composeCandidates({ context, worklist, translations }) {
  const selected = context.worklist ?? parseRowsPya(await readFile(worklist["worklist-path"], "utf8"), WORKLIST_NAME);
  const cachePath = translations["translation-cache-path"];
  const cacheRows = context.translationState?.records
    ?? parseWordNetSenseTranslationCache(await readFile(cachePath, "utf8")).records;
  const cacheBySense = new Map(cacheRows.map((record) => [record.senseId, record]));
  const completeSenses = selected.filter((sense) => cacheBySense.get(sense.senseId)?.status === "complete");
  const glosses = collectComponentGlosses(completeSenses.flatMap((sense) => cacheBySense.get(sense.senseId)?.translations ?? []));
  let suggestionRecords = [];
  if (glosses.length > 0) {
    const args = glosses.flatMap((gloss) => ["--text", gloss]);
    const suggestions = await (context.dependencies.suggestVocabulary ?? runVocabSuggest)(args, { report: () => {} });
    suggestionRecords = suggestions.suggestionRecords ?? [];
  }
  const byGloss = buildKwonLinkedAtomicChoices({
    suggestions: suggestionRecords,
    activeAtomEntries: context.linkedAtomicSenses,
    layerByWord: context.layerIndex.byWord,
    deprecatedSurfaces: context.deprecatedSurfaces
  });
  const candidates = completeSenses.flatMap((sense) => {
    const translations = cacheBySense.get(sense.senseId)?.translations ?? [];
    return buildSenseDerivedCompoundCandidates({
      sense,
      translations,
      kwonCandidatesByGloss: byGloss,
      relations: context.allocation.wordnetIndex.relations,
      maxKwonCandidates: 4,
      maxCandidates: 8
    });
  });
  const candidatesById = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const uniqueCandidates = [...candidatesById.values()].sort((left, right) => left.frequencyRank - right.frequencyRank
    || right.frequencyTagCount - left.frequencyTagCount
    || left.id.localeCompare(right.id));
  const componentMappings = glosses.map((gloss) => ({
    id: `component-gloss-${hash(normalizeGloss(gloss)).slice(0, 24)}`,
    gloss,
    atoms: (byGloss.get(normalizeGloss(gloss)) ?? []).map((choice) => ({
      word: choice.word,
      pyashSequence: choice.pyashSequence,
      componentLayer: choice.componentLayers[0],
      linkedSense: choice.linkedSense
    })),
    status: (byGloss.get(normalizeGloss(gloss)) ?? []).length > 0 ? "linked-atom-candidates" : "unresolved-component-gloss"
  }));
  const mappingsPath = join(context.artifactDirectory, "component-mappings.pya");
  const mappingsContents = renderRowsPya(COMPONENT_MAP_NAME, "wordnet-sense-compound-component-mappings-v1", componentMappings);
  await atomicWrite(mappingsPath, mappingsContents);
  const candidatesPath = join(context.artifactDirectory, "compound-candidates.pya");
  const candidateHash = hash(stableJson(uniqueCandidates));
  await atomicWrite(candidatesPath, renderRowsPya(CANDIDATE_NAME, "wordnet-sense-derived-compound-candidates-v1", uniqueCandidates, {
    "worklist-hash": worklist["worklist-hash"],
    "translation-cache-hash": translations["translation-cache-hash"],
    "candidate-hash": candidateHash
  }));
  context.candidates = uniqueCandidates;
  return {
    "candidate-path": candidatesPath,
    "component-mappings-path": mappingsPath,
    "component-mappings-hash": hash(mappingsContents),
    "candidate-hash": candidateHash,
    "source-sense-count": selected.length,
    "candidate-count": uniqueCandidates.length,
    "mapped-gloss-count": byGloss.size,
    "unmapped-glosses": glosses.filter((gloss) => (byGloss.get(normalizeGloss(gloss)) ?? []).length === 0)
  };
}

async function updateProgress(context, worklistRows, candidateRows, decisions) {
  const bySense = new Map(context.progressRecords.map((record) => [record.senseId, record]));
  const decisionsBySense = new Map();
  for (const candidate of candidateRows) {
    decisionsBySense.set(candidate.senseId, [...(decisionsBySense.get(candidate.senseId) ?? []),
      decisions.find((decision) => decision.candidateId === candidate.id) ?? null]);
  }
  const candidatesBySense = new Map();
  for (const candidate of candidateRows) candidatesBySense.set(candidate.senseId, [...(candidatesBySense.get(candidate.senseId) ?? []), candidate]);
  for (const sense of worklistRows) {
    const senseCandidates = candidatesBySense.get(sense.senseId) ?? [];
    const senseDecisions = (decisionsBySense.get(sense.senseId) ?? []).filter(Boolean);
    const senseTranslation = context.translationState?.bySense.get(sense.senseId);
    const completeTranslation = senseTranslation?.status === "complete";
    let status = "retry";
    if (!completeTranslation) {
      status = "retry";
    } else if (senseCandidates.length === 0) {
      status = senseTranslation.translations.some((translation) => translation.composition === "uncertain")
        ? "uncertain"
        : "no-compound-candidate";
    }
    else if (senseDecisions.length > 0) {
      if (senseDecisions.some((decision) => acceptedDecision(decision)
        && ["promoted-to-derived-index", "already-active"].includes(decision.promotionStatus))) status = "accepted";
      else if (senseDecisions.some((decision) => decision.status === "uncertain-llm")) status = "uncertain";
      else if (senseDecisions.some((decision) => ["rejected-llm", "rejected-deterministic"].includes(decision.status))) status = "rejected";
    }
    bySense.set(sense.senseId, {
      id: sense.senseId,
      senseId: sense.senseId,
      status,
      atomInventoryHash: context.atomInventoryHash,
      sourceHash: context.allocation.sourceHash,
      promptRevision: context.config.promptRevision,
      candidateIds: senseCandidates.map((candidate) => candidate.id),
    });
  }
  context.progressRecords = [...bySense.values()];
  const path = join(context.artifactDirectory, "progress.pya");
  await atomicWrite(path, renderRowsPya(PROGRESS_NAME, "wordnet-sense-compound-progress-v1", context.progressRecords));
  const remainingCount = (context.fullWorklist ?? []).filter((sense) => {
    const progress = bySense.get(sense.senseId);
    return !progress || !READY_PROGRESS.has(progress.status) || progress.atomInventoryHash !== context.atomInventoryHash;
  }).length;
  return { path, remainingCount };
}

async function verifyAndPromote({ context, candidates }) {
  const candidateRows = context.candidates ?? parseRowsPya(await readFile(candidates["candidate-path"], "utf8"), CANDIDATE_NAME);
  const decisionRevision = context.allocation.allocationConfig["compound-verification-revision"];
  if (!decisionRevision) throw invalid("WordNet compound verifier revision is not configured");
  const decisionsPath = context.dependencies.decisionsPath
    ?? fileURLToPath(ENGLISH_WORDNET_COMPOUND_DECISIONS_URL);
  const decisionState = context.dependencies.loadDecisions
    ? await context.dependencies.loadDecisions()
    : await loadEnglishWordNetCompoundDecisions();
  const decisionsById = new Map(decisionState.rows.map((record) => [record.candidateId, record]));
  const pending = candidateRows.filter((candidate) => decisionsById.get(candidate.id)?.decisionRevision !== decisionRevision);
  const usedTargetIds = [
    ...context.allocation.preservedTargetIds,
    ...context.allocation.allocation.assignments.map((row) => row.targetId)
  ];
  const verifier = context.dependencies.verifyCandidates
    ?? (async (records, onRecord) => {
      const invoke = context.dependencies.compoundVerifier
        ?? await createDefaultQueuedMindCompoundVerifier({ model: context.config.model });
      return verifyCompoundCoverage(records, { invoke, verifierName: "mind", maxRepairAttempts: 1, onRecord });
    });
  const batchSize = Math.max(1, context.config.verificationBatchSize);
  for (let offset = 0; offset < pending.length; offset += batchSize) {
    const batch = pending.slice(offset, offset + batchSize);
    await verifier(batch, async ({ record }) => {
      const decision = wordNetCompoundDecisionRecord({ ...record, decisionRevision });
      decisionsById.set(decision.candidateId, decision);
      await atomicWrite(decisionsPath, renderEnglishWordNetCompoundDecisions([...decisionsById.values()]));
    });
    const batchRecords = batch.map((candidate) => decisionsById.get(candidate.id)).filter(Boolean);
    const promoted = await (context.dependencies.promoteAccepted ?? promoteAcceptedCompounds)(batchRecords, { usedTargetIds, decisionRevision });
    for (const decision of promoted.decisions) decisionsById.set(decision.candidateId, decision);
    await atomicWrite(decisionsPath, renderEnglishWordNetCompoundDecisions([...decisionsById.values()]));
    const batchPath = join(context.artifactDirectory, `verification-${String(Math.floor(offset / batchSize) + 1).padStart(4, "0")}.pya`);
    await atomicWrite(batchPath, renderRowsPya(DECISION_BATCH_NAME, "wordnet-sense-compound-verification-batch-v1", promoted.decisions.map((record) => ({
      ...record,
      id: record.candidateId
    })), {
      "decision-revision": decisionRevision,
      "promoted-count": promoted.promotions.length,
      "conflict-count": promoted.conflicts.length
    }));
  }
  const priorAccepted = candidateRows
    .map((candidate) => decisionsById.get(candidate.id))
    .filter((record) => record && acceptedDecision(record));
  if (priorAccepted.length > 0) {
    const restored = await (context.dependencies.promoteAccepted ?? promoteAcceptedCompounds)(priorAccepted, { usedTargetIds, decisionRevision });
    for (const decision of restored.decisions) decisionsById.set(decision.candidateId, decision);
    await atomicWrite(decisionsPath, renderEnglishWordNetCompoundDecisions([...decisionsById.values()]));
  }
  const completed = candidateRows.map((candidate) => decisionsById.get(candidate.id)).filter(Boolean);
  const progress = await updateProgress(context, context.worklist ?? [], candidateRows, completed);
  const artifactPath = join(context.artifactDirectory, "sense-compound-decisions.pya");
  const content = renderRowsPya(DECISION_BATCH_NAME, "wordnet-sense-compound-decision-result-v1", completed.map((record) => ({
    ...record,
    id: record.candidateId
  })), {
    "decision-revision": decisionRevision,
    "progress-path": progress.path,
    "remaining-sense-count": progress.remainingCount
  });
  await atomicWrite(artifactPath, content);
  return {
    "decision-path": artifactPath,
    "decision-hash": hash(content),
    "decision-count": completed.length,
    "accepted-count": completed.filter((record) => acceptedDecision(record)
      && ["promoted-to-derived-index", "already-active"].includes(record.promotionStatus)).length,
    "uncertain-count": completed.filter((record) => record.status === "uncertain-llm").length,
    "rejected-count": completed.filter((record) => ["rejected-llm", "rejected-deterministic"].includes(record.status)).length,
    "progress-path": progress.path,
    "remaining-sense-count": progress.remainingCount
  };
}

async function runStage(sentence, context) {
  const stage = text(sentence?.su?.name);
  const output = outputHandle(sentence);
  let result;
  let artifactPath = "";
  if (stage === "select unresolved senses") {
    result = await loadInventory({ context, dependencies: context.dependencies });
    artifactPath = context.worklistPath;
  } else if (stage === "translate missing sense definitions") {
    result = await translateSelected({ context, worklist: mapValue("sense worklist") });
    artifactPath = result["translation-cache-path"];
  } else if (stage === "compose sense compounds") {
    result = await composeCandidates({
      context,
      worklist: mapValue("sense worklist"),
      translations: mapValue("sense translations")
    });
    artifactPath = result["candidate-path"];
  } else if (stage === "verify sense compounds") {
    result = await verifyAndPromote({ context, candidates: mapValue("sense compound candidates") });
    artifactPath = result["decision-path"];
  } else {
    throw invalid("unknown WordNet sense compound refinery stage", { stage });
  }
  const fact = mapFact(output, result, artifactPath);
  doRemember(fact);
  return fact;
}

function configureMind(model) {
  const backend = text(resolveConfigText("mind backend", { rememberFn: remember }) || "ollama command mind");
  const configuredModel = text(resolveConfigText("mind model", { rememberFn: remember }) || model);
  const host = text((/ollama/iu.test(backend)
    ? resolveConfigText("ollama host", { rememberFn: remember })
    : resolveConfigText("ai host", { rememberFn: remember }) || resolveConfigText("ollama host", { rememberFn: remember })) || "");
  const housekeeper = text(resolveConfigText("gpu housekeeper url", { rememberFn: remember }) || "");
  const selectedHousekeeper = text(process.env.PYA_GPU_HOUSEKEEPER_URL || housekeeper);
  if (!configuredModel || !host || !selectedHousekeeper) {
    throw invalid("WordNet sense compound refinery requires configured mind model, host, and GPU Housekeeper URL");
  }
  process.env.PYA_GPU_HOUSEKEEPER_URL = selectedHousekeeper;
  process.env.PYA_GPU_MANAGER_REQUIRED = "true";
  doRemember({
    mood: "ya",
    su: { name: "mind" },
    be: "mind",
    as: { name: model || configuredModel },
    fromstate: { text: backend },
    from: { text: host }
  });
}

export async function runWordNetSenseCompoundRefinery({
  artifactRoot = ARTIFACT_ROOT,
  dependencies = {},
  configuration = {},
  checkpointEnabled = true,
  runId = "",
  interpretFn = interpret,
  parseFn = parse,
  onEvoke,
  onCheckpoint,
  onStage,
  initialize = true
} = {}) {
  if (process.env.PYA_MIND_RESPONSE) throw invalid("sense compound refinery requires PYA_MIND_RESPONSE to be unset");
  const source = await readFile(WORDNET_SENSE_COMPOUND_REFINERY_URL, "utf8");
  const config = parseConfig(source);
  if (configuration.maximumSenses !== undefined) {
    const maximumSenses = Number(configuration.maximumSenses);
    if (!Number.isSafeInteger(maximumSenses) || maximumSenses < 1) {
      throw invalid("sense compound refinery maximumSenses override must be a positive integer");
    }
    config.maximumSenses = maximumSenses;
  }
  const previousHousekeeper = process.env.PYA_GPU_HOUSEKEEPER_URL;
  const previousManagerRequired = process.env.PYA_GPU_MANAGER_REQUIRED;
  try {
    if (initialize) {
      forget();
      clearSignatureHandlers();
      for (const signature of builtInSignatures) registerSignatureHandler(signature);
      if (typeof dependencies.initializeRuntime === "function") await dependencies.initializeRuntime();
      else await loadDefaultConfig({ cwd: REPOSITORY_ROOT, interpretFn, entryPath: REPOSITORY_ROOT });
      configureMind(config.model);
    }
    return await runInitializedRefinery({
      artifactRoot,
      dependencies,
      checkpointEnabled,
      runId,
      interpretFn,
      parseFn,
      onEvoke,
      onCheckpoint,
      onStage,
      config,
      initialize
    });
  } finally {
    if (initialize) forget();
    if (previousHousekeeper === undefined) delete process.env.PYA_GPU_HOUSEKEEPER_URL;
    else process.env.PYA_GPU_HOUSEKEEPER_URL = previousHousekeeper;
    if (previousManagerRequired === undefined) delete process.env.PYA_GPU_MANAGER_REQUIRED;
    else process.env.PYA_GPU_MANAGER_REQUIRED = previousManagerRequired;
  }
}

async function runInitializedRefinery({
  artifactRoot,
  dependencies,
  checkpointEnabled,
  runId,
  interpretFn,
  parseFn,
  onEvoke,
  onCheckpoint,
  onStage,
  config,
  initialize
}) {
  const allocation = await (dependencies.prepareAllocation ?? prepareWordNetFrequencyAllocation)();
  const stableRunId = runId || wordNetSenseCompoundRunId({ sourceHash: allocation.sourceHash, promptRevision: config.promptRevision });
  const artifactDirectory = join(resolve(artifactRoot), stableRunId);
  await mkdir(artifactDirectory, { recursive: true });
  const context = {
    config,
    dependencies,
    allocation,
    artifactDirectory,
    interpretFn,
    parseFn,
    translationState: null,
    progressRecords: [],
    worklist: []
  };
  if (initialize) context.housekeeperState = await inspectHousekeeper({ model: config.model, dependencies });
  await ensureRefinery({ interpretFn });
  // Map checkpoint serialization does not fingerprint all nested map values.
  // Rebuild these cheap stages from the durable sense cache and progress ledger.
  const output = await runRefinery({
    name: WORDNET_SENSE_COMPOUND_REFINERY_NAME,
    interpret: (sentence) => runStage(sentence, context),
    runId: stableRunId,
    checkpointIndex: new Map(),
    checkpointEnabled,
    onEvoke,
    onCheckpoint,
    onResult: onStage
  });
  if (output?.mood === "ya" && output?.be === "error") throw new Error(output.ob?.text || "WordNet sense compound refinery failed");
  const result = mapValue("sense compound decisions");
  if (!result["decision-path"]) throw invalid("sense compound refinery completed without its decision artifact");
  return {
    runId: stableRunId,
    artifactDirectory,
    result,
    selectedSenseCount: context.worklist.length,
    remainingSenseCount: mapValue("sense compound decisions")["remaining-sense-count"]
      ?? mapValue("sense worklist")["remaining-sense-count"]
      ?? 0,
    candidateCount: mapValue("sense compound candidates")["candidate-count"] ?? 0
  };
}
