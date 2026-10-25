import { createHash } from "node:crypto";

import { sentenceToPyash } from "../../../beautiful.mjs";
import { buildProgram } from "../../../program.mjs";
import { buildVliwDatabase } from "../../../library/vliw/index.mjs";
import {
  decodePhraseVliw,
  lowerSentencePhraseVliw,
  renderVliwPyac
} from "../../../library/vliw/phrase.mjs";
import {
  analyzeDefaultEnglishSentence,
  loadEnglishSentenceResources,
  resolveEnglishSentence
} from "./english_sentence.mjs";
import { renderPyacSentenceSurface } from "./pyash_surface.mjs";
import { resolveTranslationSource } from "./registry.mjs";

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

function stableId(parts) {
  return `translation-${hash(parts.join("\u0000")).slice(0, 24)}`;
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

function vocabularyCandidates({ recordId, language, sourceText, context, analysis }) {
  const unresolvedTokens = analysis.tokens.length > 0
    ? analysis.tokens.filter((token) => (
      cloneSequence(token?.pyashSequence).length === 0
      && !token?.copula
      && !token?.grammar
    ))
    : [{ surface: sourceText, coverageType: "unresolved", evidence: analysis.reason ?? "" }];
  return unresolvedTokens.map((token, tokenIndex) => {
    const surface = text(token.surface ?? sourceText);
    const candidateSequences = [
      ...analysis.candidates.filter((candidate) => (
        String(candidate?.phrase ?? "").toLowerCase().split(/\s+/u).includes(surface.toLowerCase())
      )),
      ...(Array.isArray(token?.semanticCandidates) ? token.semanticCandidates : [])
    ]
      .map((candidate) => cloneSequence(candidate?.pyashSequence))
      .filter((sequence) => sequence.length > 0);
    return {
      id: stableId(["vocabulary", language, recordId, String(tokenIndex), surface]),
      language,
      surface,
      kind: token.grammar ? "grammar-gap" : "lexical-gap",
      sourceRecordId: recordId,
      context: [...context],
      candidateSequences,
      evidence: tokenEvidence(token) || text(analysis.reason) || "source term remains unresolved",
      status: "queued"
    };
  });
}

function adapterSurfaceText(sourceText) {
  return sourceText.replace(/[。！？।॥]+$/u, ".");
}

async function analyzeSegment({ adapter, sourceText, context, verify }) {
  const adapterText = adapterSurfaceText(sourceText);
  let analysis;
  if (typeof adapter.analyzeSentence === "function") {
    analysis = await adapter.analyzeSentence(adapterText, { context });
    if (
      adapter.name === "english" &&
      analysis?.status !== "resolved" &&
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
  const pyashPreview = sentence
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
  const tokenCandidates = analysis.tokens.flatMap((token) => token.semanticCandidates ?? []);
  const hasReviewCandidates = analysis.candidates.length > 0 || tokenCandidates.length > 0;
  const unresolved = analysis.unresolved.length > 0
    ? [...new Set(analysis.unresolved.map(text).filter(Boolean))]
    : sentence || hasReviewCandidates ? [] : [segment.text];
  const status = sentence
    ? "resolved"
    : hasReviewCandidates
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
    ...(sentence ? { sentence, pyash: pyashPreview } : {}),
    ...(pyac ? { pyac, pyashSurface: pyac } : {}),
    ...(phraseVliw ? { vliw: phraseVliw } : {}),
    ...(canonical ? { canonical } : {}),
    ...(pyashPreview && !sentence ? { pyashPreview } : {}),
    ...(unresolved.length > 0 ? { unresolved } : {}),
    ...(analysis.candidates.length > 0 ? { candidates: analysis.candidates } : {}),
    ...(analysis.tokens.length > 0 ? {
      tokens: analysis.tokens.map((token) => ({
        surface: token.surface,
        coverageType: token.coverageType,
        pyashSequence: cloneSequence(token.pyashSequence),
        ...(token.lemma ? { lemma: token.lemma } : {}),
        ...(token.morphology ? { morphology: token.morphology } : {}),
        ...(tokenEvidence(token) ? { evidence: tokenEvidence(token) } : {})
      }))
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

export async function translateDocument({
  language,
  text: source,
  locator = "",
  contextRadius = 1,
  verify,
  resourceHashes,
  adapterResolver = resolveTranslationSource
} = {}) {
  const normalizedLanguage = normalizeLanguage(language);
  if (!normalizedLanguage) throw invalid("translation requires an explicit language");
  if (typeof source !== "string") throw invalid("translation requires source text");
  const adapter = adapterResolver(normalizedLanguage);
  if (!adapter) throw invalid("no translation adapter is registered for the source language", { language: normalizedLanguage });
  const segments = segmentTranslationDocument(source);
  const sourceHash = hash(source);
  const resolvedResourceHashes = resourceHashes ?? (
    normalizedLanguage === "english" ? await loadEnglishResourceHashes() : {}
  );
  const records = [];
  const vocabulary = [];
  for (const segment of segments) {
    const context = contextFor(segments, segment.sentenceIndex, Math.max(0, Math.trunc(Number(contextRadius) || 0)));
    const analysis = await analyzeSegment({
      adapter,
      sourceText: segment.text,
      context,
      verify
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

async function loadEnglishResourceHashes() {
  const resources = await loadEnglishSentenceResources();
  return {
    english30k: resources.source.sourceHash,
    englishLemmas: resources.lemmaCatalog.sourceHash,
    englishGrammar: resources.grammarCatalog.sourceHash
  };
}

export function lowerTranslationToPyac(result) {
  if (!result || !Array.isArray(result.records)) throw invalid("Pyac lowering requires translation records");
  const resolved = result.records.filter((record) => record.status === "resolved" && record.sentence);
  const sources = resolved.map((record) => ({
    language: result.language,
    locator: result.locator,
    sentenceId: record.id,
    sentenceIndex: record.source.sentenceIndex,
    lineIndex: record.source.lineIndex,
    startOffset: record.source.startOffset,
    endOffset: record.source.endOffset,
    text: record.source.text
  }));
  const database = buildVliwDatabase(resolved.map((record) => record.sentence), { sources });
  return {
    ...database,
    sourceRecordIds: resolved.map((record) => record.id),
    skippedRecordIds: result.records.filter((record) => record.status !== "resolved").map((record) => record.id)
  };
}

function pyaRow(key, value) {
  return `su text ${JSON.stringify(key)} ob text ${JSON.stringify(JSON.stringify(value))} ya`;
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
    pyaRow("resource-hashes", result.resourceHashes ?? {}),
    pyaRow("locator", result.locator),
    pyaRow("source-length", result.sourceLength),
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
    resourceHashes: metadata["resource-hashes"] ?? {},
    locator: metadata.locator,
    sourceLength: metadata["source-length"],
    records,
    vocabularyCandidates
  };
}

export { analyzeDefaultEnglishSentence };
