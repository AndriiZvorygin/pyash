import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

import { buildProgram } from "../../program.mjs";
import { interpret } from "../../bridge/index.mjs";
import { doRemember, remember } from "../../remember/index.mjs";
import { getRefinery, runRefinery } from "../../bridge/refinery.mjs";
import { writeVliwDatabaseFiles } from "../vliw/index.mjs";
import {
  lowerTranslationToPyac,
  projectTranslationSentence,
  renderTranslationPipelinePya,
  segmentTranslationDocument,
  translateDocumentSegments,
  loadEnglishResourceHashes,
  mergeTranslationArtifacts
} from "./translation_pipeline.mjs";
import {
  applyEnglishWordNetSenseAttachmentLinks,
  appendEnglishWordNetAttachmentCandidates,
  buildEnglishWordNetSelectedBridgeIndex,
  refineEnglishWordNet
} from "./english_wordnet_refinery.mjs";
import {
  reconcileTranslationVocabularyCandidates,
  submitTranslationVocabularyCandidates
} from "./translation_vocabulary_queue.mjs";
import {
  COMPOUND_TRANSLATION_LANGUAGES,
  ensureCompoundTranslations,
  selectCompoundDemands
} from "./compound_translation_cache.mjs";
import {
  translationOccurrenceKey
} from "./translation_occurrence.mjs";
import { inspectTranslationRefineryArtifacts } from "./translation_refinery_artifacts.mjs";

export const TRANSLATION_SOURCE_TO_VLIW_REFINERY_NAME = "translation source vliw";
export const TRANSLATION_SOURCE_TO_VLIW_REFINERY_URL = new URL(
  "./translation_to_vliw_refinery.pya",
  import.meta.url
);

let definitionPromise = null;

function invalid(message, details = {}) {
  const error = new Error(message);
  error.code = "invalid-translation-source-to-vliw-refinery";
  error.details = details;
  return error;
}

function text(value) {
  return typeof value === "string" ? value.normalize("NFC").trim() : "";
}

function sourceHash(value) {
  return createHash("sha256").update(String(value ?? "")).digest("hex");
}

function stableResourceHashes(value) {
  return JSON.stringify(Object.fromEntries(
    Object.entries(value ?? {}).sort(([left], [right]) => left.localeCompare(right))
  ));
}

function priorStageArtifacts(checkpointIndex) {
  const inspected = inspectTranslationRefineryArtifacts({
    checkpointIndex,
    refineryName: TRANSLATION_SOURCE_TO_VLIW_REFINERY_NAME
  });
  return new Map(inspected.stages.map((stage) => [stage.stage, stage.outputArtifact]));
}

function priorTranslationArtifact(stageArtifacts) {
  for (const stage of ["write outputs", "render translation", "refine compounds", "review vocabulary", "refine senses", "translate sentences"]) {
    const translation = stageArtifacts.get(stage)?.translation;
    if (translation) return translation;
  }
  return null;
}

function reusableCheckpointIndex({ checkpointIndex, source, resourceHashes }) {
  if (!(checkpointIndex instanceof Map) || checkpointIndex.size === 0) return checkpointIndex;
  const prior = priorTranslationArtifact(priorStageArtifacts(checkpointIndex));
  if (!prior || prior.sourceHash !== sourceHash(source)) return new Map();
  if (stableResourceHashes(prior.resourceHashes) !== stableResourceHashes(resourceHashes)) return new Map();
  return checkpointIndex;
}

function mergeStageTranslation(context, stage, translation) {
  const prior = context.priorStageArtifacts.get(stage)?.translation;
  return mergeTranslationArtifacts(translation, prior);
}

function occurrenceKey(record) {
  return translationOccurrenceKey({
    sourceRecordId: record?.sourceRecordId,
    tokenIndex: record?.tokenIndex
  }) || record?.occurrenceId || `${text(record?.sourceRecordId)}\u0000${text(record?.surface).toLowerCase()}`;
}

function selectedPartOfSpeech(record) {
  return text(
    record?.selectedSense?.pos
      ?? record?.sense?.pos
      ?? record?.link?.targetPartOfSpeech
  ).toLowerCase();
}

