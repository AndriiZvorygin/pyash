import { createHash } from "node:crypto";

import { sentenceToPyash } from "../../../beautiful.mjs";
import { buildProgram } from "../../../program.mjs";
import { buildVliwDatabase } from "../../../library/vliw/index.mjs";
import {
  decodePhraseVliw,
  lowerPhraseVliw,
  lowerSentencePhraseVliw,
  renderVliwPyac
} from "../../../library/vliw/phrase.mjs";
import {
  analyzeDefaultEnglishSentence,
  loadEnglishSentenceResources,
  resolveEnglishSentence
} from "./english_sentence.mjs";
import { renderPyacSentenceSurface } from "./pyash_surface.mjs";
import { renderEnglishPyash } from "./pyac_to_english_pyash.mjs";
import { resolveTranslationSource } from "./registry.mjs";
import {
  TRANSLATION_SENSE_STATE_FORMAT,
  translationOccurrenceId
} from "./translation_occurrence.mjs";

export const TRANSLATION_PIPELINE_FORMAT = "translation-pipeline-v1";
export const TRANSLATION_PIPELINE_NAME = "translation_pipeline";
export const TRANSLATION_RECORD_STATUSES = Object.freeze([
  "resolved",
  "provisional",
  "unresolved"
]);

function invalid(message, details = {}) {
  const error = new Error(message);
  error.code = "invalid-translation-pipeline";
  error.details = details;
  return error;
}

function text(value) {
  return typeof value === "string" ? value.normalize("NFC").trim() : "";
}

