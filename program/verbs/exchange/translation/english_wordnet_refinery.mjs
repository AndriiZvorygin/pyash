import {
  loadDefaultEnglishSentenceResources
} from "./english_sentence.mjs";
import {
  buildEnglishWordNetSenseLinkInventory,
  buildEnglishWordNetSenseLinkRecords,
  loadEnglishWordNetLinkerConfig,
  submitEnglishWordNetSenseLinks
} from "./english_wordnet_linker.mjs";
import { lookupEnglish30kCoverage } from "./english30k_coverage.mjs";

export const ENGLISH_WORDNET_REFINERY_FORMAT = "english-wordnet-refinery-v1";

function invalid(message, details = {}) {
  const error = new Error(message);
  error.code = "invalid-english-wordnet-refinery";
  error.details = details;
  return error;
}

function text(value) {
  return typeof value === "string" ? value.normalize("NFC").trim() : "";
}

function accepted(status) {
  return ["accepted-existing", "accepted-edge", "accepted-deterministic", "accepted-llm"].includes(text(status));
}

export function collectEnglishWordNetSourceTerms(result) {
  if (!result || typeof result !== "object") throw invalid("WordNet refinery requires a translation result");
  if (!Array.isArray(result.vocabularyCandidates)) return [];
  return [...new Set(result.vocabularyCandidates
    .filter((candidate) => text(candidate?.kind) === "lexical-gap")
    .map((candidate) => text(candidate.surface).toLowerCase())
    .filter(Boolean))].sort();
}

function compoundResolver(compoundRecords = []) {
  const byTarget = new Map();
  for (const record of compoundRecords) {
    const target = text(record?.target).toLowerCase();
    const pyashSequence = Array.isArray(record?.pyashSequence)
      ? record.pyashSequence.filter((word) => typeof word === "string" && word.trim())
      : [];
    if (!target || pyashSequence.length === 0) continue;
    if (["accepted-delimited", "accepted-curated"].includes(text(record.status))) {
      byTarget.set(target, {
        coverageType: "compound",
        canonicalEnglish: target,
        pyashSequence
      });
    }
  }
  return byTarget;
}

function resolveWord(resources, compounds, word) {
  const target = text(word).toLowerCase();
  return compounds.get(target) ?? lookupEnglish30kCoverage(resources.coverage, target);
}

function counts(records) {
  return {
    senses: records.length,
    accepted: records.filter((record) => accepted(record.status)).length,
    leaf: records.filter((record) => record.status === "accepted-edge").length,
    deterministic: records.filter((record) => record.status === "accepted-deterministic").length,
    existing: records.filter((record) => record.status === "accepted-existing").length,
    review: records.filter((record) => record.status === "review").length,
    rejected: records.filter((record) => record.status === "rejected-llm").length,
    uncertain: records.filter((record) => record.status === "uncertain-llm").length
  };
}

function contextByTerm(result, terms) {
  const rows = new Map(terms.map((term) => [term, new Set()]));
  for (const record of result.records ?? []) {
    const sentences = [record?.source?.text, ...(record?.context ?? [])]
      .filter((value) => typeof value === "string" && value.trim())
      .map((value) => value.trim());
    const unresolved = new Set((record?.unresolved ?? []).map((value) => text(value).toLowerCase()));
    for (const term of terms) {
      if (!unresolved.has(term)) continue;
      const target = rows.get(term);
      for (const sentence of sentences) {
        if (target.size >= 4) break;
        target.add(sentence.slice(0, 1200));
      }
    }
  }
  return terms.map((term) => ({ term, sentences: [...(rows.get(term) ?? [])] }));
}

export async function refineEnglishWordNet({
  result,
  submit = null,
  resources = null,
  config = null,
  compoundRecords = [],
  sourceTerms = null
} = {}) {
  if (!result || typeof result !== "object" || text(result.language) !== "english") {
    throw invalid("WordNet refinery requires an English translation result");
  }
  const terms = sourceTerms ? [...new Set(sourceTerms.map((value) => text(value).toLowerCase()).filter(Boolean))].sort()
    : collectEnglishWordNetSourceTerms(result);
  if (terms.length === 0) {
    return {
      format: ENGLISH_WORDNET_REFINERY_FORMAT,
      sourceHash: text(result.sourceHash),
      sourceTerms: [],
      records: [],
      counts: counts([]),
      inventoryCount: 0,
      queue: null
    };
  }

  const loadedResources = resources ?? await loadDefaultEnglishSentenceResources();
  const linkerConfig = config ?? await loadEnglishWordNetLinkerConfig();
  const compounds = compoundResolver(compoundRecords);
  const records = buildEnglishWordNetSenseLinkRecords({
    wordnetIndex: loadedResources.wordnet?.index,
    resolveWord: (word) => resolveWord(loadedResources, compounds, word),
    sourceTerms: terms,
    limit: linkerConfig.maxBatch,
    edgeMaxDegree: linkerConfig.edgeMaxDegree
  });
  const inventory = buildEnglishWordNetSenseLinkInventory({
    records,
    grammarEntries: loadedResources.grammarCatalog?.entries ?? [],
    compoundRecords
  });
  const context = contextByTerm(result, terms);
  const queued = records.some((record) => !accepted(record.status)) && typeof submit === "function"
    ? await submitEnglishWordNetSenseLinks({
      records,
      inventory,
      sourceHash: text(result.sourceHash),
      context,
      maxChars: linkerConfig.promptMaxChars,
      maxTokens: linkerConfig.promptMaxTokens,
      submit
    })
    : null;
  const refinedRecords = queued?.records ?? records;
  return {
    format: ENGLISH_WORDNET_REFINERY_FORMAT,
    sourceHash: text(result.sourceHash),
    sourceTerms: terms,
    records: refinedRecords,
    context,
    counts: counts(refinedRecords),
    inventoryCount: inventory.entries.length,
    queue: queued?.queue ?? null,
    queues: queued?.queues ?? [],
    queueHandle: queued?.handleId ?? null,
    queuePending: queued?.pending?.length ?? refinedRecords.filter((record) => !accepted(record.status)).length
  };
}