function selectedVerbMorphology(record) {
  if (selectedPartOfSpeech(record) !== "v") return null;
  const surface = text(record?.surface).toLowerCase();
  if (!surface.endsWith("s")) return null;
  return {
    kind: "finite-present",
    markerNames: ["present_tense_"],
    markerSequence: ["ra"],
    certainty: "deterministic",
    evidence: "English third-person present surface selected for a WordNet verb sense"
  };
}

export function occurrenceCoverageOverrides(records = [], { coverageType = "semantic-wordnet" } = {}) {
  const overrides = new Map();
  for (const record of records) {
    const key = occurrenceKey(record);
    const target = text(record?.link?.target || record?.targetEnglish || record?.surface).toLowerCase();
    const sequence = Array.isArray(record?.link?.pyashSequence)
      ? record.link.pyashSequence
      : record?.pyashSequence;
    if (!key || !target || !Array.isArray(sequence) || sequence.length === 0) continue;
    const morphology = selectedVerbMorphology(record);
    const lexicalSequence = morphology
      ? sequence.filter((word) => word !== "pu")
      : sequence;
    overrides.set(key, {
      coverageType,
      canonicalEnglish: target,
      lemma: target,
      pyashSequence: [...lexicalSequence],
      ...(morphology ? { morphology } : {})
    });
  }
  return overrides;
}

function mapFact(name, map) {
  const cleanMap = Object.fromEntries(
    Object.entries(map ?? {}).filter(([, value]) => value !== null && value !== undefined)
  );
  return {
    mood: "ya",
    su: { name },
    be: "map",
    ob: { map: cleanMap }
  };
}

function mapValue(name) {
  return remember(name)?.ob?.map ?? {};
}

function outputName(sentence) {
  const name = text(sentence?.to?.name);
  if (!name) throw invalid("translation refinery stage requires a map output", { sentence });
  return name;
}

function sourceInput(context) {
  return {
    language: context.language,
    source: context.source,
    locator: context.locator,
    sourcePath: context.sourcePath,
    paths: context.paths,
    resourceHashes: context.resourceHashes
  };
}

async function refineSenses(context, translated) {
  if (!context.wordnetRefinery || translated.language !== "english") {
    return { translation: translated, wordnet: null };
  }
  const sourceTranslation = translated.senseStateFormat
    ? translated
    : await translateDocumentSegments({
      language: translated.language,
      text: context.source,
      segments: context.sourceSegments,
      locator: translated.locator,
      contextRadius: context.contextRadius,
      verify: context.verify,
      resourceHashes: translated.resourceHashes,
      adapterResolver: context.adapterResolver
    });
  const wordnet = await refineEnglishWordNet({
    result: sourceTranslation,
    submit: context.wordnetRefinery.submit,
    resources: context.wordnetRefinery.resources,
    config: context.wordnetRefinery.config,
    compoundRecords: context.wordnetRefinery.compoundRecords,
    sourceTerms: context.wordnetRefinery.sourceTerms,
    awaitHandle: context.wordnetRefinery.awaitHandle,
    suggestVocabulary: context.wordnetRefinery.suggestVocabulary,
    maxRepairAttempts: context.wordnetRefinery.maxRepairAttempts
  });
  const wordnetBridges = buildEnglishWordNetSelectedBridgeIndex(wordnet.records);
  const acceptedRecords = wordnet.records.filter((record) => [
    "accepted-existing", "accepted-edge", "accepted-deterministic", "accepted-llm"
  ].includes(record.status));
  const occurrenceOverrides = occurrenceCoverageOverrides(acceptedRecords);
  const acceptedRecordKeys = new Set(wordnet.records
    .filter((record) => acceptedRecords.includes(record))
    .map(occurrenceKey));
  const blockedRecordKeys = new Set(wordnet.records
    .filter((record) => record.status === "error")
    .map(occurrenceKey));
  const hasAcceptedLinks = acceptedRecords.length > 0;
  const closedLoopTranslation = hasAcceptedLinks
    ? await translateDocumentSegments({
      language: sourceTranslation.language,
      text: context.source,
      segments: context.sourceSegments,
      locator: sourceTranslation.locator,
      contextRadius: context.contextRadius,
      verify: context.verify,
      resourceHashes: sourceTranslation.resourceHashes,
      adapterResolver: context.adapterResolver,
      wordnetBridges,
      occurrenceOverrides
    })
    : sourceTranslation;
  const filteredVocabulary = (closedLoopTranslation.vocabularyCandidates ?? []).filter((candidate) => {
    const key = occurrenceKey(candidate);
    return !blockedRecordKeys.has(key) && !acceptedRecordKeys.has(key);
  });
  const attachedTranslation = appendEnglishWordNetAttachmentCandidates({
    ...closedLoopTranslation,
    vocabularyCandidates: filteredVocabulary,
    ...(wordnet.errors?.length > 0 ? { errors: wordnet.errors } : {})
  }, wordnet.records);
  return {
    translation: { ...attachedTranslation, wordnet },
    wordnet
  };
}