function hash(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function partialSequenceProjection(sequence, source = "") {
  try {
    const lowered = lowerPhraseVliw({ tokens: sequence });
    const decoded = decodePhraseVliw(lowered.vectors);
    const english = renderEnglishPyash({ mood: null }, [], decoded, new Map())
      .replace(/[.!?]+$/u, "")
      .trim();
    return {
      pyash: english && english !== "su" ? english : source,
      pyac: renderVliwPyac(decoded)
    };
  } catch {
    return {
      pyash: sequence.join(" "),
      pyac: sequence.join(" ")
    };
  }
}

function partialTokenParts(record) {
  const parts = (record?.tokens ?? []).flatMap((token) => {
    const sequence = cloneSequence(token?.pyashSequence);
    if (sequence.length === 0) return [];
    const source = text(token?.surface);
    const projection = partialSequenceProjection(sequence, source);
    return [{
      source,
      value: projection.pyash,
      sequence,
      pyac: projection.pyac
    }];
  });
  if (parts.length > 0) return parts;

  const structural = text(record?.structuralPreview);
  if (!structural) return [];
  const sequence = structural.split(/\s+/u).filter(Boolean);
  const projection = partialSequenceProjection(sequence, text(record?.source?.text));
  return [{
    source: text(record?.source?.text),
    value: projection.pyash,
    sequence,
    pyac: projection.pyac
  }];
}

function sentencePhraseTokens(value) {
  if (typeof value === "string") return cloneSequence(value.split(/\s+/u));
  if (value && typeof value.name === "string") return cloneSequence(value.name.split(/\s+/u));
  return [];
}

function projectClauseSentence(clause) {
  const sentence = clause?.sentence;
  if (!sentence || typeof sentence !== "object") return null;
  const tokens = [
    ...cloneSequence(clause.connectorPyashSequence),
    ...sentencePhraseTokens(sentence.su),
    ...sentencePhraseTokens(sentence.ob),
    ...sentencePhraseTokens(sentence.be),
    ...cloneSequence(typeof sentence.mood === "string" ? [sentence.mood] : [])
  ];
  if (tokens.length === 0) return null;
  try {
    const phraseVliw = lowerPhraseVliw({ tokens });
    const decoded = decodePhraseVliw(phraseVliw.vectors);
    const connector = text(clause.connector);
    const pyashBody = renderEnglishPyash(sentence, [], decoded, new Map());
    const pyash = connector ? `${connector} ${pyashBody}` : pyashBody;
    return {
      source: text(clause.source),
      connector: connector || null,
      connectorPyashSequence: cloneSequence(clause.connectorPyashSequence),
      sentence,
      pyash,
      englishPyash: pyash,
      pyac: renderVliwPyac(decoded),
      structural: sentenceToPyash(sentence),
      vliw: phraseVliw
    };
  } catch {
    return null;
  }
}

export function projectTranslationSentence(record) {
  const completePyash = Array.isArray(record?.englishPyash)
    ? record.englishPyash
    : text(record?.englishPyash ?? record?.pyash);
  const completePyac = Array.isArray(record?.pyac)
    ? record.pyac
    : text(record?.pyac);
  const partial = partialTokenParts(record);
  const projection = {
    pyash: completePyash || partial.map(({ source, value, sequence }) => ({ source, value, sequence })),
    pyac: completePyac || partial.map(({ source, pyac, sequence }) => ({ source, value: pyac, sequence }))
  };
  if (Array.isArray(record?.clauses) && record.clauses.length > 0) {
    projection.clauses = record.clauses;
  }
  if (record?.construction) projection.construction = record.construction;
  if (record?.existential) projection.existential = record.existential;
  if (Array.isArray(record?.discourseConnectors) && record.discourseConnectors.length > 0) {
    projection.discourseConnectors = record.discourseConnectors;
  }
  if (Array.isArray(record?.relativeClauses) && record.relativeClauses.length > 0) {
    projection.relativeClauses = record.relativeClauses;
  }
  if (Array.isArray(record?.sentences) && record.sentences.length > 0) {
    projection.sentences = record.sentences.map((sentence) => ({
      source: sentence.source,
      connector: sentence.connector,
      connectorPyashSequence: sentence.connectorPyashSequence,
      pyash: sentence.pyash,
      pyac: sentence.pyac,
      structural: sentence.structural
    }));
  }
  return projection;
}

function stableId(parts) {
  return `translation-${hash(parts.join("\u0000")).slice(0, 24)}`;
}

function occurrenceKey(value) {
  return value?.occurrenceId
    || translationOccurrenceId({
      sourceRecordId: value?.sourceRecordId,
      tokenIndex: value?.tokenIndex,
      surface: value?.surface
    })
    || `${text(value?.sourceRecordId)}\u0000${String(value?.tokenIndex ?? "")}\u0000${text(value?.surface).toLowerCase()}`;
}

function hasSequence(value) {
  return Array.isArray(value?.pyashSequence) && value.pyashSequence.length > 0;
}

function mergeTokens(currentTokens = [], priorTokens = []) {
  const priorByKey = new Map(priorTokens.map((token) => [occurrenceKey(token), token]));
  return currentTokens.map((token) => {
    const prior = priorByKey.get(occurrenceKey(token));
    if (!prior || !hasSequence(prior) || hasSequence(token)) return token;
    return {
      ...prior,
      ...token,
      pyashSequence: [...prior.pyashSequence],
      ...(prior.coverageType ? { coverageType: prior.coverageType } : {})
    };
  });
}

function mergeRecords(currentRecords = [], priorRecords = []) {
  const priorById = new Map(priorRecords.map((record) => [record.id, record]));
  return currentRecords.map((record) => {
    const prior = priorById.get(record.id);
    if (!prior) return record;
    const tokens = mergeTokens(record.tokens ?? [], prior.tokens ?? []);
    const preservedResolved = prior.status === "resolved" && record.status !== "resolved";
    const unresolved = [...new Set((record.unresolved ?? []).filter((surface) => (
      !tokens.some((token) => text(token.surface).toLowerCase() === text(surface).toLowerCase() && hasSequence(token))
    )))];
    const merged = {
      ...prior,
      ...record,
      source: record.source ?? prior.source,
      context: record.context ?? prior.context,
      tokens,
      ...(unresolved.length > 0 ? { unresolved } : {})
    };
    if (unresolved.length === 0) delete merged.unresolved;
    if (preservedResolved) {
      merged.status = "resolved";
      delete merged.unresolved;
    }
    return merged;
  });
}

function mergeCandidates(currentCandidates = [], priorCandidates = []) {
  const currentById = new Map(currentCandidates.map((candidate) => [candidate.id || occurrenceKey(candidate), candidate]));
  for (const prior of priorCandidates) {
    const key = prior.id || occurrenceKey(prior);
    const current = currentById.get(key);
    if (!current) {
      if (String(prior.status ?? "").startsWith("accepted-")) currentById.set(key, prior);
      continue;
    }
    const accepted = String(prior.status ?? "").startsWith("accepted-");
    if (accepted && !String(current.status ?? "").startsWith("accepted-")) currentById.set(key, prior);
  }
  return [...currentById.values()];
}

export function mergeTranslationArtifacts(current, prior) {
  if (!current || !prior || current.sourceHash !== prior.sourceHash) return current;
  const records = mergeRecords(current.records ?? [], prior.records ?? []);
  const vocabularyCandidates = mergeCandidates(
    current.vocabularyCandidates ?? [],
    prior.vocabularyCandidates ?? []
  );
  const counts = Object.fromEntries(
    TRANSLATION_RECORD_STATUSES.map((status) => [
      status,
      records.filter((record) => record.status === status).length
    ])
  );
  return {
    ...current,
    records,
    vocabularyCandidates,
    counts,
    resolved: records.filter((record) => record.status === "resolved"),
    provisional: records.filter((record) => record.status === "provisional"),
    unresolved: records.filter((record) => record.status === "unresolved")
  };
}

function normalizeLanguage(value) {
  return text(value).toLowerCase();
}

function lineIndexAt(source, offset) {
  let line = 0;
  for (let index = 0; index < offset; index += 1) {
    if (source[index] === "\n") line += 1;
  }
  return line;
}

function trimBounds(value, offset) {
  const leading = value.search(/\S/u);
  if (leading < 0) return null;
  const trailing = value.search(/\s+$/u);
  const endTrim = trailing < 0 ? value.length : trailing;
  return {
    text: value.slice(leading, endTrim),
    startOffset: offset + leading,
    endOffset: offset + endTrim
  };
}

export function segmentTranslationDocument(source) {
  if (typeof source !== "string") throw invalid("translation document must be text");
  const segments = [];
  const pattern = /[^.!?。！？\r\n]+(?:[.!?。！？]+|(?=\r?\n|$))/gu;
  for (const match of source.matchAll(pattern)) {
    const bounds = trimBounds(match[0], match.index ?? 0);
    if (!bounds) continue;
    segments.push({
      ...bounds,
      sentenceIndex: segments.length,
      lineIndex: lineIndexAt(source, bounds.startOffset)
    });
  }
  return segments;
}

function cloneSequence(value) {
  return Array.isArray(value)
    ? value.filter((word) => typeof word === "string" && word.trim()).map((word) => word.trim())
    : [];
}

function tokenEvidence(token) {
  return [
    token?.evidence,
    token?.lemmaEvidence,
    token?.provenance,
    token?.construction?.evidence,
    token?.wordnet?.evidence
  ].map(text).find(Boolean) ?? "";
}

function normalizeAnalysis(value, sourceText) {
  if (value?.mood && typeof value === "object") {
    return {
      status: "resolved",
      sentence: value,
      pyash: sentenceToPyash(value),
      unresolved: [],
      candidates: [],
      tokens: []
    };
  }
  if (!value || typeof value !== "object") {
    return {
      status: "unresolved",
      reason: "adapter produced no canonical sentence",
      unresolved: [sourceText],
      candidates: [],
      tokens: []
    };
  }
  return {
    ...value,
    status: value.status === "resolved" && value.sentence ? "resolved" : value.status ?? "provisional",
    unresolved: Array.isArray(value.unresolved) ? [...value.unresolved] : [],
    candidates: Array.isArray(value.candidates) ? [...value.candidates] : [],
    tokens: Array.isArray(value.tokens) ? [...value.tokens] : []
  };
}

function contextFor(segments, index, radius) {
  return segments
    .slice(Math.max(0, index - radius), Math.min(segments.length, index + radius + 1))
    .map((segment) => segment.text);
}

function senseRows(token) {
  return (token?.wordnet?.senses ?? []).map((sense) => ({
    pos: text(sense?.pos),
    synset: text(sense?.synset),
    lemma: text(sense?.lemma),
    lemmas: [...new Set((sense?.lemmas ?? [sense?.lemma]).map(text).filter(Boolean))].slice(0, 8),
    gloss: text(sense?.gloss)
  })).filter((sense) => sense.pos && sense.synset);
}

function vocabularyCandidates({ recordId, language, sourceText, context, analysis }) {
  const unresolvedTokens = analysis.tokens.length > 0
    ? analysis.tokens.map((token, tokenIndex) => ({ token, tokenIndex })).filter(({ token }) => (
      cloneSequence(token?.pyashSequence).length === 0
      && !token?.copula
      && !token?.grammar
    ))
    : [{ token: { surface: sourceText, coverageType: "unresolved", evidence: analysis.reason ?? "" }, tokenIndex: 0 }];
  return unresolvedTokens.map(({ token, tokenIndex }) => {
    const surface = text(token.surface ?? sourceText);
    const candidateSequences = [
      ...analysis.candidates.filter((candidate) => (
        String(candidate?.phrase ?? "").toLowerCase().split(/\s+/u).includes(surface.toLowerCase())
      )),
      ...(Array.isArray(token?.semanticCandidates) ? token.semanticCandidates : [])
    ]
      .map((candidate) => cloneSequence(candidate?.pyashSequence))
      .filter((sequence) => sequence.length > 0);
    const occurrenceId = translationOccurrenceId({
      sourceRecordId: recordId,
      tokenIndex,
      surface
    });
    return {
      id: occurrenceId || stableId(["vocabulary", language, recordId, String(tokenIndex), surface]),
      language,
      surface,
      kind: token.grammar ? "grammar-gap" : "lexical-gap",
      sourceRecordId: recordId,
      tokenIndex,
      ...(occurrenceId ? { occurrenceId } : {}),
      context: [...context],
      senseCandidates: senseRows(token),
      candidateSequences,
      evidence: tokenEvidence(token) || text(analysis.reason) || "source term remains unresolved",
      status: "queued"
    };
  });
}

function adapterSurfaceText(sourceText) {
  return sourceText.replace(/[。！？।॥]+$/u, ".");
}

async function analyzeSegment({
  adapter,
  sourceText,
  sourceRecordId,
  context,
  verify,
  wordnetBridges,
  coverageOverrides,
  occurrenceOverrides
}) {
  const adapterText = adapterSurfaceText(sourceText);
  let analysis;
  if (typeof adapter.analyzeSentence === "function") {
    analysis = await adapter.analyzeSentence(adapterText, {
      context,
      sourceRecordId,
      wordnetBridges,
      coverageOverrides,
      occurrenceOverrides
    });
    if (
      adapter.name === "english" &&
      analysis?.status !== "resolved" &&
      !Array.isArray(analysis?.clauses) &&
      typeof verify === "function" &&
      Array.isArray(analysis?.candidates) &&
      analysis.candidates.length > 0
    ) {
      analysis = await resolveEnglishSentence(adapterText, {
        analyze: async () => analysis,
        verify: (request) => verify({ ...request, context })
      });
    }
    if (analysis?.status !== "resolved" && typeof adapter.toPyash === "function") {
      const structured = await adapter.toPyash(adapterText);
      if (structured) analysis = structured;
    }
    return normalizeAnalysis(analysis, sourceText);
  }
  const sentence = await adapter.toPyash(adapterText);
  return normalizeAnalysis(sentence, sourceText);
}

function makeRecord({ language, sourceHash, locator, segment, analysis, context }) {
  const recordId = stableId([language, String(segment.sentenceIndex), segment.text]);
  const sentence = analysis.status === "resolved" ? analysis.sentence : null;
  const clauseProjections = Array.isArray(analysis.clauses)
    ? analysis.clauses.map(projectClauseSentence).filter(Boolean)
    : [];
  const resolvedClauseSentences = clauseProjections.length > 1
    && clauseProjections.length === analysis.clauses.length;
  const structural = sentence
    ? sentenceToPyash(sentence)
    : text(analysis.pyash ?? analysis.verbPhrase?.pyashSequence?.join(" "));
  let phraseVliw = null;
  if (sentence) {
    try {
      const lowered = lowerSentencePhraseVliw(sentence);
      const decoded = decodePhraseVliw(lowered.vectors);
      phraseVliw = {
        format: decoded.format,
        words: [...decoded.words],
        vectors: decoded.vectors.map((vector) => [...vector]),
        phraseEnds: [...decoded.phraseEnds],
        moodIndex: decoded.moodIndex
      };
    } catch {
      phraseVliw = null;
    }
  }
  const pyac = phraseVliw
    ? renderVliwPyac(decodePhraseVliw(phraseVliw.vectors))
    : sentence ? renderPyacSentenceSurface(sentence) : "";
  const englishPyash = phraseVliw
    ? renderEnglishPyash(sentence, [], decodePhraseVliw(phraseVliw.vectors), new Map())
    : "";
  const tokenCandidates = analysis.tokens.flatMap((token) => token.semanticCandidates ?? []);
  const hasReviewCandidates = analysis.candidates.length > 0 || tokenCandidates.length > 0;
  const unresolved = analysis.unresolved.length > 0
    ? [...new Set(analysis.unresolved.map(text).filter(Boolean))]
    : sentence || hasReviewCandidates ? [] : [segment.text];
  const hasStructuralReview = Boolean(
    analysis.construction
      || analysis.existential
      || (Array.isArray(analysis.relativeClauses) && analysis.relativeClauses.length > 0)
  );
  const status = sentence
    ? "resolved"
    : resolvedClauseSentences
      ? "resolved"
    : hasReviewCandidates
      ? "provisional"
      : hasStructuralReview
        ? "provisional"
      : "unresolved";
  const canonical = language === "english" && sentence ? segment.text : "";
  const record = {
    id: recordId,
    language,
    sourceHash,
    source: {
      text: segment.text,
      locator: locator || null,
      sentenceIndex: segment.sentenceIndex,
      lineIndex: segment.lineIndex,
      startOffset: segment.startOffset,
      endOffset: segment.endOffset
    },
    context: [...context],
    status,
    ...(sentence ? { sentence, pyash: englishPyash, englishPyash, structural } : {}),
    ...(resolvedClauseSentences ? {
      sentences: clauseProjections,
      pyash: clauseProjections.map((clause) => clause.pyash),
      englishPyash: clauseProjections.map((clause) => clause.englishPyash),
      pyac: clauseProjections.map((clause) => clause.pyac),
      vliwSentences: clauseProjections.map((clause) => clause.vliw)
    } : {}),
    ...(pyac && !resolvedClauseSentences ? { pyac } : {}),
    ...(phraseVliw ? { vliw: phraseVliw } : {}),
    ...(canonical ? { canonical } : {}),
    ...(structural && !sentence ? { structuralPreview: structural } : {}),
    ...(analysis.construction ? { construction: analysis.construction } : {}),
    ...(analysis.existential ? { existential: analysis.existential } : {}),
    ...(Array.isArray(analysis.discourseConnectors) && analysis.discourseConnectors.length > 0
      ? { discourseConnectors: analysis.discourseConnectors }
      : {}),
    ...(Array.isArray(analysis.relativeClauses) && analysis.relativeClauses.length > 0
      ? { relativeClauses: analysis.relativeClauses }
      : {}),
    ...(unresolved.length > 0 ? { unresolved } : {}),
    ...(analysis.candidates.length > 0 ? { candidates: analysis.candidates } : {}),
    ...(Array.isArray(analysis.phrases) && analysis.phrases.length > 0 ? {
      phrases: analysis.phrases.map((phrase) => ({
        slot: text(phrase?.slot),
        start: Number.isInteger(phrase?.start) ? phrase.start : null,
        end: Number.isInteger(phrase?.end) ? phrase.end : null,
        surface: text(phrase?.surface),
        pyashSequence: cloneSequence(phrase?.pyashSequence)
      }))
    } : {}),
    ...(Array.isArray(analysis.clauses) && analysis.clauses.length > 0 ? {
      clauses: analysis.clauses.map((clause) => ({
        index: Number.isInteger(clause?.index) ? clause.index : null,
        source: text(clause?.source),
        connector: text(clause?.connector) || null,
        connectorPyashSequence: cloneSequence(clause?.connectorPyashSequence),
        status: text(clause?.status),
        subject: clause?.subject ? {
          surface: text(clause.subject.surface),
          pyashSequence: cloneSequence(clause.subject.pyashSequence)
        } : null,
        action: clause?.action ? {
          phrase: text(clause.action.phrase),
          pyashSequence: cloneSequence(clause.action.pyashSequence),
          certainty: text(clause.action.certainty),
          mood: text(clause.action.mood) || null
        } : null,
        phrases: Array.isArray(clause?.phrases) ? clause.phrases.map((phrase) => ({
          slot: text(phrase?.slot),
          start: Number.isInteger(phrase?.start) ? phrase.start : null,
          end: Number.isInteger(phrase?.end) ? phrase.end : null,
          surface: text(phrase?.surface),
          pyashSequence: cloneSequence(phrase?.pyashSequence)
        })) : [],
        pyash: text(clause?.pyash),
        unresolved: Array.isArray(clause?.unresolved) ? clause.unresolved.map(text).filter(Boolean) : [],
        candidates: Array.isArray(clause?.candidates) ? clause.candidates : []
      })),
      clauseConnectors: Array.isArray(analysis.clauseConnectors)
        ? analysis.clauseConnectors.map((connector) => ({
          surface: text(connector?.surface),
          pyashSequence: cloneSequence(connector?.pyashSequence)
        }))
        : []
    } : {}),
    ...(analysis.tokens.length > 0 ? {
      tokens: analysis.tokens.map((token, tokenIndex) => {
        const occurrenceId = translationOccurrenceId({
          sourceRecordId: recordId,
          tokenIndex,
          surface: token.surface
        });
        const candidates = Array.isArray(token.semanticCandidates)
          ? token.semanticCandidates.map((candidate) => ({
            phrase: text(candidate?.phrase),
            lemma: text(candidate?.lemma),
            pyashSequence: cloneSequence(candidate?.pyashSequence),
            evidence: text(candidate?.evidence)
          }))
          : [];
        const senses = senseRows(token);
        return {
          surface: token.surface,
          tokenIndex,
          ...(occurrenceId ? { occurrenceId } : {}),
          coverageType: token.coverageType,
          pyashSequence: cloneSequence(token.pyashSequence),
          ...(token.lemma ? { lemma: token.lemma } : {}),
          ...(token.grammar ? { grammar: token.grammar } : {}),
          ...(token.morphology ? { morphology: token.morphology } : {}),
          ...(senses.length > 0 ? { senseCandidates: senses } : {}),
          ...(candidates.length > 0 ? { semanticCandidates: candidates } : {}),
          ...(tokenEvidence(token) ? { evidence: tokenEvidence(token) } : {})
        };
      })
    } : {}),
    ...(analysis.reason ? { reason: text(analysis.reason) } : {})
  };
  return {
    record,
    vocabularyCandidates: status === "resolved"
      ? []
      : vocabularyCandidates({
        recordId,
        language,
        sourceText: segment.text,
        context,
        analysis
      })
  };
}

export async function translateDocumentSegments({
  language,
  text: source,
  segments,
  locator = "",
  contextRadius = 1,
  verify,
  resourceHashes,
  adapterResolver = resolveTranslationSource,
  wordnetBridges = null,
  coverageOverrides = null,
  occurrenceOverrides = null
} = {}) {
  const normalizedLanguage = normalizeLanguage(language);
  if (!normalizedLanguage) throw invalid("translation requires an explicit language");
  if (typeof source !== "string") throw invalid("translation requires source text");
  if (!Array.isArray(segments)) throw invalid("translation requires sentence segments");
  const adapter = adapterResolver(normalizedLanguage);
  if (!adapter) throw invalid("no translation adapter is registered for the source language", { language: normalizedLanguage });
  const sourceHash = hash(source);
  const resolvedResourceHashes = resourceHashes ?? (
    normalizedLanguage === "english" ? await loadEnglishResourceHashes() : {}
  );
  const records = [];
  const vocabulary = [];
  for (const segment of segments) {
    const context = contextFor(segments, segment.sentenceIndex, Math.max(0, Math.trunc(Number(contextRadius) || 0)));
    const sourceRecordId = stableId([normalizedLanguage, String(segment.sentenceIndex), segment.text]);
    const analysis = await analyzeSegment({
      adapter,
      sourceText: segment.text,
      sourceRecordId,
      context,
      verify,
      wordnetBridges,
      coverageOverrides,
      occurrenceOverrides
    });
    const result = makeRecord({
      language: normalizedLanguage,
      sourceHash,
      locator,
      segment,
      analysis,
      context
    });
    records.push(result.record);
    vocabulary.push(...result.vocabularyCandidates);
  }
  const counts = Object.fromEntries(
    TRANSLATION_RECORD_STATUSES.map((status) => [status, records.filter((record) => record.status === status).length])
  );
  return {
    format: TRANSLATION_PIPELINE_FORMAT,
    language: normalizedLanguage,
    locator: locator || null,
    sourceHash,
    senseStateFormat: TRANSLATION_SENSE_STATE_FORMAT,
    resourceHashes: resolvedResourceHashes,
    sourceLength: source.length,
    records,
    vocabularyCandidates: vocabulary,
    counts,
    resolved: records.filter((record) => record.status === "resolved"),
    provisional: records.filter((record) => record.status === "provisional"),
    unresolved: records.filter((record) => record.status === "unresolved")
  };
}

export async function translateDocument({
  language,
  text: source,
  locator = "",
  contextRadius = 1,
  verify,
  resourceHashes,
  adapterResolver = resolveTranslationSource,
  coverageOverrides = null,
  occurrenceOverrides = null
} = {}) {
  return translateDocumentSegments({
    language,
    text: source,
    segments: segmentTranslationDocument(source),
    locator,
    contextRadius,
    verify,
    resourceHashes,
    adapterResolver,
    coverageOverrides,
    occurrenceOverrides
  });
}

export async function loadEnglishResourceHashes() {
  const resources = await loadEnglishSentenceResources();
  return { ...resources.resourceHashes };
}

export function lowerTranslationToPyac(result) {
  if (!result || !Array.isArray(result.records)) throw invalid("Pyac lowering requires translation records");
  const resolved = result.records.flatMap((record) => {
    if (record.status !== "resolved") return [];
    if (record.sentence) return [{ record, sentence: record.sentence, vliw: record.vliw }];
    if (!Array.isArray(record.sentences)) return [];
    return record.sentences.map((sentence, clauseIndex) => ({
      record,
      sentence: sentence.sentence,
      vliw: sentence.vliw,
      clauseIndex
    }));
  });
  const sources = resolved.map((record) => ({
    language: result.language,
    locator: result.locator,
    sentenceId: record.clauseIndex === undefined
      ? record.record.id
      : `${record.record.id}:clause-${record.clauseIndex}`,
    sentenceIndex: record.record.source.sentenceIndex,
    lineIndex: record.record.source.lineIndex,
    startOffset: record.record.source.startOffset,
    endOffset: record.record.source.endOffset,
    text: record.clauseIndex === undefined
      ? record.record.source.text
      : record.record.sentences[record.clauseIndex].source
  }));
  const database = buildVliwDatabase(resolved.map((record) => record.sentence), {
    sources,
    lowerSentence: (sentence, inputIndex) => {
      const phraseVliw = resolved[inputIndex]?.vliw;
      if (!phraseVliw?.vectors) return undefined;
      return {
        codelets: phraseVliw.vectors.map((words) => ({
          words,
          usedWords: phraseVliw.usedWords
        })),
        decodeCodelet: () => ({
          format: phraseVliw.format,
          semantic: "phrase-vliw",
          sentence,
          effects: null,
          usedWords: phraseVliw.usedWords,
          phraseEnds: [...(phraseVliw.phraseEnds ?? [])],
          moodIndex: phraseVliw.moodIndex ?? -1
        })
      };
    }
  });
  return {
    ...database,
    sourceRecordIds: resolved.map((record) => record.clauseIndex === undefined
      ? record.record.id
      : `${record.record.id}:clause-${record.clauseIndex}`),
    skippedRecordIds: result.records.filter((record) => record.status !== "resolved").map((record) => record.id)
  };
}

function pyaRow(key, value) {
  const payload = JSON.stringify(value, null, 2) ?? "null";
  return `su text ${JSON.stringify(key)} ob text quoted.text.${payload}.text.quoted ya`;
}

export function renderTranslationPipelinePya(result, { name = TRANSLATION_PIPELINE_NAME } = {}) {
  if (!result || result.format !== TRANSLATION_PIPELINE_FORMAT || !Array.isArray(result.records)) {
    throw invalid("translation renderer requires a pipeline result");
  }
  const lines = [
    `su name ${name} be map def`,
    pyaRow("format", TRANSLATION_PIPELINE_FORMAT),
    pyaRow("language", result.language),
    pyaRow("source-hash", result.sourceHash),
    pyaRow("sense-state-format", result.senseStateFormat ?? TRANSLATION_SENSE_STATE_FORMAT),
    pyaRow("resource-hashes", result.resourceHashes ?? {}),
    pyaRow("locator", result.locator),
    pyaRow("source-length", result.sourceLength),
    ...(result.wordnet ? [pyaRow("wordnet-refinery", result.wordnet)] : []),
    ...result.records.map((record) => pyaRow(`record:${record.id}`, record)),
    ...result.vocabularyCandidates.map((candidate) => pyaRow(`vocabulary:${candidate.id}`, candidate)),
    "prah"
  ];
  return `${lines.join("\n")}\n`;
}

export function parseTranslationPipelinePya(source, { name = TRANSLATION_PIPELINE_NAME } = {}) {
  if (typeof source !== "string") throw invalid("translation catalog source must be text");
  const sentences = buildProgram(source).sentences;
  const header = sentences.find((sentence) => (
    sentence?.mood === "def" && sentence?.be === "map" && sentence?.su?.name === name
  ));
  if (!header) throw invalid("translation catalog has no canonical map header");
  const metadata = {};
  const records = [];
  const vocabularyCandidates = [];
  for (const sentence of sentences) {
    if (sentence?.mood !== "ya" || typeof sentence.su?.text !== "string" || typeof sentence.ob?.text !== "string") continue;
    let payload;
    try {
      payload = JSON.parse(sentence.ob.text);
    } catch (error) {
      throw invalid("translation catalog row JSON is malformed", { key: sentence.su.text, cause: error.message });
    }
    if (sentence.su.text.startsWith("record:")) records.push(payload);
    else if (sentence.su.text.startsWith("vocabulary:")) vocabularyCandidates.push(payload);
    else metadata[sentence.su.text] = payload;
  }
  return {
    format: metadata.format,
    language: metadata.language,
    sourceHash: metadata["source-hash"],
    senseStateFormat: metadata["sense-state-format"] ?? "",
    resourceHashes: metadata["resource-hashes"] ?? {},
    locator: metadata.locator,
    sourceLength: metadata["source-length"],
    wordnet: metadata["wordnet-refinery"] ?? null,
    records,
    vocabularyCandidates
  };
}

export { analyzeDefaultEnglishSentence };
