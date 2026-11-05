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
  ENGLISH_WORDNET_SENSE_COMPOUND_CANDIDATE_REVISION,
  ENGLISH_WORDNET_SENSE_COMPOUNDS_PARALLELISM,
  ENGLISH_WORDNET_SENSE_COMPOUNDS_MAX_OUTPUT_TOKENS,
  ENGLISH_WORDNET_SENSE_COMPOUND_CHOICE_MAX_OUTPUT_TOKENS,
  ENGLISH_WORDNET_SENSE_COMPOUND_CHOICE_PROMPT_REVISION,
  ENGLISH_WORDNET_SENSE_TRANSLATION_CACHE_NAME,
  buildKwonLinkedAtomicChoices,
  buildSenseCompoundChoiceInput,
  buildSenseDerivedCompoundCandidateFromChoice,
  componentGlossAlternatives,
  buildSenseCompoundWorklist,
  createQueuedMindSenseCompoundChoiceTransport,
  createQueuedMindWordNetSenseTranslationTransport,
  parseSenseCompoundChoiceResponse,
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
const COMPOSITION_NAME = "translation_wordnet_sense_compound_compositions";
const CANDIDATE_NAME = "translation_wordnet_sense_compound_candidates";
const DECISION_BATCH_NAME = "translation_wordnet_sense_compound_decisions";
const TRANSLATION_FAILURES_NAME = "translation_wordnet_sense_translation_failures";
const READY_PROGRESS = new Set(["accepted", "rejected", "uncertain", "no-compound-candidate"]);
let definitionPromise = null;

function invalid(message, details = {}) {
  const error = new Error(message);
  error.code = "invalid-wordnet-sense-compound-refinery";
  error.details = details;
  return error;
}

export function resolveWordNetSenseCompoundMaximumSenses(configuredMaximum, requestedMaximum) {
  const configured = Number(configuredMaximum);
  if (!Number.isSafeInteger(configured) || configured < 1) {
    throw invalid("sense compound refinery configured maximumSenses must be a positive integer");
  }
  if (requestedMaximum === undefined) return configured;
  const requested = Number(requestedMaximum);
  if (!Number.isSafeInteger(requested) || requested < 1) {
    throw invalid("sense compound refinery maximumSenses override must be a positive integer");
  }
  return Math.min(configured, requested);
}