async function reviewVocabulary(context, translated) {
  const queued = context.queueVocabulary
    ? await submitTranslationVocabularyCandidates({
      result: translated,
      sourceText: context.source,
      submit: context.queueVocabulary
    })
    : {
      result: translated,
      submitted: false,
      submittedCount: 0,
      handleId: ""
    };
  let settled = null;
  if (queued.submitted && typeof context.awaitVocabulary === "function") {
    let current = queued.result;
    const batches = queued.batches ?? [queued.candidates];
    const queues = queued.queues ?? (queued.handleId ? [{ handleId: queued.handleId }] : []);
    const settlements = [];
    for (let index = 0; index < batches.length; index += 1) {
      const duty = batches[index];
      const queue = queues[index];
      if (!Array.isArray(duty) || duty.length === 0 || !queue?.handleId) continue;
      const settlement = await reconcileTranslationVocabularyCandidates({
        result: current,
        sourceText: context.source,
        candidates: duty,
        handleId: queue.handleId,
        awaitHandle: context.awaitVocabulary,
        submit: context.queueVocabulary
      });
      current = settlement.result;
      settlements.push(settlement);
    }
    if (settlements.length > 0) {
      const outcomes = settlements.map((settlement) => settlement.queue?.outcome);
      settled = {
        result: current,
        response: settlements.map((settlement) => settlement.response),
        queues: settlements.map((settlement) => settlement.queue).filter(Boolean),
        queue: settlements.length === 1
          ? settlements[0].queue
          : {
            ...(current.vocabularyQueue ?? {}),
            status: "complete",
            outcome: outcomes.every((outcome) => outcome === "applied")
              ? "applied"
              : outcomes.some((outcome) => outcome === "uncertain")
                ? "uncertain"
                : "partial"
          }
      };
    }
  }
  const reviewedTranslation = settled?.result ?? queued.result;
  const linkedTranslation = applyEnglishWordNetSenseAttachmentLinks(reviewedTranslation);
  const accepted = linkedTranslation.vocabularyCandidates
    .filter((candidate) => candidate.status === "accepted-llm"
      && Array.isArray(candidate.pyashSequence)
      && candidate.pyashSequence.length > 0);
  const coverageOverrides = new Map(accepted.map((candidate) => [
    text(candidate.surface).toLowerCase(),
    {
      coverageType: "llm",
      canonicalEnglish: text(candidate.targetEnglish || candidate.surface).toLowerCase(),
      pyashSequence: [...candidate.pyashSequence]
    }
  ]));
  const occurrenceOverrides = occurrenceCoverageOverrides(accepted, { coverageType: "llm" });
  const acceptedWordNetRecords = linkedTranslation.wordnet?.records
    ?.filter((record) => [
      "accepted-existing", "accepted-edge", "accepted-deterministic", "accepted-llm"
    ].includes(record.status))
    ?? [];
  const wordNetOccurrenceOverrides = occurrenceCoverageOverrides(acceptedWordNetRecords);
  const allOccurrenceOverrides = new Map(wordNetOccurrenceOverrides);
  for (const [key, value] of occurrenceOverrides) allOccurrenceOverrides.set(key, value);
  const closedLoopTranslation = accepted.length > 0
    ? await translateDocumentSegments({
      language: linkedTranslation.language,
      text: context.source,
      segments: context.sourceSegments,
      locator: linkedTranslation.locator,
      contextRadius: context.contextRadius,
      verify: context.verify,
      resourceHashes: linkedTranslation.resourceHashes,
      adapterResolver: context.adapterResolver,
      wordnetBridges: linkedTranslation.wordnet
        ? buildEnglishWordNetSelectedBridgeIndex(linkedTranslation.wordnet.records)
        : null,
      coverageOverrides,
      occurrenceOverrides: allOccurrenceOverrides
    })
    : reviewedTranslation;
  return {
    translation: {
      ...closedLoopTranslation,
      vocabularyCandidates: linkedTranslation.vocabularyCandidates,
      ...(linkedTranslation.wordnet ? { wordnet: linkedTranslation.wordnet } : {})
    },
    queued,
    settled
  };
}

