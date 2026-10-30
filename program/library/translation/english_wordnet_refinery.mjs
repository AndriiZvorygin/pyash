import {
  analyzeEnglishSentence,
  loadDefaultEnglishSentenceResources,
  selectEnglishWordNetSenses
} from "./english_sentence.mjs";
import {
  buildEnglishWordNetSenseBridgeIndex,
  buildEnglishWordNetSenseAnchorCandidates,
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
import {
  isTranslationSenseState,
  translationOccurrenceId
} from "./translation_occurrence.mjs";

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
    const aliases = Array.isArray(record?.aliases)
      ? record.aliases.map(normalized).filter((alias) => alias && alias !== target)
      : [];
    const pyashSequence = Array.isArray(record?.pyashSequence)
      ? record.pyashSequence.filter((word) => typeof word === "string" && word.trim())
      : [];
    if (!target || pyashSequence.length === 0) continue;
    if (["accepted-delimited", "accepted-curated"].includes(text(record.status))) {
      for (const term of [target, ...aliases]) {
        byTarget.set(term, {
          coverageType: "compound",
          canonicalEnglish: target,
          pyashSequence
        });
      }
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

function persistedSenseRows(candidate) {
  return (candidate?.senseCandidates ?? []).map((sense) => ({
    pos: text(sense?.pos),
    synset: text(sense?.synset),
    lemma: text(sense?.lemma),
    lemmas: [...new Set((sense?.lemmas ?? [sense?.lemma]).map(text).filter(Boolean))].slice(0, 8),
    gloss: text(sense?.gloss)
  })).filter((sense) => sense.pos && sense.synset);
}

function persistedToken(token) {
  const senses = token?.senseCandidates ?? [];
  return {
    surface: normalized(token?.surface),
    lemma: normalized(token?.lemma),
    pyashSequence: Array.isArray(token?.pyashSequence) ? [...token.pyashSequence] : [],
    grammar: token?.grammar ?? null,
    morphology: token?.morphology ?? null,
    wordnet: {
      partsOfSpeech: [...new Set(senses.map((sense) => text(sense?.pos)).filter(Boolean))],
      senses
    },
    semanticCandidates: token?.semanticCandidates ?? []
  };
}

function decisionContext(tokens, index) {
  const rows = Array.isArray(tokens) ? tokens : [];
  const token = rows[index] ?? {};
  const previous = rows[index - 1] ?? null;
  const next = rows[index + 1] ?? null;
  const surface = normalized(token.surface);
  const nextSurface = normalized(next?.surface);
  const previousSurface = normalized(previous?.surface);
  const partsOfSpeech = new Set(token.wordnet?.partsOfSpeech ?? []);
  const nextPartsOfSpeech = new Set(next?.wordnet?.partsOfSpeech ?? []);
  let grammaticalRole = "lexical word in sentence";
  let headWord = nextSurface || previousSurface;
  if (token.grammar?.kind === "modal-mood") {
    grammaticalRole = "modal mood marking the following action";
  } else if (token.grammar?.kind === "case-marker") {
    grammaticalRole = "case marker linking the following phrase";
  } else if ((partsOfSpeech.has("r") && nextSurface)
    || (partsOfSpeech.has("r") && nextPartsOfSpeech.size > 0)) {
    grammaticalRole = "adverb modifying the following word or phrase";
  } else if (nextPartsOfSpeech.has("n") && (partsOfSpeech.has("a") || partsOfSpeech.has("s"))) {
    grammaticalRole = "adjective modifying the following noun";
  } else if (previous?.grammar?.kind === "case-marker" && partsOfSpeech.has("n")) {
    grammaticalRole = "noun inside a case-marked phrase";
    headWord = surface;
  } else if (partsOfSpeech.has("v")) {
    grammaticalRole = "verb or action word";
  } else if (partsOfSpeech.has("n")) {
    grammaticalRole = "noun or noun phrase head";
  }
  const start = Math.max(0, index - 3);
  const end = Math.min(rows.length, index + 4);
  const nearbyWords = rows
    .slice(start, end)
    .map((row) => normalized(row?.surface))
    .filter(Boolean);
  return {
    localPhrase: nearbyWords.join(" "),
    grammaticalRole,
    headWord,
    nearbyWords
  };
}

function occurrenceDecisions(result, resources, compounds, terms) {
  const decisions = [];
  const termSet = new Set(terms);
  const sourceRecords = new Map((result.records ?? []).map((record) => [record.id, record]));
  const persisted = isTranslationSenseState(result.senseStateFormat);

  for (const candidate of result.vocabularyCandidates ?? []) {
    if (text(candidate?.kind) !== "lexical-gap") continue;
    const surface = normalized(candidate.surface);
    if (!surface || !termSet.has(surface)) continue;
    const sourceRecord = sourceRecords.get(candidate.sourceRecordId);
    const sentence = text(sourceRecord?.source?.text ?? candidate.context?.[0]);
    const tokenIndex = Number(candidate.tokenIndex);
    const senseRows = persistedSenseRows(candidate);
    if (!sentence || !Number.isInteger(tokenIndex) || tokenIndex < 0 || senseRows.length === 0) {
      if (!sentence) continue;
    } else {
      const persistedTokens = (sourceRecord?.tokens ?? []).map(persistedToken);
      const token = persistedTokens[tokenIndex] ?? {
        surface,
        wordnet: { senses: senseRows }
      };
      const context = decisionContext(
        persistedTokens.length > 0 ? persistedTokens : [token],
        Math.min(tokenIndex, Math.max(0, persistedTokens.length - 1))
      );
      const selection = selectEnglishWordNetSenses(
        token,
        persistedTokens.length > 0 ? persistedTokens : [token],
        Math.min(tokenIndex, Math.max(0, persistedTokens.length - 1)),
        resources.wordnet?.index
      );
      const availableSenses = token.wordnet?.senses ?? senseRows;
      const senses = selection.evidence || selection.senses.length > 1 || availableSenses.length <= 1
        ? (selection.senses.length > 0 ? selection.senses : senseRows)
        : availableSenses;
      if (senses.length === 0) continue;
      const id = englishWordNetSelectionId({
        sourceHash: result.sourceHash,
        sourceRecordId: candidate.sourceRecordId,
        tokenIndex,
        surface
      });
      decisions.push({
        id,
        occurrenceId: candidate.occurrenceId || translationOccurrenceId({
          sourceRecordId: candidate.sourceRecordId,
          tokenIndex,
          surface
        }),
        sourceRecordId: candidate.sourceRecordId,
        sentenceIndex: sourceRecord?.source?.sentenceIndex,
        tokenIndex,
        surface,
        sentence,
        senses,
        availableSenseCount: availableSenses.length,
        ...context,
        selectionEvidence: selection.evidence,
        stateSource: "translation-token-state"
      });
      continue;
    }

    // Compatibility path for pre-sense-state fixtures and old checkpoints.
    // New translation outputs always take the persisted-token branch above.
    if (!sentence) continue;
    const unresolved = new Set((sourceRecord?.unresolved ?? []).map(normalized));
    const analysis = analyzeEnglishSentence(sentence, {
      resolveWord: (word) => resolveWord(resources, compounds, word),
      lemmaEntries: resources.lemmaCatalog?.entries ?? [],
      grammarIndex: resources.grammarIndex ?? emptyGrammarIndex(),
      wordnetIndex: resources.wordnet?.index
    });
    for (const [legacyTokenIndex, token] of analysis.tokens.entries()) {
      if (normalized(token?.surface) !== surface || !unresolved.has(surface)) continue;
      const selection = selectEnglishWordNetSenses(
        token,
        analysis.tokens,
        legacyTokenIndex,
        resources.wordnet?.index
      );
      if (!Array.isArray(selection.senses) || selection.senses.length === 0) continue;
      const availableSenses = token.wordnet?.senses ?? selection.senses;
      const senses = selection.evidence || selection.senses.length > 1 || availableSenses.length <= 1
        ? selection.senses
        : availableSenses;
      const id = englishWordNetSelectionId({
        sourceHash: result.sourceHash,
        sourceRecordId: candidate.sourceRecordId || sourceRecord?.id,
        tokenIndex: legacyTokenIndex,
        surface
      });
      decisions.push({
        id,
        occurrenceId: translationOccurrenceId({
          sourceRecordId: candidate.sourceRecordId || sourceRecord?.id,
          tokenIndex: legacyTokenIndex,
          surface
        }),
        sourceRecordId: candidate.sourceRecordId || sourceRecord?.id,
        sentenceIndex: sourceRecord?.source?.sentenceIndex,
        tokenIndex: legacyTokenIndex,
        surface,
        sentence,
        senses,
        availableSenseCount: availableSenses.length,
        ...decisionContext(analysis.tokens, legacyTokenIndex),
        selectionEvidence: selection.evidence,
        stateSource: "legacy-surface-reanalysis"
      });
    }
  }

  if (decisions.length > 0 || persisted) return decisions;

  // Preserve direct callers that provide records without vocabulary candidates.
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
      const availableSenses = token.wordnet?.senses ?? selection.senses;
      const senses = selection.evidence || selection.senses.length > 1 || availableSenses.length <= 1
        ? selection.senses
        : availableSenses;
      decisions.push({
        id,
        occurrenceId: translationOccurrenceId({
          sourceRecordId: sourceRecord.id,
          tokenIndex,
          surface
        }),
        sourceRecordId: sourceRecord.id,
        sentenceIndex: sourceRecord.source.sentenceIndex,
        tokenIndex,
        surface,
        sentence,
        senses,
        availableSenseCount: availableSenses.length,
        ...decisionContext(analysis.tokens, tokenIndex),
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
    localPhrase: decision.localPhrase,
    grammaticalRole: decision.grammaticalRole,
    headWord: decision.headWord,
    nearbyWords: decision.nearbyWords,
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
    selectionStatus: "selected",
    selectedSenseId: `${text(sense?.pos)}:${text(sense?.synset)}`,
    selectedSenseWord: text(sense?.lemma) || text(sense?.lemmas?.[0]),
    selectedSense: sense,
    selectionConfidence: selection.confidence || "deterministic",
    selectionRationale: selection.rationale || decision.selectionEvidence || "deterministic WordNet sense selection"
  };
}

function attachmentCandidateId(record) {
  const base = `wordnet-attachment:${record.id}`;
  return record.occurrenceId ? `${base}:${record.occurrenceId}` : base;
}

function attachmentCandidate(record) {
  if (record.status !== "review" || !record.selectedSense) return null;
  const selectedSense = record.selectedSense;
  return {
    id: attachmentCandidateId(record),
    surface: record.surface,
    kind: "wordnet-sense-attachment",
    sourceRecordId: record.sourceRecordId,
    tokenIndex: record.tokenIndex,
    occurrenceId: record.occurrenceId,
    context: [record.sentence],
    senseId: record.selectedSenseId,
    senseWord: text(record.selectedSenseWord)
      || text(selectedSense.lemma)
      || text(selectedSense.lemmas?.[0]),
    sense: {
      pos: text(selectedSense.pos),
      synset: text(selectedSense.synset),
      lemmas: [...new Set((selectedSense.lemmas ?? [selectedSense.lemma])
        .map(text)
        .filter(Boolean))].slice(0, 4),
      gloss: text(selectedSense.gloss)
    },
    anchorCandidates: (record.anchorCandidates ?? []).map((candidate) => ({
      target: text(candidate.target),
      pyashSequence: [...(candidate.pyashSequence ?? [])],
      evidence: text(candidate.evidence),
      ...(text(candidate.kind) ? { kind: text(candidate.kind) } : {}),
      ...(Array.isArray(candidate.componentTargets) && candidate.componentTargets.length > 0
        ? { componentTargets: candidate.componentTargets.map(text).filter(Boolean) }
        : {})
    })),
    evidence: [
      `selected WordNet sense ${record.selectedSenseId}`,
      selectedSense.gloss,
      record.selectionRationale
    ].filter(Boolean).join("; ")
  };
}

export function appendEnglishWordNetAttachmentCandidates(translation, records) {
  const attachments = records.map(attachmentCandidate).filter(Boolean);
  if (attachments.length === 0) return translation;
  const selectedKeys = new Set(attachments.map((candidate) => (
    candidate.occurrenceId
      || translationOccurrenceId({
        sourceRecordId: candidate.sourceRecordId,
        tokenIndex: candidate.tokenIndex,
        surface: candidate.surface
      })
      || `${candidate.sourceRecordId}\u0000${candidate.surface}`
  )));
  const existing = (translation.vocabularyCandidates ?? []).filter((candidate) => (
    !selectedKeys.has(
      candidate.occurrenceId
        || translationOccurrenceId({
          sourceRecordId: candidate.sourceRecordId,
          tokenIndex: candidate.tokenIndex,
          surface: candidate.surface
        })
        || `${candidate.sourceRecordId}\u0000${normalized(candidate.surface)}`
    )
  ));
  return {
    ...translation,
    vocabularyCandidates: [...existing, ...attachments]
  };
}

export function applyEnglishWordNetSenseAttachmentLinks(translation) {
  const wordnet = translation?.wordnet;
  if (!wordnet || !Array.isArray(wordnet.records)) return translation;
  const accepted = (translation.vocabularyCandidates ?? []).filter((candidate) => (
    candidate?.kind === "wordnet-sense-attachment"
    && candidate?.status === "accepted-llm"
    && text(candidate.targetEnglish)
    && Array.isArray(candidate.pyashSequence)
    && candidate.pyashSequence.length > 0
    && text(candidate.senseId)
  ));
  if (accepted.length === 0) return translation;
  const records = wordnet.records.map((record) => {
    const candidate = accepted.find((item) => (
      item.id === attachmentCandidateId(record)
        || item.id === `wordnet-attachment:${record.id}`
        || (text(item.occurrenceId) && text(item.occurrenceId) === text(record.occurrenceId))
    ));
    if (!candidate || text(record.selectedSenseId) !== text(candidate.senseId)) return record;
    const target = text(candidate.targetEnglish).toLowerCase();
    const pyashSequence = candidate.pyashSequence.filter((word) => typeof word === "string" && word.trim());
    const selectedAnchor = (record.anchorCandidates ?? []).find((anchor) => (
      text(anchor?.target).toLowerCase() === target
        && Array.isArray(anchor?.pyashSequence)
        && anchor.pyashSequence.join(" ") === pyashSequence.join(" ")
    ));
    const evidence = selectedAnchor?.kind === "compound-composition"
      ? `selected sense ${record.selectedSenseId} composed multiword anchor ${target} from ${(selectedAnchor.componentTargets ?? []).join(" ")}`
      : `selected sense ${record.selectedSenseId} linked to existing Pyash anchor ${target}`;
    return {
      ...record,
      status: "accepted-llm",
      link: {
        target,
        pyashSequence: [...pyashSequence],
        targetPartOfSpeech: text(record.pos),
        certainty: "contextual",
        evidence
      },
      verificationRationale: text(candidate.verificationRationale)
        || `selected sense ${record.selectedSenseId} linked to ${target}`
    };
  });
  return {
    ...translation,
    wordnet: {
      ...wordnet,
      records,
      counts: counts(records, wordnet.decisions ?? [])
    }
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
  suggestVocabulary = null,
  maxRepairAttempts = 1
} = {}) {
  if (!result || typeof result !== "object" || text(result.language) !== "english") {
    throw invalid("WordNet refinery requires an English translation result");
  }
  const terms = sourceTerms
    ? [...new Set(sourceTerms.map(normalized).filter(Boolean))].sort()
    : collectEnglishWordNetSourceTerms(result);
  if (terms.length === 0) {
    if (result.wordnet?.format === ENGLISH_WORDNET_REFINERY_FORMAT) {
      return result.wordnet;
    }
    return {
      format: ENGLISH_WORDNET_REFINERY_FORMAT,
      senseStateFormat: result.senseStateFormat || "",
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
  const priorRecords = new Map((result.wordnet?.records ?? []).map((record) => [
    record.occurrenceId
      || translationOccurrenceId({
        sourceRecordId: record.sourceRecordId,
        tokenIndex: record.tokenIndex,
        surface: record.surface
      })
      || record.id,
    record
  ]));
  const records = [];
  const queues = [];
  const errors = [];
  for (const decision of decisions) {
    try {
      const prior = priorRecords.get(
        decision.occurrenceId
          || translationOccurrenceId({
            sourceRecordId: decision.sourceRecordId,
            tokenIndex: decision.tokenIndex,
            surface: decision.surface
          })
      );
      if (prior && prior.selectedSenseId && prior.selectedSense) {
        if (accepted(prior.status) || prior.status === "review") {
          records.push(prior);
          continue;
        }
        if (prior.status === "uncertain-llm" && prior.selectionStatus !== "selected") {
          records.push(prior);
          continue;
        }
      }
      if (prior && !prior.selectedSenseId && prior.selectionStatus === "pending") {
        records.push(prior);
        if (prior.queue) queues.push(prior.queue);
        continue;
      }
      let selected = decision.senses.length === 1
        && (decision.availableSenseCount === 1 || decision.selectionEvidence)
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
            selectionStatus: "error",
            status: "error",
            queue: outcome.queue,
            error: outcome.error,
            providerResponse: outcome.raw || ""
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
        records.push({ ...decision, selectionStatus: "pending", status: "review", queue: outcome.queue });
        continue;
      }
      if (!selected) {
        const error = "ambiguous WordNet sense requires a selector";
        records.push({ ...decision, selectionStatus: "error", status: "error", error });
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
      const suggestionRecords = typeof suggestVocabulary === "function"
        ? await suggestVocabulary(selected.selectedSense.lemmas ?? [selected.selectedSense.lemma])
        : [];
      const anchorCandidates = buildEnglishWordNetSenseAnchorCandidates({
        sense: selected.selectedSense,
        wordnetIndex: loadedResources.wordnet?.index,
        resolveWord: (word) => resolveWord(loadedResources, compounds, word),
        suggestionRecords,
        suggestionMinSupport: linkerConfig.vocabSuggestionMinSupport,
        maxDepth: linkerConfig.anchorMaxDepth ?? 1,
        maxCandidates: linkerConfig.anchorMaxCandidates ?? 8
      });
      const legacyLink = typeof suggestVocabulary !== "function"
        && linked.status === "review"
        && linked.candidates.length === 1
        ? {
          status: "accepted-deterministic",
          link: linked.candidates[0]
        }
        : linked;
      const suggestionAnchors = anchorCandidates.filter((candidate) => candidate.kind === "vocab-suggestion");
      const relationAnchors = anchorCandidates.filter((candidate) => candidate.kind !== "vocab-suggestion");
      const resolvedLink = legacyLink.status === "review"
        && suggestionAnchors.length === 1
        && relationAnchors.length === 0
        ? {
          status: "accepted-deterministic",
          link: {
            target: suggestionAnchors[0].target,
            pyashSequence: suggestionAnchors[0].pyashSequence,
            targetPartOfSpeech: selected.selectedSense.pos,
            certainty: "deterministic",
            evidence: suggestionAnchors[0].evidence
          }
        }
        : legacyLink;
      records.push({
        ...resolvedLink,
        occurrenceId: selected.occurrenceId,
        decisionId: selected.id,
        sourceRecordId: selected.sourceRecordId,
        sentenceIndex: selected.sentenceIndex,
        tokenIndex: selected.tokenIndex,
        surface: selected.surface,
        sentence: selected.sentence,
        selectedSenseId: selected.selectedSenseId,
        selectedSenseWord: selected.selectedSenseWord
          || text(selected.selectedSense?.lemma)
          || text(selected.selectedSense?.lemmas?.[0]),
        selectedSense: selected.selectedSense,
        selectionConfidence: selected.selectionConfidence,
        selectionRationale: selected.selectionRationale,
        anchorCandidates
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
    senseStateFormat: result.senseStateFormat || "",
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