export function resolveWordNetSenseCompoundSenseIds(requestedSenseIds) {
  if (requestedSenseIds === undefined) return null;
  if (!Array.isArray(requestedSenseIds) || requestedSenseIds.length === 0) {
    throw invalid("sense compound senseIds override must be a nonempty array");
  }
  const senseIds = [...new Set(requestedSenseIds.map((senseId) => text(senseId)))];
  if (senseIds.some((senseId) => !/^[nvars]:\d{8}-[nvars]$/u.test(senseId))) {
    throw invalid("sense compound senseIds override contains an invalid WordNet sense id", { senseIds });
  }
  return senseIds;
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
    lines.push(`su text ${JSON.stringify(`meta:${key}`)} ob text ${JSON.stringify(String(value))} ya`);
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
  const legacyMetadataKeys = new Set([
    "source-hash",
    "translation-cache-hash",
    "atom-inventory-hash",
    "candidate-revision",
    "prompt-revision",
    "worklist-order",
    "worklist-hash",
    "eligible-sense-count",
    "remaining-sense-count",
    "model",
    "failure-count",
    "decision-revision",
    "progress-path",
    "selected-sense-count",
    "candidate-sense-count",
    "accepted-sense-count",
    "uncertain-sense-count",
    "rejected-sense-count",
    "no-candidate-sense-count",
    "uncertain-no-candidate-sense-count",
    "pending-sense-count",
    "accepted-candidate-sense-percent",
    "component-choice-prompt-revision",
    "component-choice-decision-count",
    "accepted-component-choice-count",
    "uncertain-component-choice-count",
    "rejected-component-choice-count",
    "pending-component-choice-count",
    "accepted-component-choice-percent",
    "candidate-hash"
  ]);
  for (const [index, sentence] of sentences.entries()) {
    if (sentence?.mood !== "ya" || typeof sentence.su?.text !== "string") continue;
    if (sentence.su.text === "format" || sentence.su.text.startsWith("meta:")
      || legacyMetadataKeys.has(sentence.su.text)) continue;
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
  if (values.format !== "translation-wordnet-sense-compound-refinery-v2") {
    throw invalid("sense compound refinery configuration has an unsupported format", { format: values.format });
  }
  const languages = text(values["comparison-languages"])
    .split(",").map((language) => language.trim().toLowerCase()).filter(Boolean);
  if (!languages.length) throw invalid("sense compound refinery requires comparison languages");
  const candidateRevision = text(values["candidate-revision"]) || ENGLISH_WORDNET_SENSE_COMPOUND_CANDIDATE_REVISION;
  const choicePromptRevision = text(values["component-choice-prompt-revision"]) || ENGLISH_WORDNET_SENSE_COMPOUND_CHOICE_PROMPT_REVISION;
  const choiceMaxAttempts = Number(values["component-choice-max-attempts"] ?? 2);
  const headRelationPolicy = text(values["head-relation-policy"]).toLowerCase() || "advisory";
  const minimumTagCount = Number(values["minimum-tag-count"] ?? 0);
  if (!Number.isSafeInteger(minimumTagCount) || minimumTagCount < 0) {
    throw invalid("sense compound refinery minimum-tag-count must be a nonnegative integer");
  }
  if (!Number.isSafeInteger(choiceMaxAttempts) || choiceMaxAttempts < 1) {
    throw invalid("sense compound refinery component-choice-max-attempts must be a positive integer");
  }
  const worklistOrder = text(values["worklist-order"]) || "english30k-rank";
  const promptRevision = text(values["prompt-revision"]) || ENGLISH_WORDNET_SENSE_COMPOUNDS_PROMPT_REVISION;
  if (promptRevision !== ENGLISH_WORDNET_SENSE_COMPOUNDS_PROMPT_REVISION
    || candidateRevision !== ENGLISH_WORDNET_SENSE_COMPOUND_CANDIDATE_REVISION
    || choicePromptRevision !== ENGLISH_WORDNET_SENSE_COMPOUND_CHOICE_PROMPT_REVISION
    || headRelationPolicy !== "advisory") {
    throw invalid("sense compound refinery requires the current translation and choice prompt revisions, candidate revision, and advisory head policy");
  }
  if (!["english30k-rank", "tag-count-descending"].includes(worklistOrder)) {
    throw invalid("sense compound refinery worklist order is unsupported", { worklistOrder });
  }
  return {
    model: text(values.model),
    languages,
    promptRevision,
    choicePromptRevision,
    choiceMaxAttempts,
    maxOutputTokens: Number(values["max-output-tokens"]) || ENGLISH_WORDNET_SENSE_COMPOUNDS_MAX_OUTPUT_TOKENS,
    choiceMaxOutputTokens: Number(values["component-choice-max-output-tokens"]) || ENGLISH_WORDNET_SENSE_COMPOUND_CHOICE_MAX_OUTPUT_TOKENS,
    parallelism: Number(values.parallelism) || ENGLISH_WORDNET_SENSE_COMPOUNDS_PARALLELISM,
    maximumSenses: Number(values["max-senses-per-launch"]) || 64,
    minimumTagCount,
    worklistOrder,
    candidateRevision,
    headRelationPolicy
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

function currentProgress(progress, atomInventoryHash, candidateRevision, promptRevision, choicePromptRevision) {
  return Boolean(progress
    && READY_PROGRESS.has(progress.status)
    && progress.atomInventoryHash === atomInventoryHash
    && progress.candidateRevision === candidateRevision
    && progress.promptRevision === promptRevision
    && progress.choicePromptRevision === choicePromptRevision);
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
  const registered = getRefinery(WORDNET_SENSE_COMPOUND_REFINERY_NAME);
  if (registered) return registered;
  if (definitionPromise) {
    const previousDefinition = definitionPromise;
    await previousDefinition;
    const restored = getRefinery(WORDNET_SENSE_COMPOUND_REFINERY_NAME);
    if (restored) return restored;
    if (definitionPromise === previousDefinition) definitionPromise = null;
  }
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
  const resolveTargetCoverage = (sense) => {
    const lemma = sense.lemmas[0];
    const coverage = allocation.resolveWord(lemma, {
      partOfSpeech: sense.pos,
      senseId: sense.senseId
    });
    if (!coverage || !["atomic", "compound", "grammar", "alias", "dictionary-alias"].includes(coverage.coverageType)) return null;
    if (coverage.coverageType === "grammar" || coverage.coverageType === "compound") return coverage;
    if (["alias", "dictionary-alias"].includes(coverage.coverageType)) {
      if (coverage.canonicalCoverageType === "grammar") return { ...coverage, coverageType: "grammar" };
      if (coverage.canonicalCoverageType === "compound") return { ...coverage, coverageType: "compound" };
      if (coverage.canonicalCoverageType !== "atomic") return null;
    }
    const pyashSequence = Array.isArray(coverage.pyashSequence)
      ? coverage.pyashSequence.map(text).filter(Boolean)
      : [];
    return {
      ...coverage,
      coverageType: "atomic",
      word: coverage.canonicalEnglish || lemma,
      pyashSequence,
      componentLayer: pyashSequence.length === 1 ? layerIndex.byWord.get(pyashSequence[0]) : undefined
    };
  };
  const completeWorklist = buildSenseCompoundWorklist({
    residualSenses: allocation.allocation.residual,
    linkedSenseIds,
    resolveTargetCoverage,
    minimumTagCount: context.config.minimumTagCount,
    order: context.config.worklistOrder
  });
  const requestedSenseIds = context.config.senseIds;
  const requestedSenseSet = requestedSenseIds ? new Set(requestedSenseIds) : null;
  const fullWorklist = requestedSenseSet
    ? completeWorklist.filter((sense) => requestedSenseSet.has(sense.senseId))
    : completeWorklist;
  if (requestedSenseSet) {
    const found = new Set(fullWorklist.map((sense) => sense.senseId));
    const missing = requestedSenseIds.filter((senseId) => !found.has(senseId));
    if (missing.length > 0) {
      throw invalid("requested WordNet senses are not eligible for compound composition", { missing });
    }
  }
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
  const atomInventoryHash = hash(stableJson({
    linkedAtomicSenses: linkedAtomicSenses.map((entry) => [
      entry.source, entry.target, entry.pyashSequence, entry.targetId
    ]).sort((left, right) => left[0].localeCompare(right[0])),
    existingTargetHeads: completeWorklist
      .filter((sense) => sense.targetHead)
      .map((sense) => [sense.senseId, sense.targetHead])
  }));
  const pending = fullWorklist.filter((sense) => {
    if (requestedSenseSet?.has(sense.senseId)) return true;
    const progress = progressBySense.get(sense.senseId);
    return !currentProgress(
      progress,
      atomInventoryHash,
      context.config.candidateRevision,
      context.config.promptRevision,
      context.config.choicePromptRevision
    );
  }).slice(0, context.config.maximumSenses);
  const dataHash = hash(stableJson({
    sourceHash: allocation.sourceHash,
    coverageHash: allocation.coverageHash,
    atomInventoryHash,
    promptRevision: context.config.promptRevision,
    choicePromptRevision: context.config.choicePromptRevision,
    pending: pending.map((row) => row.senseId)
  }));
  const worklistPath = join(context.artifactDirectory, "worklist.pya");
  await atomicWrite(worklistPath, renderRowsPya(WORKLIST_NAME, "wordnet-sense-compound-worklist-v2", pending, {
    "source-hash": allocation.sourceHash,
    "atom-inventory-hash": atomInventoryHash,
    "candidate-revision": context.config.candidateRevision,
    "prompt-revision": context.config.promptRevision,
    "component-choice-prompt-revision": context.config.choicePromptRevision,
    "worklist-order": context.config.worklistOrder,
    "minimum-tag-count": context.config.minimumTagCount,
    "worklist-hash": dataHash,
    "eligible-sense-count": fullWorklist.length,
    "remaining-sense-count": fullWorklist.filter((sense) => {
      const progress = progressBySense.get(sense.senseId);
      return !currentProgress(
        progress,
        atomInventoryHash,
        context.config.candidateRevision,
        context.config.promptRevision,
        context.config.choicePromptRevision
      );
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
    "minimum-tag-count": context.config.minimumTagCount,
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
  context.translationFailurePath = join(context.artifactDirectory, "translation-failures.pya");
  const failureContent = renderRowsPya(TRANSLATION_FAILURES_NAME, "wordnet-sense-translation-failures-v1", response.failures.map((failure) => ({
    ...failure,
    id: failure.senseId
  })), {
    "prompt-revision": context.config.promptRevision,
    "model": context.config.model,
    "failure-count": response.failures.length
  });
  await atomicWrite(context.translationFailurePath, failureContent);
  const content = await readFile(cachePath, "utf8");
  return {
    "translation-cache-path": cachePath,
    "translation-cache-hash": hash(content),
    "translated-count": response.completedCount,
    "submitted-count": response.submittedCount,
    "failed-count": response.failures.length,
    "failure-path": context.translationFailurePath,
    "failure-hash": hash(failureContent),
    "failure-sense-ids": response.failures.map((failure) => failure.senseId),
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
  const lookupGlosses = [...new Set(glosses.flatMap(componentGlossAlternatives))];
  let suggestionRecords = [];
  let linkedWordNetSenses = [];
  if (lookupGlosses.length > 0) {
    const args = lookupGlosses.flatMap((gloss) => ["--text", gloss]);
    const suggestions = await (context.dependencies.suggestVocabulary ?? runVocabSuggest)(args, { report: () => {} });
    suggestionRecords = suggestions.suggestionRecords ?? [];
    linkedWordNetSenses = suggestions.linkedWordNetSenses ?? [];
  }
  const choicesByLookupGloss = buildKwonLinkedAtomicChoices({
    suggestions: suggestionRecords,
    linkedWordNetSenses,
    componentGlosses: lookupGlosses,
    activeAtomEntries: context.linkedAtomicSenses,
    layerByWord: context.layerIndex.byWord,
    deprecatedSurfaces: context.deprecatedSurfaces,
    wordnetIndex: context.allocation.wordnetIndex
  });
  const byGloss = new Map(choicesByLookupGloss);
  for (const gloss of glosses) {
    const choices = componentGlossAlternatives(gloss)
      .flatMap((alternative) => choicesByLookupGloss.get(normalizeGloss(alternative)) ?? []);
    const unique = new Map(choices.map((choice) => [`${choice.linkedSense.source}\u0000${choice.pyashSequence.join("+")}`, choice]));
    byGloss.set(normalizeGloss(gloss), [...unique.values()]);
  }
  const compositionPath = join(context.artifactDirectory, "component-compositions.pya");
  const compositionSource = await readIfPresent(compositionPath);
  const oldCompositionRows = compositionSource.trim()
    ? parseRowsPya(compositionSource, COMPOSITION_NAME)
    : [];
  const compositionById = new Map(oldCompositionRows.map((row) => [row.id, row]));
  const compositionRecords = [];
  const candidatesById = new Map();
  let compositionCallCount = 0;
  let compositionFailureCount = 0;
  let compositionWrite = Promise.resolve();
  const persistCompositions = () => {
    compositionWrite = compositionWrite.then(async () => {
      const rows = [...compositionById.values()].sort((left, right) => left.senseId.localeCompare(right.senseId)
        || Number(left.attempt ?? 0) - Number(right.attempt ?? 0)
        || left.id.localeCompare(right.id));
      const contents = renderRowsPya(COMPOSITION_NAME, "wordnet-sense-compound-component-compositions-v2", rows, {
        "source-hash": worklist["source-hash"],
        "translation-cache-hash": translations["translation-cache-hash"],
        "atom-inventory-hash": worklist["atom-inventory-hash"],
        "candidate-revision": context.config.candidateRevision,
        "prompt-revision": context.config.choicePromptRevision
      });
      await atomicWrite(compositionPath, contents);
    });
    return compositionWrite;
  };
  const compositionTransport = context.dependencies.composeSenseCompound
    ?? createQueuedMindSenseCompoundChoiceTransport({
      interpret: context.interpretFn,
      parse: context.parseFn,
      model: context.config.model,
      maxOutputTokens: context.config.choiceMaxOutputTokens
    });
  const translationCacheHash = text(translations["translation-cache-hash"]);
  const cacheMatches = (record, sense, inputHash) => Boolean(record
    && record.senseId === sense.senseId
    && record.sourceHash === worklist["source-hash"]
    && record.atomInventoryHash === worklist["atom-inventory-hash"]
    && record.translationCacheHash === translationCacheHash
    && record.candidateRevision === context.config.candidateRevision
    && record.promptRevision === context.config.choicePromptRevision
    && record.inputHash === inputHash
    && ["compound", "uncertain", "no-available-decomposition"].includes(record.status));
  const matchingAttempts = (sense, inputHash) => [...compositionById.values()]
    .filter((record) => record.senseId === sense.senseId
      && record.sourceHash === worklist["source-hash"]
      && record.atomInventoryHash === worklist["atom-inventory-hash"]
      && record.translationCacheHash === translationCacheHash
      && record.candidateRevision === context.config.candidateRevision
      && record.promptRevision === context.config.choicePromptRevision
      && record.inputHash === inputHash)
    .sort((left, right) => Number(right.attempt ?? 0) - Number(left.attempt ?? 0));
  const makeCandidate = (sense, sourceTranslations, input, rawResponse, record) => {
    const parsed = parseSenseCompoundChoiceResponse(rawResponse, { input });
    if (parsed.verdict !== "compound") return null;
    const candidate = buildSenseDerivedCompoundCandidateFromChoice({
      sense,
      selectedComponents: parsed.selectedComponents,
      translations: sourceTranslations,
      relations: context.allocation.wordnetIndex.relations,
      candidateRevision: context.config.candidateRevision,
      choicePromptRevision: context.config.choicePromptRevision,
      rationale: parsed.rationale,
      headRelationPolicy: context.config.headRelationPolicy
    });
    record.selectedWords = candidate.componentGlosses;
    record.selectedSourceGlosses = candidate.verificationSourceGlosses;
    candidatesById.set(candidate.id, candidate);
    return candidate;
  };
  const composeOne = async (sense) => {
    const sourceTranslations = cacheBySense.get(sense.senseId)?.translations ?? [];
    const input = buildSenseCompoundChoiceInput({ sense, translations: sourceTranslations, kwonCandidatesByGloss: byGloss });
    const inputHash = input ? hash(input.prompt) : hash(stableJson({ senseId: sense.senseId, sourceTranslations, noAvailableAtoms: true }));
    const matching = matchingAttempts(sense, inputHash);
    const prior = matching.find((record) => cacheMatches(record, sense, inputHash));
    const attempt = matching.reduce((maximum, record) => Math.max(maximum, Number(record.attempt) || 0), 0) + 1;
    const compositionId = `component-composition-${hash(`${sense.senseId}\u0000${context.config.choicePromptRevision}\u0000${inputHash}\u0000${attempt}`).slice(0, 24)}`;
    const common = {
      id: compositionId,
      senseId: sense.senseId,
      attempt: input ? attempt : 0,
      sourceHash: worklist["source-hash"],
      atomInventoryHash: worklist["atom-inventory-hash"],
      translationCacheHash,
      candidateRevision: context.config.candidateRevision,
      promptRevision: context.config.choicePromptRevision,
      inputHash,
      ...(input ? { prompt: input.prompt } : {})
    };
    if (!input) {
      if (prior) {
        compositionRecords.push(prior);
        return;
      }
      const row = { ...common, status: "no-available-decomposition", response: "" };
      compositionById.set(row.id, row);
      compositionRecords.push(row);
      await persistCompositions();
      return;
    }
    if (prior) {
      if (prior.status === "uncertain") {
        compositionRecords.push(prior);
        return;
      }
      try {
        makeCandidate(sense, sourceTranslations, input, prior.response, prior);
        compositionRecords.push(prior);
        return;
      } catch {
        // A stale or malformed saved proposal is retried through the configured mind.
      }
    }
    const handleId = `wordnet-sense-component-choice-${hash(`${sense.senseId}\u0000${context.config.choicePromptRevision}\u0000${inputHash}\u0000${attempt}`).slice(0, 24)}`;
    let rawResponse = "";
    let row;
    try {
      compositionCallCount += 1;
      rawResponse = await compositionTransport({
        sense,
        input,
        handleId,
        attempt
      });
      const parsed = parseSenseCompoundChoiceResponse(rawResponse, { input });
      row = {
        ...common,
        status: parsed.verdict,
        sourceLanguage: parsed.sourceLanguage,
        selectedWords: parsed.selectedComponents.map((component) => component.word),
        selectedSourceParts: parsed.selectedComponents.map((component) => component.sourcePart),
        selectedSourceGlosses: parsed.selectedComponents.map((component) => component.sourceGloss),
        rationale: parsed.rationale,
        response: String(rawResponse).slice(0, 4000)
      };
      if (parsed.verdict === "compound") makeCandidate(sense, sourceTranslations, input, rawResponse, row);
    } catch (error) {
      compositionFailureCount += 1;
      const exhausted = attempt >= context.config.choiceMaxAttempts;
      row = {
        ...common,
        status: exhausted ? "uncertain" : "failed",
        ...(exhausted ? { rationale: `Choice attempt limit (${context.config.choiceMaxAttempts}) exhausted after an invalid or unavailable response.` } : {}),
        error: text(error?.message ?? error).slice(0, 500) || "component-choice request failed",
        response: String(rawResponse).slice(0, 4000)
      };
    }
    compositionById.set(row.id, row);
    compositionRecords.push(row);
    await persistCompositions();
  };
  const compositionWidth = Math.max(1, Math.trunc(Number(context.config.parallelism) || 1));
  for (let offset = 0; offset < completeSenses.length; offset += compositionWidth) {
    await Promise.all(completeSenses.slice(offset, offset + compositionWidth).map(composeOne));
  }
  await compositionWrite;
  context.compositionRecords = compositionRecords;
  const uniqueCandidates = [...candidatesById.values()].sort((left, right) => left.frequencyRank - right.frequencyRank
    || right.frequencyTagCount - left.frequencyTagCount
    || left.id.localeCompare(right.id));
  const componentMappings = glosses.map((gloss) => ({
    id: `component-gloss-${hash(normalizeGloss(gloss)).slice(0, 24)}`,
    gloss,
    alternatives: componentGlossAlternatives(gloss),
    atoms: (byGloss.get(normalizeGloss(gloss)) ?? []).map((choice) => ({
      word: choice.word,
      pyashSequence: choice.pyashSequence,
      componentLayer: choice.componentLayers[0],
      mappingKind: choice.mappingKind,
      mappingCoverageType: choice.mappingCoverageType,
      mappingLookupGloss: choice.mappingLookupGloss,
      mappingLookupSenseEvidence: choice.mappingLookupSenseEvidence,
      ...(choice.mappingSuggestedWord ? { mappingSuggestedWord: choice.mappingSuggestedWord } : {}),
      linkedSense: choice.linkedSense
    })),
    status: (byGloss.get(normalizeGloss(gloss)) ?? []).length > 0 ? "linked-atom-candidates" : "unresolved-component-gloss"
  }));
  const mappingsPath = join(context.artifactDirectory, "component-mappings.pya");
  const mappingsContents = renderRowsPya(COMPONENT_MAP_NAME, "wordnet-sense-compound-component-mappings-v2", componentMappings);
  await atomicWrite(mappingsPath, mappingsContents);
  const candidatesPath = join(context.artifactDirectory, "compound-candidates.pya");
  const candidateHash = hash(stableJson(uniqueCandidates));
  await atomicWrite(candidatesPath, renderRowsPya(CANDIDATE_NAME, "wordnet-sense-derived-compound-candidates-v2", uniqueCandidates, {
    "worklist-hash": worklist["worklist-hash"],
    "translation-cache-hash": translations["translation-cache-hash"],
    "candidate-revision": context.config.candidateRevision,
    "component-choice-prompt-revision": context.config.choicePromptRevision,
    "candidate-hash": candidateHash
  }));
  context.candidates = uniqueCandidates;
  return {
    "component-compositions-path": compositionPath,
    "component-composition-count": compositionRecords.length,
    "component-choice-call-count": compositionCallCount,
    "component-choice-failure-count": compositionFailureCount,
    "candidate-path": candidatesPath,
    "component-mappings-path": mappingsPath,
    "component-mappings-hash": hash(mappingsContents),
    "candidate-hash": candidateHash,
    "source-sense-count": selected.length,
    "candidate-count": uniqueCandidates.length,
    "mapped-gloss-count": byGloss.size,
    "unmapped-glosses": glosses.flatMap((gloss) => componentGlossAlternatives(gloss))
      .filter((gloss) => (byGloss.get(normalizeGloss(gloss)) ?? []).length === 0)
  };
}

async function updateProgress(context, worklistRows, candidateRows, decisions) {
  const bySense = new Map(context.progressRecords.map((record) => [record.senseId, record]));
  const compositionBySense = new Map((context.compositionRecords ?? []).map((record) => [record.senseId, record]));
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
    const composition = compositionBySense.get(sense.senseId);
    let status = "retry";
    if (!completeTranslation) {
      status = "retry";
    } else if (senseCandidates.length === 0) {
      if (composition?.status === "uncertain") status = "uncertain";
      else if (composition?.status === "no-available-decomposition") status = "no-compound-candidate";
      else if (composition?.status === "failed" || composition?.status === "compound") status = "retry";
      else status = senseTranslation.translations.some((translation) => translation.composition === "uncertain")
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
      candidateRevision: context.config.candidateRevision,
      sourceHash: context.allocation.sourceHash,
      promptRevision: context.config.promptRevision,
      choicePromptRevision: context.config.choicePromptRevision,
      candidateIds: senseCandidates.map((candidate) => candidate.id),
    });
  }
  context.progressRecords = [...bySense.values()];
  const path = join(context.artifactDirectory, "progress.pya");
  await atomicWrite(path, renderRowsPya(PROGRESS_NAME, "wordnet-sense-compound-progress-v1", context.progressRecords));
  const remainingCount = (context.fullWorklist ?? []).filter((sense) => {
    const progress = bySense.get(sense.senseId);
    return !currentProgress(
      progress,
      context.atomInventoryHash,
      context.config.candidateRevision,
      context.config.promptRevision,
      context.config.choicePromptRevision
    );
  }).length;
  return { path, remainingCount };
}

function senseOutcomeSummary(worklistRows, candidateRows, progressRecords) {
  const selectedIds = new Set(worklistRows.map((sense) => text(sense?.senseId)).filter(Boolean));
  const candidateIds = new Set(candidateRows.map((candidate) => text(candidate?.senseId)).filter(Boolean));
  const progressBySense = new Map(progressRecords.map((record) => [record.senseId, record]));
  const counts = {
    accepted: 0,
    uncertain: 0,
    rejected: 0,
    noCandidate: 0,
    uncertainWithoutCandidate: 0,
    pending: 0
  };
  for (const senseId of selectedIds) {
    const status = progressBySense.get(senseId)?.status;
    if (status === "accepted") counts.accepted += 1;
    else if (status === "uncertain") {
      if (candidateIds.has(senseId)) counts.uncertain += 1;
      else counts.uncertainWithoutCandidate += 1;
    }
    else if (status === "rejected") counts.rejected += 1;
    else if (status === "no-compound-candidate") counts.noCandidate += 1;
    else counts.pending += 1;
  }
  const candidateSenseCount = [...candidateIds].filter((senseId) => selectedIds.has(senseId)).length;
  const candidateAcceptedPercent = candidateSenseCount === 0
    ? 0
    : Math.round((counts.accepted / candidateSenseCount) * 1000) / 10;
  return {
    "selected-sense-count": selectedIds.size,
    "candidate-sense-count": candidateSenseCount,
    "accepted-sense-count": counts.accepted,
    "uncertain-sense-count": counts.uncertain,
    "rejected-sense-count": counts.rejected,
    "no-candidate-sense-count": counts.noCandidate,
    "uncertain-no-candidate-sense-count": counts.uncertainWithoutCandidate,
    "pending-sense-count": counts.pending,
    "accepted-candidate-sense-percent": candidateAcceptedPercent
  };
}

function componentChoiceDecisionSummary(candidateRows, decisions, compositionRecords = [], selectedSenses = []) {
  const decisionsById = new Map(decisions.map((record) => [record.candidateId, record]));
  const records = candidateRows.map((candidate) => decisionsById.get(candidate.id)).filter(Boolean);
  const selectedSenseIds = new Set(selectedSenses.map((sense) => text(sense?.senseId)).filter(Boolean));
  const counts = {
    accepted: records.filter((record) => acceptedDecision(record)).length,
    uncertain: compositionRecords.filter((record) => record.status === "uncertain"
      && selectedSenseIds.has(text(record.senseId))).length,
    rejected: records.filter((record) => record.status === "rejected-deterministic").length,
    pending: candidateRows.length - records.length
  };
  const decidedCount = counts.accepted + counts.uncertain + counts.rejected;
  const acceptedPercent = decidedCount === 0 ? 0 : Math.round((counts.accepted / decidedCount) * 1000) / 10;
  return {
    "component-choice-decision-count": records.length,
    "accepted-component-choice-count": counts.accepted,
    "uncertain-component-choice-count": counts.uncertain,
    "rejected-component-choice-count": counts.rejected,
    "pending-component-choice-count": counts.pending,
    "accepted-component-choice-percent": acceptedPercent
  };
}

async function recordAndPromoteChoices({ context, candidates }) {
  const candidateRows = context.candidates ?? parseRowsPya(await readFile(candidates["candidate-path"], "utf8"), CANDIDATE_NAME);
  const decisionRevision = context.allocation.allocationConfig["compound-verification-revision"];
  if (!decisionRevision) throw invalid("WordNet compound decision revision is not configured");
  const decisionsPath = context.dependencies.decisionsPath
    ?? fileURLToPath(ENGLISH_WORDNET_COMPOUND_DECISIONS_URL);
  const decisionState = context.dependencies.loadDecisions
    ? await context.dependencies.loadDecisions()
    : await loadEnglishWordNetCompoundDecisions();
  const decisionsById = new Map(decisionState.rows.map((record) => [record.candidateId, record]));
  const persistDecisions = async () => {
    const rows = [...decisionsById.values()];
    if (typeof context.dependencies.saveDecisions === "function") {
      await context.dependencies.saveDecisions(rows, decisionsPath);
      return;
    }
    await atomicWrite(decisionsPath, renderEnglishWordNetCompoundDecisions(rows));
  };
  const usedTargetIds = [
    ...context.allocation.preservedTargetIds,
    ...context.allocation.allocation.assignments.map((row) => row.targetId)
  ];
  let decisionsChanged = false;
  for (const candidate of candidateRows) {
    const prior = decisionsById.get(candidate.id);
    if (prior?.decisionRevision === decisionRevision && !context.config.senseIds?.includes(candidate.senseId)) continue;
    const decision = wordNetCompoundDecisionRecord({
      ...candidate,
      status: "accepted-llm",
      verificationStatus: "accepted-llm",
      decisionRevision
    });
    if (!acceptedDecision(decision)) {
      decision.status = "rejected-deterministic";
      decision.verificationStatus = "rejected-deterministic";
      decision.verificationRationale = "The selected atoms failed deterministic source, sense, or order evidence validation.";
    }
    decisionsById.set(decision.candidateId, decision);
    decisionsChanged = true;
  }
  const candidateDecisions = candidateRows.map((candidate) => decisionsById.get(candidate.id)).filter(Boolean);
  if (decisionsChanged) await persistDecisions();
  const accepted = candidateDecisions.filter((record) => acceptedDecision(record));
  if (accepted.length > 0) {
    const promoted = await (context.dependencies.promoteAccepted ?? promoteAcceptedCompounds)(accepted, { usedTargetIds, decisionRevision });
    for (const decision of promoted.decisions) decisionsById.set(decision.candidateId, decision);
    await persistDecisions();
  }
  const completed = candidateRows.map((candidate) => decisionsById.get(candidate.id)).filter(Boolean);
  const progress = await updateProgress(context, context.worklist ?? [], candidateRows, completed);
  const senseOutcomes = senseOutcomeSummary(context.worklist ?? [], candidateRows, context.progressRecords);
  const choiceOutcomes = componentChoiceDecisionSummary(
    candidateRows,
    completed,
    context.compositionRecords ?? [],
    context.worklist ?? []
  );
  const artifactPath = join(context.artifactDirectory, "sense-compound-decisions.pya");
  const content = renderRowsPya(DECISION_BATCH_NAME, "wordnet-sense-compound-component-choice-result-v1", completed.map((record) => ({
    ...record,
    id: record.candidateId
  })), {
    "decision-revision": decisionRevision,
    "progress-path": progress.path,
    "remaining-sense-count": progress.remainingCount,
    ...senseOutcomes,
    ...choiceOutcomes
  });
  await atomicWrite(artifactPath, content);
  return {
    "decision-path": artifactPath,
    "decision-hash": hash(content),
    "decision-count": completed.length,
    "accepted-count": completed.filter((record) => acceptedDecision(record)
      && ["promoted-to-derived-index", "already-active"].includes(record.promotionStatus)).length,
    "promoted-sense-count": senseOutcomes["accepted-sense-count"],
    "uncertain-count": choiceOutcomes["uncertain-component-choice-count"],
    "rejected-count": choiceOutcomes["rejected-component-choice-count"],
    ...senseOutcomes,
    ...choiceOutcomes,
    "translation-failure-count": context.translationFailures?.length ?? 0,
    "translation-failure-path": context.translationFailurePath ?? "",
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
    result = await recordAndPromoteChoices({ context, candidates: mapValue("sense compound candidates") });
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
  config.maximumSenses = resolveWordNetSenseCompoundMaximumSenses(
    config.maximumSenses,
    configuration.maximumSenses
  );
  config.senseIds = resolveWordNetSenseCompoundSenseIds(configuration.senseIds);
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
    translationFailureCount: context.translationFailures?.length ?? 0,
    translationFailurePath: context.translationFailurePath ?? "",
    result,
    selectedSenseCount: context.worklist.length,
    remainingSenseCount: mapValue("sense compound decisions")["remaining-sense-count"]
      ?? mapValue("sense worklist")["remaining-sense-count"]
      ?? 0,
    candidateCount: mapValue("sense compound candidates")["candidate-count"] ?? 0
  };
}