async function refineCompounds(context, translated) {
  if (!context.compoundTranslation) {
    return { translation: translated, compoundCache: null };
  }
  const compoundTranslation = context.compoundTranslation;
  const compoundDemands = selectCompoundDemands(
    context.source,
    compoundTranslation.records ?? []
  );
  const compoundCache = await ensureCompoundTranslations({
    compounds: compoundDemands,
    languages: compoundTranslation.languages ?? COMPOUND_TRANSLATION_LANGUAGES,
    cachePath: compoundTranslation.cachePath,
    translate: compoundTranslation.translate,
    context: translated.records.map((record) => record.source.text),
    onEvent: compoundTranslation.onEvent
  });
  return { translation: translated, compoundCache };
}

function buildCommandResult(context, translation, database, compoundCache) {
  const wordnet = translation.wordnet;
  const vocabulary = context.vocabulary ?? {};
  const sentences = translation.records.map((record) => ({
    original: record.source?.text ?? "",
    ...projectTranslationSentence(record),
    status: record.status
  }));
  return {
    command: "translate-document",
    language: translation.language,
    source: context.sourcePath ?? context.locator,
    translation: context.paths.translation,
    catalog: context.paths.catalog,
    pack: context.paths.pack,
    records: translation.records.length,
    resolved: translation.counts.resolved,
    provisional: translation.counts.provisional,
    unresolved: translation.counts.unresolved,
    sentences,
    vocabularyCandidates: translation.vocabularyCandidates.length,
    vocabularySubmitted: vocabulary.queued?.submittedCount ?? 0,
    vocabularyQueueHandle: vocabulary.queued?.handleId || null,
    vocabularyQueueHandles: vocabulary.queued?.handleIds ?? [],
    vocabularyOutcome: vocabulary.settled?.queue?.outcome
      ?? vocabulary.queued?.result?.vocabularyQueue?.status
      ?? null,
    wordnetDecisions: wordnet?.counts.decisions ?? 0,
    wordnetAmbiguous: wordnet?.counts.ambiguous ?? 0,
    wordnetSelected: wordnet?.counts.selected ?? 0,
    wordnetSenseRecords: wordnet?.counts.senses ?? 0,
    wordnetAccepted: wordnet?.counts.accepted ?? 0,
    wordnetLeafLinks: wordnet?.counts.leaf ?? 0,
    wordnetDeterministicLinks: wordnet?.counts.deterministic ?? 0,
    wordnetUnresolved: wordnet?.counts.unresolved ?? 0,
    wordnetQueuePending: wordnet?.queues?.filter((queue) => queue.status !== "complete").length ?? 0,
    wordnetPending: wordnet?.queues?.filter((queue) => queue.status !== "complete").length ?? 0,
    wordnetErrors: wordnet?.counts.errors ?? 0,
    wordnetQueueHandle: wordnet?.queueHandle ?? null,
    wordnetQueueHandles: wordnet?.queues?.map((queue) => queue.handleId) ?? [],
    compoundRequests: compoundCache?.requested ?? 0,
    compoundCacheHits: compoundCache?.counts.hits ?? 0,
    compoundTranslations: compoundCache?.counts.translated ?? 0,
    compoundTranslationPartials: compoundCache?.counts.partial ?? 0,
    compoundTranslationFailures: compoundCache?.counts.failed ?? 0,
    compoundTranslationCache: compoundCache?.cachePath ?? null,
    executable: database.catalog.executableCount,
    unsupported: database.catalog.unsupportedCount,
    packHash: database.catalog.packHash
  };
}

