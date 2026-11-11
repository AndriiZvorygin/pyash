import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
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
  ENGLISH_WORDNET_SENSE_COMPOUND_MAX_ATOMS,
  ENGLISH_WORDNET_SENSE_TRANSLATION_CACHE_NAME,
  buildKwonLinkedAtomicChoices,
  buildSenseCompoundChoiceInput,
  buildSenseDerivedCompoundCandidateFromChoice,
  componentGlossAlternatives,
  componentGlossLookupAlternatives,
  hasCompositionSourceTranslations,
  mergeWordNetSenseTranslationFailures,
  mapComponentGlossChoices,
  buildSenseCompoundWorklist,
  wordNetLemmaComponentTranslations,
  createQueuedMindSenseCompoundChoiceTransport,
  createQueuedMindWordNetSenseTranslationTransport,
  parseSenseCompoundChoiceResponse,
  parseWordNetSenseTranslationCache,
  renderWordNetSenseTranslationCacheEntry,
  translateWordNetSenseWave
} from "./english_wordnet_sense_compounds.mjs";
import {
  buildEnglishWordNetBridgeIndex,
  loadEnglishWordNetBridges
} from "./english_wordnet_bridges.mjs";
import { loadWordNetVerifiedCompoundIndex } from "./compound_coverage.mjs";
import { loadPyacWordLayerIndex } from "./pyac_complexity.mjs";
import { DEFAULT_ATOM_WORD_LAYER_DIRECTORY } from "./atom_word_generation.mjs";
import { loadEnglishLemmaCatalog } from "./english_lemmas.mjs";
import {
  ENGLISH_WORDNET_COMPOUND_DECISIONS_URL,
  loadEnglishWordNetCompoundDecisions,
  renderEnglishWordNetCompoundDecisionAppend,
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
const SENSE_COMPOUND_RUN_DIRECTORY = /^wordnet-sense-compounds-[a-f0-9]{24}$/u;
let definitionPromise = null;

function invalid(message, details = {}) {
  const error = new Error(message);
  error.code = "invalid-wordnet-sense-compound-refinery";
  error.details = details;
  return error;
}

function allocatedTargetIds(allocation) {
  return [
    ...(allocation?.preservedTargetIds ?? []),
    ...(allocation?.allocation?.assignments ?? []).map((row) => row.targetId)
  ].filter((targetId) => typeof targetId === "string" && targetId);
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

export function resolveWordNetSenseCompoundMinimumTagCount(configuredMinimum, requestedMinimum) {
  const configured = Number(configuredMinimum);
  if (!Number.isSafeInteger(configured) || configured < 0) {
    throw invalid("sense compound refinery configured minimumTagCount must be a nonnegative integer");
  }
  if (requestedMinimum === undefined) return configured;
  const requested = Number(requestedMinimum);
  if (!Number.isSafeInteger(requested) || requested < 0) {
    throw invalid("sense compound refinery minimumTagCount override must be a nonnegative integer");
  }
  return requested;
}

export function resolveWordNetSenseCompoundMaximumComponents(configuredMaximum) {
  const configured = Number(configuredMaximum);
  if (configured !== ENGLISH_WORDNET_SENSE_COMPOUND_MAX_ATOMS) {
    throw invalid("sense compound refinery maximum-compound-components must match the current two-atom limit", {
      configured,
      maximum: ENGLISH_WORDNET_SENSE_COMPOUND_MAX_ATOMS
    });
  }
  return configured;
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

function parseRowsPya(source, expectedName, { allowUpdates = false } = {}) {
  const sentences = buildProgram(source).sentences;
  const header = sentences.find((sentence) => sentence?.mood === "def"
    && sentence?.be === "map"
    && sentence?.su?.name === expectedName);
  if (!header) throw invalid("sense compound artifact has no expected Pyash map", { expectedName });
  const recordsById = new Map();
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
    if (record?.id !== sentence.su.text || (!allowUpdates && recordsById.has(record.id))) {
      throw invalid("sense compound artifact row identity is mismatched or duplicated", { index, id: sentence.su.text });
    }
    recordsById.set(record.id, record);
  }
  return [...recordsById.values()];
}

function renderArtifactRow(record) {
  const id = text(record?.id ?? record?.senseId ?? record?.candidateId);
  if (!id) throw invalid("sense compound artifact row has no stable identity");
  return `su text ${JSON.stringify(id)} ob text ${JSON.stringify(JSON.stringify(record))} ya\n`;
}

async function appendArtifactRows(context, artifactPath, name, format, records, metadata = {}, renderRecord = renderArtifactRow) {
  const sweepState = context.sweepState;
  const initialized = sweepState?.initializedArtifacts ?? (sweepState.initializedArtifacts = new Set());
  const metadataByPath = sweepState.artifactMetadata ?? (sweepState.artifactMetadata = new Map());
  if (!initialized.has(artifactPath)) {
    let exists = false;
    try {
      const info = await stat(artifactPath);
      exists = info.size > 0;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    if (!exists) {
      await atomicWrite(artifactPath, renderRowsPya(name, format, [], metadata));
      metadataByPath.set(artifactPath, stableJson(metadata));
    }
    initialized.add(artifactPath);
  }
  const updates = records.map(renderRecord);
  const metadataSignature = stableJson(metadata);
  if (Object.keys(metadata).length > 0 && metadataByPath.get(artifactPath) !== metadataSignature) {
    for (const [key, value] of Object.entries(metadata)) {
      updates.push(`su text ${JSON.stringify(`meta:${key}`)} ob text ${JSON.stringify(String(value))} ya\n`);
    }
    metadataByPath.set(artifactPath, metadataSignature);
  }
  if (updates.length > 0) await appendFile(artifactPath, updates.join(""), "utf8");
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
  const maximumCompoundComponents = resolveWordNetSenseCompoundMaximumComponents(values["maximum-compound-components"]);
  const requirePrincetonIntersectionText = text(values["require-princeton-intersection"] ?? "false").toLowerCase();
  if (!["true", "false"].includes(requirePrincetonIntersectionText)) {
    throw invalid("sense compound refinery require-princeton-intersection must be true or false");
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
    maximumCompoundComponents,
    requirePrincetonIntersection: requirePrincetonIntersectionText === "true",
    worklistOrder,
    candidateRevision,
    headRelationPolicy
  };
}

function modelName(row) {
  return text(typeof row === "string" ? row : row?.name ?? row?.model);
}

function markProviderSubmission(context) {
  if (context.sweepState.firstProviderSubmissionAt === null) {
    context.sweepState.firstProviderSubmissionAt = Date.now();
  }
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

function isProcessedProgress(progress) {
  return Boolean(text(progress?.senseId))
    && !["processing", "interrupted"].includes(text(progress?.status));
}

async function completedSenseIdsFromHistory({ artifactRoot, currentDirectory, sourceHash, currentProgress, readText }) {
  const completed = new Set(currentProgress
    .filter(isProcessedProgress)
    .map((record) => record.senseId));
  let entries;
  try {
    entries = await readdir(artifactRoot, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return completed;
    throw error;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()
      || resolve(artifactRoot, entry.name) === resolve(currentDirectory)
      || !SENSE_COMPOUND_RUN_DIRECTORY.test(entry.name)) continue;
    const source = await readText(join(artifactRoot, entry.name, "progress.pya"));
    if (!source) continue;
    for (const record of parseRowsPya(source, PROGRESS_NAME, { allowUpdates: true })) {
      if (isProcessedProgress(record)) completed.add(record.senseId);
    }
  }
  return completed;
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
  const sweepState = context.sweepState;
  let inventory = sweepState.inventory;
  if (!inventory || inventory.sourceHash !== allocation.sourceHash) {
    const [bridgeCatalog, layerIndex, lemmaCatalog] = await Promise.all([
      (dependencies.loadBridges ?? loadEnglishWordNetBridges)(),
      (dependencies.loadLayerIndex ?? (() => loadPyacWordLayerIndex({
        directory: DEFAULT_ATOM_WORD_LAYER_DIRECTORY
      })) )(),
      (dependencies.loadLemmaCatalog ?? loadEnglishLemmaCatalog)()
    ]);
    inventory = {
      sourceHash: allocation.sourceHash,
      bridgeIndex: (dependencies.buildBridgeIndex ?? buildEnglishWordNetBridgeIndex)({
        entries: bridgeCatalog.entries,
        resolveTarget: allocation.resolveWord
      }),
      layerIndex,
      lemmaCatalog
    };
    sweepState.inventory = inventory;
  }
  const { bridgeIndex, layerIndex, lemmaCatalog } = inventory;
  const deprecatedSurfaces = lemmaCatalog.entries
    .filter((entry) => entry.status === "deprecated-duplicate")
    .map((entry) => entry.surface);
  const deprecated = new Set(deprecatedSurfaces.map((word) => word.toLowerCase()));
  const linkedEntries = [...bridgeIndex.bySense.values()].filter((entry) => !deprecated.has(text(entry.target).toLowerCase()));
  const wordnetCompounds = await (dependencies.loadWordNetCompoundIndex ?? loadWordNetVerifiedCompoundIndex)();
  const linkedSenseIds = [...new Set([
    ...linkedEntries.map((entry) => entry.source),
    ...wordnetCompounds.map((entry) => text(entry?.senseId))
  ].filter(Boolean))];
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
    order: context.config.worklistOrder,
    rankForEnglish: allocation.rankForEnglish,
    requirePrincetonIntersection: context.config.requirePrincetonIntersection
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
  let progressBySense = sweepState.progressBySense;
  if (!(progressBySense instanceof Map)) {
    const progressSource = await (dependencies.readFile ?? readIfPresent)(progressPath);
    const progressRecords = progressSource ? parseRowsPya(progressSource, PROGRESS_NAME, { allowUpdates: true }) : [];
    progressBySense = new Map(progressRecords.map((record) => [record.senseId, record]));
  } else {
    progressBySense = new Map(progressBySense);
  }
  for (const progress of progressBySense.values()) {
    if (progress.status !== "processing") continue;
    progressBySense.set(progress.senseId, {
      ...progress,
      status: "interrupted",
      interruptedRunId: progress.claimRunId ?? ""
    });
  }
  if (!(sweepState.completedHistoricalSenseIds instanceof Set)) {
    sweepState.completedHistoricalSenseIds = await completedSenseIdsFromHistory({
      artifactRoot: dirname(context.artifactDirectory),
      currentDirectory: context.artifactDirectory,
      sourceHash: allocation.sourceHash,
      currentProgress: [],
      readText: dependencies.readFile ?? readIfPresent
    });
  }
  const completedSenseIds = new Set(sweepState.completedHistoricalSenseIds);
  for (const progress of progressBySense.values()) {
    if (isProcessedProgress(progress)) completedSenseIds.add(progress.senseId);
  }
  for (const senseId of requestedSenseSet ?? []) completedSenseIds.delete(senseId);
  let translationState = sweepState.translationState;
  if (!translationState || translationState.sourceHash !== allocation.sourceHash) {
    const translationSource = await (dependencies.readFile ?? readIfPresent)(translationPath);
    const parsedTranslationState = translationSource
      ? parseWordNetSenseTranslationCache(translationSource)
      : { records: [], bySense: new Map() };
    const currentTranslations = parsedTranslationState.records.filter((record) => (
      record.wordNetHash === allocation.sourceHash
    ));
    translationState = {
      sourceHash: allocation.sourceHash,
      records: currentTranslations,
      bySense: new Map(currentTranslations.map((record) => [record.senseId, record]))
    };
    sweepState.translationState = translationState;
  }
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
    return !completedSenseIds.has(sense.senseId)
      && !isProcessedProgress(progressBySense.get(sense.senseId));
  }).slice(0, context.config.maximumSenses);
  for (const sense of pending) {
    progressBySense.set(sense.senseId, {
      ...(progressBySense.get(sense.senseId) ?? {}),
      id: sense.senseId,
      senseId: sense.senseId,
      status: "processing",
      atomInventoryHash,
      candidateRevision: context.config.candidateRevision,
      sourceHash: allocation.sourceHash,
      promptRevision: context.config.promptRevision,
      choicePromptRevision: context.config.choicePromptRevision,
      claimRunId: context.runId,
      candidateIds: []
    });
  }
  const claimedProgress = [...progressBySense.values()];
  await appendArtifactRows(context, progressPath, PROGRESS_NAME, "wordnet-sense-compound-progress-v1", pending.map((sense) => progressBySense.get(sense.senseId)));
  const dataHash = hash(stableJson({
    sourceHash: allocation.sourceHash,
    coverageHash: allocation.coverageHash,
    atomInventoryHash,
    promptRevision: context.config.promptRevision,
    choicePromptRevision: context.config.choicePromptRevision,
    worklistOrder: context.config.worklistOrder,
    minimumTagCount: context.config.minimumTagCount,
    requirePrincetonIntersection: context.config.requirePrincetonIntersection,
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
    "maximum-compound-components": context.config.maximumCompoundComponents,
    "require-princeton-intersection": context.config.requirePrincetonIntersection,
    "worklist-hash": dataHash,
    "eligible-sense-count": fullWorklist.length,
    "remaining-sense-count": fullWorklist.filter((sense) => {
      return !completedSenseIds.has(sense.senseId)
        && !isProcessedProgress(progressBySense.get(sense.senseId));
    }).length
  }));
  context.allocation = allocation;
  context.bridgeIndex = bridgeIndex;
  context.linkedAtomicSenses = linkedAtomicSenses;
  context.deprecatedSurfaces = deprecatedSurfaces;
  context.layerIndex = layerIndex;
  context.progressRecords = claimedProgress;
  sweepState.progressBySense = progressBySense;
  context.completedSenseIds = completedSenseIds;
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
    "maximum-compound-components": context.config.maximumCompoundComponents,
    "require-princeton-intersection": context.config.requirePrincetonIntersection,
    "selected-sense-count": pending.length,
    "remaining-sense-count": fullWorklist.filter((sense) => {
      return !completedSenseIds.has(sense.senseId)
        && !isProcessedProgress(progressBySense.get(sense.senseId));
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
  context.translationFailurePath = join(context.artifactDirectory, "translation-failures.pya");
  const sweepState = context.sweepState;
  if (!(sweepState.translationFailuresById instanceof Map)) {
    const previousFailureSource = await readIfPresent(context.translationFailurePath);
    const previousRows = previousFailureSource.trim()
      ? parseRowsPya(previousFailureSource, TRANSLATION_FAILURES_NAME, { allowUpdates: true })
      : [];
    sweepState.translationFailuresById = new Map(previousRows.map((row) => [row.id, row]));
  }
  let failureRows = [...sweepState.translationFailuresById.values()];
  let failureWrite = Promise.resolve();
  const persistFailures = (rows = []) => {
    failureWrite = failureWrite.then(async () => {
      await appendArtifactRows(context, context.translationFailurePath, TRANSLATION_FAILURES_NAME, "wordnet-sense-translation-failures-v1", rows, {
        "prompt-revision": context.config.promptRevision,
        "model": context.config.model
      });
    });
    return failureWrite;
  };
  const updateFailureRows = async (newRows, options = {}) => {
    const previousById = new Map(sweepState.translationFailuresById);
    failureRows = mergeWordNetSenseTranslationFailures(failureRows, newRows, options);
    sweepState.translationFailuresById = new Map(failureRows.map((row) => [row.id, row]));
    const changedRows = failureRows.filter((row) => stableJson(previousById.get(row.id) ?? null) !== stableJson(row));
    if (changedRows.length > 0) await persistFailures(changedRows);
  };
  const response = await translateWordNetSenseWave({
    senses: selected,
    cachedRecords: cached,
    wordNetHash: context.allocation?.sourceHash ?? worklist["source-hash"],
    languages: context.config.languages,
    promptRevision: context.config.promptRevision,
    parallelism: context.config.parallelism,
    maxAttempts: 2,
    submit: async (...args) => {
      markProviderSubmission(context);
      return transport.submit(...args);
    },
    awaitHandle: transport.await,
    onCacheEntry: async (record) => {
      await appendArtifactRows(context, cachePath, ENGLISH_WORDNET_SENSE_TRANSLATION_CACHE_NAME,
        "english-wordnet-sense-compounds-v1", [record], {
          "source-hash": worklist["source-hash"],
          "prompt-revision": context.config.promptRevision,
          model: context.config.model
        }, renderWordNetSenseTranslationCacheEntry);
      const recordsBySense = new Map((context.translationState?.records ?? cached).map((row) => [row.senseId, row]));
      recordsBySense.set(record.senseId, record);
      const records = [...recordsBySense.values()].sort((left, right) => left.senseId.localeCompare(right.senseId));
      context.translationState = { sourceHash: worklist["source-hash"], records, bySense: new Map(records.map((row) => [row.senseId, row])) };
      sweepState.translationState = context.translationState;
    },
    onFailure: async (failure) => {
      await updateFailureRows([failure]);
    }
  });
  if (response.records.length === 0) {
    await appendArtifactRows(context, cachePath, ENGLISH_WORDNET_SENSE_TRANSLATION_CACHE_NAME,
      "english-wordnet-sense-compounds-v1", [], {
        "source-hash": worklist["source-hash"],
        "prompt-revision": context.config.promptRevision,
        model: context.config.model
      });
  }
  context.translationState = { records: response.records, bySense: new Map(response.records.map((record) => [record.senseId, record])) };
  context.translationState.sourceHash = worklist["source-hash"];
  sweepState.translationState = context.translationState;
  await updateFailureRows(response.failures, {
    resolvedTranslations: response.records
  });
  await persistFailures();
  context.translationFailures = response.failures;
  const content = await readFile(cachePath, "utf8");
  const failureContent = await readFile(context.translationFailurePath, "utf8");
  const failedSenseIds = [...new Set(response.failures.map((failure) => failure.senseId))];
  context.translationFailedSenseCount = failedSenseIds.length;
  return {
    "translation-cache-path": cachePath,
    "translation-cache-hash": hash(content),
    "translated-count": response.completedCount,
    "submitted-count": response.submittedCount,
    "failed-count": failedSenseIds.length,
    "failed-language-count": response.failures.length,
    "failure-path": context.translationFailurePath,
    "failure-hash": hash(failureContent),
    "failure-sense-ids": failedSenseIds,
    "partial-sense-ids": response.records.filter((record) => record.status !== "complete").map((record) => record.senseId)
  };
}

function collectComponentGlosses(translations) {
  return [...new Set(translations.flatMap((translation) => (translation.components ?? [])
    .map((component) => text(component.gloss).replace(/\s+/gu, " "))
    .filter(Boolean)))];
}

function normalizeGloss(value) {
  return text(value).toLowerCase().replace(/[_-]+/gu, " ").replace(/\s+/gu, " ").trim();
}

export async function runSenseCompoundChoiceWaves(senses, {
  width = 1,
  resolveWave,
  dispatch
} = {}) {
  if (!Array.isArray(senses) || typeof resolveWave !== "function" || typeof dispatch !== "function") {
    throw invalid("sense compound choice waves require senses, a resolver, and a dispatcher");
  }
  const batchWidth = Math.max(1, Math.trunc(Number(width) || 1));
  const waves = [];
  for (let offset = 0; offset < senses.length; offset += batchWidth) {
    waves.push(senses.slice(offset, offset + batchWidth));
  }
  if (waves.length === 0) return;
  const dispatchWave = async (wave, resolved) => {
    const results = await Promise.allSettled(wave.map((sense) => dispatch(sense, resolved)));
    const failed = results.find((result) => result.status === "rejected");
    if (failed) return { error: failed.reason };
    return { value: results.map((result) => result.value) };
  };
  let resolved = await resolveWave(waves[0]);
  let pendingDispatch = dispatchWave(waves[0], resolved);
  for (let index = 1; index < waves.length; index += 1) {
    let nextResolved;
    try {
      nextResolved = await resolveWave(waves[index]);
    } catch (error) {
      await pendingDispatch;
      throw error;
    }
    const previous = await pendingDispatch;
    if (previous.error) throw previous.error;
    pendingDispatch = dispatchWave(waves[index], nextResolved);
  }
  const final = await pendingDispatch;
  if (final.error) throw final.error;
}

export async function runSenseCompoundVocabularyLookups(lookupGlosses, {
  chunkSize = 8,
  suggestVocabulary
} = {}) {
  if (!Array.isArray(lookupGlosses) || typeof suggestVocabulary !== "function") {
    throw invalid("sense compound vocabulary lookups require terms and a suggester");
  }
  const width = Math.max(1, Math.trunc(Number(chunkSize) || 1));
  const suggestionRecords = [];
  const linkedWordNetSenses = [];
  for (let offset = 0; offset < lookupGlosses.length; offset += width) {
    const chunk = lookupGlosses.slice(offset, offset + width);
    const result = await suggestVocabulary(chunk.flatMap((gloss) => ["--text", gloss]), { report: () => {} });
    if (Array.isArray(result?.suggestionRecords)) suggestionRecords.push(...result.suggestionRecords);
    if (Array.isArray(result?.linkedWordNetSenses)) linkedWordNetSenses.push(...result.linkedWordNetSenses);
  }
  return { suggestionRecords, linkedWordNetSenses };
}

async function composeCandidates({ context, worklist, translations }) {
  const selected = context.worklist ?? parseRowsPya(await readFile(worklist["worklist-path"], "utf8"), WORKLIST_NAME);
  const cachePath = translations["translation-cache-path"];
  const cacheRows = context.translationState?.records
    ?? parseWordNetSenseTranslationCache(await readFile(cachePath, "utf8")).records;
  const cacheBySense = new Map(cacheRows.map((record) => [record.senseId, record]));
  const compositionSenses = selected.filter((sense) => hasCompositionSourceTranslations(sense, cacheBySense.get(sense.senseId)));
  const sourceTranslationsBySense = new Map(compositionSenses.map((sense) => [
    sense.senseId,
    [
      ...(cacheBySense.get(sense.senseId)?.translations ?? []),
      ...wordNetLemmaComponentTranslations(sense)
    ]
  ]));
  const glosses = collectComponentGlosses(compositionSenses.flatMap((sense) => sourceTranslationsBySense.get(sense.senseId) ?? []));
  const byGloss = new Map();
  const choicesByLookupGlossCache = new Map();
  const compositionPath = join(context.artifactDirectory, "component-compositions.pya");
  const sweepState = context.sweepState;
  if (!(sweepState.compositionById instanceof Map)) {
    const compositionSource = await readIfPresent(compositionPath);
    const oldCompositionRows = compositionSource.trim()
      ? parseRowsPya(compositionSource, COMPOSITION_NAME, { allowUpdates: true })
      : [];
    sweepState.compositionById = new Map(oldCompositionRows.map((row) => [row.id, row]));
  }
  const compositionById = sweepState.compositionById;
  const compositionRecords = [];
  const candidatesById = new Map();
  let compositionCallCount = 0;
  let compositionFailureCount = 0;
  let compositionWrite = Promise.resolve();
  const persistCompositions = (rows = []) => {
    compositionWrite = compositionWrite.then(async () => {
      await appendArtifactRows(context, compositionPath, COMPOSITION_NAME,
        "wordnet-sense-compound-component-compositions-v3", rows, {
        "source-hash": worklist["source-hash"],
        "translation-cache-hash": translations["translation-cache-hash"],
        "atom-inventory-hash": worklist["atom-inventory-hash"],
        "candidate-revision": context.config.candidateRevision,
        "prompt-revision": context.config.choicePromptRevision
      });
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
  const reservedTargetIds = new Set(allocatedTargetIds(context.allocation));
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
  const composeOne = async (sense, waveByGloss) => {
    const sourceTranslations = sourceTranslationsBySense.get(sense.senseId) ?? [];
    const input = buildSenseCompoundChoiceInput({
      sense,
      translations: sourceTranslations,
      kwonCandidatesByGloss: waveByGloss,
      reservedTargetIds
    });
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
      ...(input?.promptTruncated ? {
        promptTruncated: true,
        omittedOptionCount: input.omittedOptionCount
      } : {}),
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
      await persistCompositions([row]);
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
      markProviderSubmission(context);
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
        selectedWords: parsed.selectedComponents.map((component) => component.word),
        selectedSourceLanguages: [...new Set(parsed.selectedComponents.map((component) => component.language))].sort(),
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
    await persistCompositions([row]);
  };
  const compositionWidth = Math.max(1, Math.trunc(Number(context.config.parallelism) || 1));
  await runSenseCompoundChoiceWaves(compositionSenses, {
    width: compositionWidth,
    resolveWave: async (wave) => {
      const waveGlosses = collectComponentGlosses(wave.flatMap((sense) => sourceTranslationsBySense.get(sense.senseId) ?? []));
      const lookupGlosses = [...new Set(waveGlosses.flatMap(componentGlossLookupAlternatives))];
      const uncachedLookupGlosses = lookupGlosses.filter((gloss) => !choicesByLookupGlossCache.has(normalizeGloss(gloss)));
      if (uncachedLookupGlosses.length > 0) {
        const { suggestionRecords, linkedWordNetSenses } = await runSenseCompoundVocabularyLookups(uncachedLookupGlosses, {
          chunkSize: 8,
          suggestVocabulary: context.dependencies.suggestVocabulary ?? runVocabSuggest
        });
        const resolvedChoices = buildKwonLinkedAtomicChoices({
          suggestions: suggestionRecords,
          linkedWordNetSenses,
          componentGlosses: uncachedLookupGlosses,
          activeAtomEntries: context.linkedAtomicSenses,
          layerByWord: context.layerIndex.byWord,
          deprecatedSurfaces: context.deprecatedSurfaces,
          wordnetIndex: context.allocation.wordnetIndex
        });
        for (const gloss of uncachedLookupGlosses) {
          choicesByLookupGlossCache.set(normalizeGloss(gloss), resolvedChoices.get(normalizeGloss(gloss)) ?? []);
        }
      }
      const choicesByLookupGloss = new Map(lookupGlosses.map((gloss) => [
        normalizeGloss(gloss), choicesByLookupGlossCache.get(normalizeGloss(gloss)) ?? []
      ]));
      const waveByGloss = mapComponentGlossChoices(waveGlosses, choicesByLookupGloss);
      for (const [gloss, choices] of waveByGloss) {
        const unique = new Map([...(byGloss.get(gloss) ?? []), ...choices].map((choice) => [
          `${text(choice?.linkedSense?.source)}\u0000${(choice?.pyashSequence ?? []).join("+")}`,
          choice
        ]));
        byGloss.set(gloss, [...unique.values()]);
      }
      return waveByGloss;
    },
    dispatch: composeOne
  });
  await compositionWrite;
  context.compositionRecords = compositionRecords;
  const uniqueCandidates = [...candidatesById.values()].sort((left, right) => left.frequencyRank - right.frequencyRank
    || right.frequencyTagCount - left.frequencyTagCount
    || left.id.localeCompare(right.id));
  const componentMappings = glosses.map((gloss) => ({
    id: `component-gloss-${hash(normalizeGloss(gloss)).slice(0, 24)}`,
    gloss,
    alternatives: componentGlossAlternatives(gloss),
    lookupAlternatives: componentGlossLookupAlternatives(gloss),
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
  await atomicWrite(candidatesPath, renderRowsPya(CANDIDATE_NAME, "wordnet-sense-derived-compound-candidates-v3", uniqueCandidates, {
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
    "source-sense-count": compositionSenses.length,
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
    let status = "failed";
    if (senseCandidates.length === 0) {
      if (!completeTranslation) {
        status = "failed";
      } else if (composition?.status === "uncertain") status = "uncertain";
      else if (composition?.status === "no-available-decomposition") status = "no-compound-candidate";
      else if (composition?.status === "failed" || composition?.status === "compound") status = "failed";
      else status = senseTranslation?.translations?.some((translation) => translation.composition === "uncertain")
        ? "uncertain"
        : "no-compound-candidate";
    } else if (senseDecisions.length > 0) {
      if (senseDecisions.some((decision) => acceptedDecision(decision)
        && ["promoted-to-derived-index", "already-active"].includes(decision.promotionStatus))) status = "accepted";
      else if (senseDecisions.some((decision) => decision.status === "uncertain-llm")) status = "uncertain";
      else if (senseDecisions.some((decision) => ["rejected-llm", "rejected-deterministic"].includes(decision.status))) status = "rejected";
    } else if (!completeTranslation) {
      status = "failed";
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
  const updatedRecords = worklistRows.map((sense) => bySense.get(sense.senseId)).filter(Boolean);
  await appendArtifactRows(context, path, PROGRESS_NAME, "wordnet-sense-compound-progress-v1", updatedRecords);
  context.sweepState.progressBySense = bySense;
  const remainingCount = (context.fullWorklist ?? []).filter((sense) => {
    const progress = bySense.get(sense.senseId);
    return !context.completedSenseIds?.has(sense.senseId) && !isProcessedProgress(progress);
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
    failed: 0,
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
    else if (status === "failed") counts.failed += 1;
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
    "failed-sense-count": counts.failed,
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
  const sweepState = context.sweepState;
  if (!(sweepState.decisionsById instanceof Map)) {
    const decisionState = context.dependencies.loadDecisions
      ? await context.dependencies.loadDecisions()
      : await loadEnglishWordNetCompoundDecisions();
    sweepState.decisionsById = new Map(decisionState.rows.map((record) => [record.candidateId, record]));
  }
  const decisionsById = sweepState.decisionsById;
  const persistDecisions = async (rows) => {
    if (rows.length === 0) return;
    if (typeof context.dependencies.saveDecisions === "function") {
      await context.dependencies.saveDecisions([...decisionsById.values()], decisionsPath);
      return;
    }
    let exists = false;
    try {
      exists = (await stat(decisionsPath)).size > 0;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    if (!exists) await atomicWrite(decisionsPath, renderEnglishWordNetCompoundDecisions([]));
    await appendFile(decisionsPath, rows.map(renderEnglishWordNetCompoundDecisionAppend).join(""), "utf8");
  };
  const usedTargetIds = allocatedTargetIds(context.allocation);
  const newDecisions = [];
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
    newDecisions.push(decision);
  }
  const candidateDecisions = candidateRows.map((candidate) => decisionsById.get(candidate.id)).filter(Boolean);
  await persistDecisions(newDecisions);
  const accepted = candidateDecisions.filter((record) => acceptedDecision(record));
  if (accepted.length > 0) {
    const promoted = await (context.dependencies.promoteAccepted ?? promoteAcceptedCompounds)(accepted, { usedTargetIds, decisionRevision });
    const changedPromotions = [];
    for (const decision of promoted.decisions) {
      const previous = decisionsById.get(decision.candidateId);
      decisionsById.set(decision.candidateId, decision);
      if (stableJson(previous ?? null) !== stableJson(decision)) changedPromotions.push(decision);
    }
    await persistDecisions(changedPromotions);
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
    "translation-failure-count": context.translationFailedSenseCount ?? 0,
    "translation-failed-language-count": context.translationFailures?.length ?? 0,
    "translation-failed-sense-count": context.translationFailedSenseCount ?? 0,
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
  config.minimumTagCount = resolveWordNetSenseCompoundMinimumTagCount(
    config.minimumTagCount,
    configuration.minimumTagCount
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
  const sweepState = dependencies.sweepState ?? {};
  if (sweepState.artifactDirectory && sweepState.artifactDirectory !== artifactDirectory) {
    throw invalid("sweep state cannot be reused for another artifact directory", {
      expected: artifactDirectory,
      actual: sweepState.artifactDirectory
    });
  }
  sweepState.artifactDirectory = artifactDirectory;
  const context = {
    config,
    dependencies,
    allocation,
    runId: stableRunId,
    artifactDirectory,
    sweepState,
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
    translationFailureCount: context.translationFailedSenseCount ?? 0,
    translationFailurePath: context.translationFailurePath ?? "",
    result,
    selectedSenseCount: context.worklist.length,
    remainingSenseCount: mapValue("sense compound decisions")["remaining-sense-count"]
      ?? mapValue("sense worklist")["remaining-sense-count"]
      ?? 0,
    candidateCount: mapValue("sense compound candidates")["candidate-count"] ?? 0
  };
}
