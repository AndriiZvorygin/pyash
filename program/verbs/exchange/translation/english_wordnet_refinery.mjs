import {
  analyzeEnglishSentence,
  loadDefaultEnglishSentenceResources,
  selectEnglishWordNetSenses
} from "./english_sentence.mjs";
import {
  buildEnglishWordNetSenseBridgeIndex,
  linkEnglishWordNetSense,
  loadEnglishWordNetLinkerConfig
} from "./english_wordnet_linker.mjs";
import {
  buildEnglishWordNetSenseSelectionPrompt,
  englishWordNetSelectionId,
  englishWordNetSelectionQueueHandle,
  selectEnglishWordNetSense
} from "./english_wordnet_selection.mjs";
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

function normalized(value) {
  return text(value).toLowerCase();
}

function accepted(status) {
  return ["accepted-existing", "accepted-edge", "accepted-deterministic", "accepted-llm"]
    .includes(text(status));
}

export function collectEnglishWordNetSourceTerms(result) {
  if (!result || typeof result !== "object") throw invalid("WordNet refinery requires a translation result");
  if (!Array.isArray(result.vocabularyCandidates)) return [];
  return [...new Set(result.vocabularyCandidates
    .filter((candidate) => text(candidate?.kind) === "lexical-gap")
    .map((candidate) => normalized(candidate.surface))
    .filter(Boolean))].sort();
}

