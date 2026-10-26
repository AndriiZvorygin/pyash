import { readFile, writeFile } from "node:fs/promises";

import { buildProgram } from "../../../program.mjs";
import { interpret } from "../../../bridge/index.mjs";
import { doRemember, remember } from "../../../remember/index.mjs";
import { getRefinery, runRefinery } from "../../../bridge/refinery.mjs";
import { writeVliwDatabaseFiles } from "../../../library/vliw/index.mjs";
import {
  lowerTranslationToPyac,
  renderTranslationPipelinePya,
  segmentTranslationDocument,
  translateDocumentSegments
} from "./translation_pipeline.mjs";
import {
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

function occurrenceKey(recordId, surface) {
  return `${text(recordId)}\u0000${text(surface).toLowerCase()}`;
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
    paths: context.paths
  };
}

async function refineSenses(context, translated) {
  if (!context.wordnetRefinery || translated.language !== "english") {
    return { translation: translated, wordnet: null };
  }
  const wordnet = await refineEnglishWordNet({
    result: translated,
    submit: context.wordnetRefinery.submit,
    resources: context.wordnetRefinery.resources,
    config: context.wordnetRefinery.config,
    compoundRecords: context.wordnetRefinery.compoundRecords,
    sourceTerms: context.wordnetRefinery.sourceTerms,
    awaitHandle: context.wordnetRefinery.awaitHandle,
    maxRepairAttempts: context.wordnetRefinery.maxRepairAttempts
  });
  const wordnetBridges = buildEnglishWordNetSelectedBridgeIndex(wordnet.records);
  const acceptedRecordKeys = new Set(wordnet.records
    .filter((record) => ["accepted-existing", "accepted-edge", "accepted-deterministic", "accepted-llm"].includes(record.status))
    .map((record) => occurrenceKey(record.sourceRecordId, record.surface)));
  const blockedRecordKeys = new Set(wordnet.records
    .filter((record) => record.status === "error")
    .map((record) => occurrenceKey(record.sourceRecordId, record.surface)));
  const hasAcceptedLinks = wordnet.records.some((record) => [
    "accepted-existing", "accepted-edge", "accepted-deterministic", "accepted-llm"
  ].includes(record.status));
  const closedLoopTranslation = hasAcceptedLinks
    ? await translateDocumentSegments({
      language: translated.language,
      text: context.source,
      segments: context.sourceSegments,
      locator: translated.locator,
      contextRadius: context.contextRadius,
      verify: context.verify,
      resourceHashes: translated.resourceHashes,
      adapterResolver: context.adapterResolver,
      wordnetBridges
    })
    : translated;
  const filteredVocabulary = (closedLoopTranslation.vocabularyCandidates ?? []).filter((candidate) => {
    const key = occurrenceKey(candidate.sourceRecordId, candidate.surface);
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
  const accepted = reviewedTranslation.vocabularyCandidates
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
  const closedLoopTranslation = accepted.length > 0
    ? await translateDocumentSegments({
      language: reviewedTranslation.language,
      text: context.source,
      segments: context.sourceSegments,
      locator: reviewedTranslation.locator,
      contextRadius: context.contextRadius,
      verify: context.verify,
      resourceHashes: reviewedTranslation.resourceHashes,
      adapterResolver: context.adapterResolver,
      wordnetBridges: reviewedTranslation.wordnet
        ? buildEnglishWordNetSenseBridgeIndex(
          reviewedTranslation.wordnet.records.filter((record) => record.status === "accepted-llm")
        )
        : null,
      coverageOverrides
    })
    : reviewedTranslation;
  return {
    translation: {
      ...closedLoopTranslation,
      vocabularyCandidates: reviewedTranslation.vocabularyCandidates,
      ...(reviewedTranslation.wordnet ? { wordnet: reviewedTranslation.wordnet } : {})
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
  let result;

  if (stage === "read source") {
    result = { input: sourceInput(context) };
  } else if (stage === "segment source") {
    const input = mapValue("source input").input ?? sourceInput(context);
    result = { segments: segmentTranslationDocument(input.source) };
  } else if (stage === "translate sentences") {
    const input = mapValue("source input").input ?? sourceInput(context);
    const segments = mapValue("source segments").segments ?? [];
    result = {
      translation: await translateDocumentSegments({
        language: input.language,
        text: input.source,
        segments,
        locator: input.locator,
        contextRadius: context.contextRadius,
        verify: context.verify,
        resourceHashes: context.resourceHashes,
        adapterResolver: context.adapterResolver
      })
    };
  } else if (stage === "refine senses") {
    const translated = mapValue("translated document").translation;
    context.sourceSegments = mapValue("source segments").segments ?? segmentTranslationDocument(context.source);
    result = await refineSenses(context, translated);
  } else if (stage === "review vocabulary") {
    const translated = mapValue("sensed document").translation;
    const reviewed = await reviewVocabulary(context, translated);
    context.vocabulary = reviewed;
    result = reviewed;
  } else if (stage === "refine compounds") {
    const reviewed = mapValue("reviewed document");
    const translated = reviewed.translation;
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
    resourceHashes,
    adapterResolver,
    queueVocabulary,
    awaitVocabulary,
    wordnetRefinery,
    compoundTranslation,
    vocabulary: null,
    compoundCache: null,
    result: null,
    translation: null,
    database: null
  };

  await runRefinery({
    name: TRANSLATION_SOURCE_TO_VLIW_REFINERY_NAME,
    interpret: (sentence) => runStage(sentence, context),
    runId,
    checkpointIndex,
    checkpointEnabled,
    retryConfig,
    onEvoke,
    onCheckpoint,
    onRetry
  });

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