async function runStage(sentence, context) {
  if (sentence?.be !== "translation stage") {
    throw invalid("translation source-to-VLIW refinery received an unknown stage", { sentence });
  }
  const stage = text(sentence?.su?.name);
  const output = outputName(sentence);
  context.onStage?.(stage);
  let result;

  if (stage === "read source") {
    result = { input: sourceInput(context) };
  } else if (stage === "segment source") {
    const input = mapValue("source input").input ?? sourceInput(context);
    result = { segments: segmentTranslationDocument(input.source) };
  } else if (stage === "translate sentences") {
    const input = mapValue("source input").input ?? sourceInput(context);
    const segments = mapValue("source segments").segments ?? [];
    const translated = await translateDocumentSegments({
      language: input.language,
      text: input.source,
      segments,
      locator: input.locator,
      contextRadius: context.contextRadius,
      verify: context.verify,
      resourceHashes: context.resourceHashes,
      adapterResolver: context.adapterResolver
    });
    result = {
      translation: mergeStageTranslation(context, stage, translated)
    };
  } else if (stage === "refine senses") {
    const translated = mergeStageTranslation(
      context,
      stage,
      mapValue("translated document").translation
    );
    context.sourceSegments = mapValue("source segments").segments ?? segmentTranslationDocument(context.source);
    result = await refineSenses(context, translated);
  } else if (stage === "review vocabulary") {
    const translated = mergeStageTranslation(
      context,
      stage,
      mapValue("sensed document").translation
    );
    const reviewed = await reviewVocabulary(context, translated);
    context.vocabulary = reviewed;
    result = reviewed;
  } else if (stage === "refine compounds") {
    const reviewed = mapValue("reviewed document");
    const translated = mergeStageTranslation(context, stage, reviewed.translation);
    context.vocabulary = {
      queued: reviewed.queued,
      settled: reviewed.settled
    };
    const enriched = await refineCompounds(context, translated);
    context.compoundCache = enriched.compoundCache;
    result = enriched;
  } else if (stage === "render translation") {
    const enriched = mapValue("enriched document");
    const translated = enriched.translation;
    context.compoundCache = enriched.compoundCache ?? context.compoundCache;
    result = {
      translation: translated,
      translationPya: renderTranslationPipelinePya(translated)
    };
  } else if (stage === "lower vliw") {
    const artifact = mapValue("translation artifact");
    result = {
      translation: artifact.translation,
      translationPya: artifact.translationPya,
      database: lowerTranslationToPyac(artifact.translation)
    };
  } else if (stage === "write outputs") {
    const artifact = mapValue("translation artifact");
    const database = mapValue("vliw database").database;
    const reviewed = mapValue("reviewed document");
    const enriched = mapValue("enriched document");
    context.vocabulary = {
      queued: reviewed.queued,
      settled: reviewed.settled
    };
    context.compoundCache = enriched.compoundCache ?? context.compoundCache;
    await writeFile(context.paths.translation, artifact.translationPya, "utf8");
    writeVliwDatabaseFiles(database, {
      catalogPath: context.paths.catalog,
      packPath: context.paths.pack
    });
    const resultSummary = buildCommandResult(
      context,
      artifact.translation,
      database,
      context.compoundCache
    );
    result = {
      result: resultSummary,
      translation: artifact.translation,
      translationPya: artifact.translationPya,
      database,
      compoundCache: context.compoundCache
    };
    context.result = resultSummary;
    context.translation = artifact.translation;
    context.database = database;
  } else {
    throw invalid("translation source-to-VLIW refinery stage is missing", { stage });
  }

  const fact = mapFact(output, result);
  doRemember(fact);
  return fact;
}