function compoundResolver(compoundRecords = []) {
  const byTarget = new Map();
  for (const record of compoundRecords) {
    const target = normalized(record?.target);
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
  const target = normalized(word);
  return compounds.get(target) ?? lookupEnglish30kCoverage(resources.coverage, target);
}

function emptyGrammarIndex() {
  return { resolve: () => null };
}

function counts(records, decisions) {
  return {
    decisions: decisions.length,
    ambiguous: decisions.filter((decision) => decision.senses.length > 1).length,
    selected: records.filter((record) => record.selectedSenseId).length,
    senses: records.length,
    accepted: records.filter((record) => accepted(record.status)).length,
    leaf: records.filter((record) => record.status === "accepted-edge").length,
    deterministic: records.filter((record) => record.status === "accepted-deterministic").length,
    existing: records.filter((record) => record.status === "accepted-existing").length,
    review: records.filter((record) => record.status === "review").length,
    rejected: records.filter((record) => record.status === "rejected-llm").length,
    uncertain: records.filter((record) => record.status === "uncertain-llm").length,
    errors: records.filter((record) => record.status === "error").length,
    unresolved: records.filter((record) => !accepted(record.status)).length
  };
}

function occurrenceDecisions(result, resources, compounds, terms) {
  const decisions = [];
  const termSet = new Set(terms);
  for (const sourceRecord of result.records ?? []) {
    const sentence = text(sourceRecord?.source?.text);
    const unresolved = new Set((sourceRecord?.unresolved ?? []).map(normalized));
    if (!sentence || unresolved.size === 0) continue;
    const analysis = analyzeEnglishSentence(sentence, {
      resolveWord: (word) => resolveWord(resources, compounds, word),
      lemmaEntries: resources.lemmaCatalog?.entries ?? [],
      grammarIndex: resources.grammarIndex ?? emptyGrammarIndex(),
      wordnetIndex: resources.wordnet?.index
    });
    for (const [tokenIndex, token] of analysis.tokens.entries()) {
      const surface = normalized(token?.surface);
      if (!surface || !termSet.has(surface) || !unresolved.has(surface)) continue;
      const selection = selectEnglishWordNetSenses(
        token,
        analysis.tokens,
        tokenIndex,
        resources.wordnet?.index
      );
      if (!Array.isArray(selection.senses) || selection.senses.length === 0) continue;
      const id = englishWordNetSelectionId({
        sourceHash: result.sourceHash,
        sourceRecordId: sourceRecord.id,
        tokenIndex,
        surface
      });
      decisions.push({
        id,
        sourceRecordId: sourceRecord.id,
        sentenceIndex: sourceRecord.source.sentenceIndex,
        tokenIndex,
        surface,
        sentence,
        senses: selection.senses,
        selectionEvidence: selection.evidence
      });
    }
  }
  return decisions;
}

async function queueSelectionWithoutAwait({ decision, sourceHash, submit, config }) {
  const handleId = englishWordNetSelectionQueueHandle({ sourceHash, decisionId: decision.id });
  const prompt = buildEnglishWordNetSenseSelectionPrompt({
    surface: decision.surface,
    sentence: decision.sentence,
    senses: decision.senses,
    maxChars: config.promptMaxChars,
    maxTokens: config.promptMaxTokens
  });
  const response = await submit({
    handleId,
    prompt,
    candidates: decision.senses,
    sourceHash,
    maxOutputTokens: config.selectionMaxOutputTokens ?? config.maxOutputTokens
  });
  if (normalized(response?.status || response?.ob?.text) !== "queued") {
    throw invalid("WordNet selection queue submission was not accepted", { handleId, response });
  }
  return {
    decision,
    queue: {
      handleId,
      status: "queued",
      senseCount: decision.senses.length
    }
  };
}

function selectedDecisionRecord(decision, sense, selection = {}) {
  return {
    ...decision,
    selectedSenseId: `${text(sense?.pos)}:${text(sense?.synset)}`,
    selectedSense: sense,
    selectionConfidence: selection.confidence || "deterministic",
    selectionRationale: selection.rationale || decision.selectionEvidence || "deterministic WordNet sense selection"
  };
}

function attachmentCandidate(record) {
  if (record.status !== "review" || !record.selectedSense) return null;
  return {
    id: `wordnet-attachment:${record.id}`,
    surface: record.surface,
    kind: "wordnet-sense-attachment",
    sourceRecordId: record.sourceRecordId,
    context: [record.sentence],
    evidence: [
      `selected WordNet sense ${record.selectedSenseId}`,
      record.selectedSense.gloss,
      record.selectionRationale
    ].filter(Boolean).join("; ")
  };
}

export function appendEnglishWordNetAttachmentCandidates(translation, records) {
  const attachments = records.map(attachmentCandidate).filter(Boolean);
  if (attachments.length === 0) return translation;
  const selectedKeys = new Set(attachments.map((candidate) => `${candidate.sourceRecordId}\u0000${candidate.surface}`));
  const existing = (translation.vocabularyCandidates ?? []).filter((candidate) => (
    !selectedKeys.has(`${candidate.sourceRecordId}\u0000${normalized(candidate.surface)}`)
  ));
  return {
    ...translation,
    vocabularyCandidates: [...existing, ...attachments]
  };
}

export async function refineEnglishWordNet({
  result,
  submit = null,
  resources = null,
  config = null,
  compoundRecords = [],
  sourceTerms = null,
  awaitHandle = null,
  maxRepairAttempts = 1
} = {}) {
  if (!result || typeof result !== "object" || text(result.language) !== "english") {
    throw invalid("WordNet refinery requires an English translation result");
  }
  const terms = sourceTerms
    ? [...new Set(sourceTerms.map(normalized).filter(Boolean))].sort()
    : collectEnglishWordNetSourceTerms(result);
  if (terms.length === 0) {
    return {
      format: ENGLISH_WORDNET_REFINERY_FORMAT,
      sourceHash: text(result.sourceHash),
      sourceTerms: [],
      decisions: [],
      records: [],
      counts: counts([], []),
      inventoryCount: 0,
      queue: null,
      queues: [],
      errors: []
    };
  }

  const loadedResources = resources ?? await loadDefaultEnglishSentenceResources();
  const linkerConfig = config ?? await loadEnglishWordNetLinkerConfig();
  const compounds = compoundResolver(compoundRecords);
  const decisions = occurrenceDecisions(result, loadedResources, compounds, terms);
  const records = [];
  const queues = [];
  const errors = [];
  for (const decision of decisions) {
    try {
      let selected = decision.senses.length === 1
        ? selectedDecisionRecord(decision, decision.senses[0])
        : null;
      if (!selected && typeof submit === "function" && typeof awaitHandle === "function") {
        const outcome = await selectEnglishWordNetSense({
          decision,
          sourceHash: text(result.sourceHash),
          submit,
          awaitHandle,
          maxChars: linkerConfig.promptMaxChars,
          maxTokens: linkerConfig.promptMaxTokens,
          maxOutputTokens: linkerConfig.selectionMaxOutputTokens ?? linkerConfig.maxOutputTokens,
          maxRepairAttempts
        });
        queues.push(outcome.queue);
        if (outcome.error) {
          const errorRecord = {
            ...decision,
            status: "error",
            queue: outcome.queue,
            error: outcome.error
          };
          records.push(errorRecord);
          errors.push({ id: decision.id, surface: decision.surface, error: outcome.error });
          continue;
        }
        selected = selectedDecisionRecord(decision, outcome.sense, outcome);
      } else if (!selected && typeof submit === "function") {
        const outcome = await queueSelectionWithoutAwait({
          decision,
          sourceHash: text(result.sourceHash),
          submit,
          config: linkerConfig
        });
        queues.push(outcome.queue);
        records.push({ ...decision, status: "review", queue: outcome.queue });
        continue;
      }
      if (!selected) {
        const error = "ambiguous WordNet sense requires a selector";
        records.push({ ...decision, status: "error", error });
        errors.push({ id: decision.id, surface: decision.surface, error });
        continue;
      }
      const linked = linkEnglishWordNetSense({
        sense: selected.selectedSense,
        sourceTerm: selected.surface,
        resolveWord: (word) => resolveWord(loadedResources, compounds, word),
        wordnetIndex: loadedResources.wordnet?.index,
        edgeMaxDegree: linkerConfig.edgeMaxDegree
      });
      records.push({
        ...linked,
        decisionId: selected.id,
        sourceRecordId: selected.sourceRecordId,
        sentenceIndex: selected.sentenceIndex,
        tokenIndex: selected.tokenIndex,
        surface: selected.surface,
        sentence: selected.sentence,
        selectedSenseId: selected.selectedSenseId,
        selectedSense: selected.selectedSense,
        selectionConfidence: selected.selectionConfidence,
        selectionRationale: selected.selectionRationale
      });
    } catch (caught) {
      const error = caught?.message || String(caught);
      records.push({ ...decision, status: "error", error });
      errors.push({ id: decision.id, surface: decision.surface, error });
    }
  }
  const context = decisions.map((decision) => ({
    term: decision.surface,
    sentence: decision.sentence,
    sentenceIndex: decision.sentenceIndex,
    tokenIndex: decision.tokenIndex
  }));
  return {
    format: ENGLISH_WORDNET_REFINERY_FORMAT,
    sourceHash: text(result.sourceHash),
    sourceTerms: terms,
    decisions,
    records,
    context,
    counts: counts(records, decisions),
    inventoryCount: records.reduce((count, record) => count + (record.candidates?.length ?? 0), 0),
    queue: queues.length === 1 ? queues[0] : null,
    queues,
    reconciliation: queues,
    queueHandle: queues.length === 1 ? queues[0].handleId : "",
    queuePending: queues.filter((queue) => queue.status !== "complete").length,
    errors
  };
}

export function buildEnglishWordNetSelectedBridgeIndex(records = []) {
  return buildEnglishWordNetSenseBridgeIndex(records.filter((record) => accepted(record.status)));
}