export async function ensureTranslationSourceToVliwRefinery({ interpretFn = interpret } = {}) {
  if (getRefinery(TRANSLATION_SOURCE_TO_VLIW_REFINERY_NAME)) {
    return getRefinery(TRANSLATION_SOURCE_TO_VLIW_REFINERY_NAME);
  }
  if (!definitionPromise) {
    definitionPromise = readFile(TRANSLATION_SOURCE_TO_VLIW_REFINERY_URL, "utf8")
      .then((source) => buildProgram(source).sentences)
      .then(async (sentences) => {
        for (const sentence of sentences) await interpretFn(sentence);
        const refinery = getRefinery(TRANSLATION_SOURCE_TO_VLIW_REFINERY_NAME);
        if (!refinery) throw invalid("translation source-to-VLIW refinery definition was not registered");
        return refinery;
      })
      .catch((error) => {
        definitionPromise = null;
        throw error;
      });
  }
  return definitionPromise;
}

export async function runTranslationSourceToVliwRefinery({
  language,
  source,
  locator = "",
  sourcePath = locator,
  paths = {},
  contextRadius = 1,
  verify,
  resourceHashes,
  adapterResolver,
  queueVocabulary = null,
  awaitVocabulary = null,
  wordnetRefinery = null,
  compoundTranslation = null,
  interpretFn = interpret,
  runId = process.env.PYA_RUN_ID || null,
  checkpointIndex,
  checkpointEnabled = true,
  retryConfig,
  onEvoke,
  onStage,
  onCheckpoint,
  onRetry
} = {}) {
  const normalizedLanguage = text(language).toLowerCase();
  if (!normalizedLanguage) throw invalid("translation refinery requires a language");
  if (typeof source !== "string") throw invalid("translation refinery requires source text");
  const outputPaths = {
    translation: text(paths.translation),
    catalog: text(paths.catalog),
    pack: text(paths.pack)
  };
  if (Object.values(outputPaths).some((value) => !value)) {
    throw invalid("translation refinery requires translation, catalog, and pack paths", { paths });
  }

  const resolvedResourceHashes = resourceHashes
    ?? (normalizedLanguage === "english" ? await loadEnglishResourceHashes() : {});
  const stageArtifacts = priorStageArtifacts(checkpointIndex);
  const effectiveCheckpointIndex = reusableCheckpointIndex({
    checkpointIndex,
    source,
    resourceHashes: resolvedResourceHashes
  });

  await ensureTranslationSourceToVliwRefinery({ interpretFn });
  const context = {
    language: normalizedLanguage,
    source,
    locator: text(locator),
    sourcePath: text(sourcePath),
    paths: outputPaths,
    sourceSegments: segmentTranslationDocument(source),
    contextRadius,
    verify,
    resourceHashes: resolvedResourceHashes,
    adapterResolver,
    queueVocabulary,
    awaitVocabulary,
    wordnetRefinery,
    compoundTranslation,
    vocabulary: null,
    compoundCache: null,
    result: null,
    translation: null,
    database: null,
    priorStageArtifacts: stageArtifacts,
    onStage
  };

  const refineryResult = await runRefinery({
    name: TRANSLATION_SOURCE_TO_VLIW_REFINERY_NAME,
    interpret: (sentence) => runStage(sentence, context),
    runId,
    checkpointIndex: effectiveCheckpointIndex,
    checkpointEnabled,
    retryConfig,
    onEvoke,
    onCheckpoint,
    onRetry
  });

  if (refineryResult?.mood === "ya" && refineryResult?.be === "error") {
    throw new Error(refineryResult.ob?.text || "translation refinery failed");
  }

  const manifest = mapValue("output manifest");
  const translation = context.translation ?? manifest.translation;
  const database = context.database ?? manifest.database;
  const result = context.result ?? manifest.result;
  if (!translation || !database || !result) {
    throw invalid("translation refinery completed without an output manifest");
  }
  return {
    translation,
    database,
    compoundCache: context.compoundCache ?? manifest.compoundCache ?? null,
    result
  };
}

