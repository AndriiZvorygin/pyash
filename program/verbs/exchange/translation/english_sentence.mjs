import { sentenceToPyash } from "../../../beautiful.mjs";
import pyashWords from "../../../library/pyashWords.json" with { type: "json" };
import {
  loadDefaultEnglish30kCoverage,
  lookupEnglish30kCoverage
} from "./english30k_coverage.mjs";
import { loadEnglishGrammarCatalog, buildEnglishGrammarIndex } from "./english_grammar.mjs";
import { loadEnglishLemmaCatalog } from "./english_lemmas.mjs";

export const ENGLISH_SENTENCE_FORMAT = "english-sentence-v1";

const SUBJECT_GRAMMAR_KINDS = new Set(["pronoun", "possessive-pronoun"]);

let defaultResourcesPromise = null;

function invalid(message) {
  const error = new Error(message);
  error.code = "invalid-english-sentence";
  return error;
}
export function tokenizeEnglishSentence(source) {
  if (typeof source !== "string") throw invalid("English sentence must be text");
  return source.normalize("NFC").match(/[A-Za-z]+(?:'[A-Za-z]+)?/gu) ?? [];
}

function cloneMorphology(morphology) {
  if (!morphology) return null;
  return {
    ...morphology,
    markerNames: [...morphology.markerNames],
    markerSequence: [...morphology.markerSequence]
  };
}

function wordRecord(surface, { resolveWord, lemmaBySurface, grammarIndex } = {}) {
  const normalized = surface.toLowerCase();
  const coverage = typeof resolveWord === "function" ? resolveWord(normalized) : null;
  const lemma = lemmaBySurface?.get(normalized) ?? null;
  const grammar = grammarIndex?.resolve(normalized) ?? null;
  const pyashSequence = coverage?.pyashSequence?.length
    ? [...coverage.pyashSequence]
    : grammar?.pyashSequence?.length
      ? [...grammar.pyashSequence]
      : [];
  const morphology = cloneMorphology(coverage?.morphology ?? lemma?.morphology);
  return {
    surface: normalized,
    coverageType: coverage?.coverageType ?? (grammar ? "grammar" : "unresolved"),
    lemma: coverage?.lemma ?? lemma?.lemma ?? "",
    pyashSequence,
    morphology,
    grammar: grammar ? {
      kind: grammar.kind,
      components: [...grammar.components],
      position: grammar.position
    } : null,
    evidence: coverage?.lemmaEvidence ?? coverage?.provenance ?? lemma?.evidence ?? grammar?.evidence ?? ""
  };
}

function isSubject(record) {
  return SUBJECT_GRAMMAR_KINDS.has(record?.grammar?.kind)
    || (record?.coverageType === "grammar" && record?.pyashSequence?.length > 0);
}

function findVerbIndex(records) {
  for (let index = 1; index < records.length; index += 1) {
    const morphology = records[index].morphology;
    if (morphology?.kind === "finite-past" || morphology?.kind === "finite-present") return index;
  }
  return -1;
}

function findProgressiveIndex(records) {
  for (let index = 1; index < records.length; index += 1) {
    if (records[index].morphology?.kind !== "progressive") continue;
    const previous = records[index - 1];
    if (previous?.morphology?.kind === "finite-past" || previous?.morphology?.kind === "finite-present") {
      return index;
    }
  }
  return -1;
}

function makeCandidate({ phrase, lemma, lexicalSequence, morphologySequence, markerNames, certainty, evidence }) {
  const pyashSequence = [...lexicalSequence, ...morphologySequence];
  return {
    id: `${phrase.toLowerCase()}::${pyashSequence.join(" ")}`,
    phrase,
    lemma,
    lexicalSequence: [...lexicalSequence],
    morphologySequence: [...morphologySequence],
    markerNames: [...markerNames],
    certainty,
    evidence,
    pyashSequence
  };
}

function makeSentence(subject, verbPhrase, objectRecords) {
  const sentence = {
    mood: "ya",
    su: { name: subject.pyashSequence.join(" ") },
    be: verbPhrase.pyashSequence.join(" ")
  };
  if (objectRecords.length > 0) {
    sentence.ob = { name: objectRecords.flatMap((record) => record.pyashSequence).join(" ") };
  }
  return sentence;
}

export function analyzeEnglishSentence(source, {
  resolveWord,
  lemmaEntries = [],
  grammarIndex
} = {}) {
  const tokens = tokenizeEnglishSentence(source);
  if (tokens.length === 0) {
    return { format: ENGLISH_SENTENCE_FORMAT, sourceText: source, status: "review", reason: "sentence has no words", tokens: [] };
  }
  const lemmaBySurface = new Map(
    lemmaEntries
      .filter((entry) => entry?.surface)
      .map((entry) => [entry.surface.toLowerCase(), entry])
  );
  const records = tokens.map((token) => wordRecord(token, { resolveWord, lemmaBySurface, grammarIndex }));
  const subject = records[0];
  const progressiveIndex = findProgressiveIndex(records);
  const finiteIndex = findVerbIndex(records);
  let verbIndex = progressiveIndex >= 0 ? progressiveIndex : finiteIndex;
  let verbPhrase = null;

  if (progressiveIndex >= 0) {
    const auxiliary = records[progressiveIndex - 1];
    const progressive = records[progressiveIndex];
    if (progressive.pyashSequence.length > 0) {
      const morphology = progressive.morphology;
      const auxiliaryMorphology = auxiliary.morphology;
      verbPhrase = makeCandidate({
        phrase: tokens.slice(progressiveIndex - 1, progressiveIndex + 1).join(" "),
        lemma: progressive.lemma,
        lexicalSequence: progressive.pyashSequence,
        morphologySequence: [
          ...(morphology?.markerSequence ?? []),
          ...(auxiliaryMorphology?.markerSequence ?? [])
        ],
        markerNames: [
          ...(morphology?.markerNames ?? []),
          ...(auxiliaryMorphology?.markerNames ?? [])
        ],
        certainty: "deterministic",
        evidence: [morphology?.evidence, auxiliaryMorphology?.evidence].filter(Boolean).join("; ")
      });
    }
  }

  if (!verbPhrase && finiteIndex >= 0) {
    const finite = records[finiteIndex];
    const morphology = finite.morphology;
    if (finite.pyashSequence.length > 0 && morphology) {
      verbPhrase = makeCandidate({
        phrase: tokens[finiteIndex],
        lemma: finite.lemma,
        lexicalSequence: finite.pyashSequence,
        morphologySequence: morphology.markerSequence,
        markerNames: morphology.markerNames,
        certainty: morphology.certainty,
        evidence: morphology.evidence
      });
    }
  }

  if (!verbPhrase) {
    const progressive = records.find((record) => record.morphology?.kind === "progressive");
    if (progressive?.pyashSequence?.length && progressive.morphology) {
      verbIndex = records.indexOf(progressive);
      verbPhrase = makeCandidate({
        phrase: progressive.surface,
        lemma: progressive.lemma,
        lexicalSequence: progressive.pyashSequence,
        morphologySequence: progressive.morphology.markerSequence,
        markerNames: progressive.morphology.markerNames,
        certainty: "contextual",
        evidence: progressive.morphology.evidence
      });
    }
  }

  const consumedIndexes = new Set();
  if (progressiveIndex >= 0) {
    consumedIndexes.add(progressiveIndex - 1);
    consumedIndexes.add(progressiveIndex);
  } else if (finiteIndex >= 0) {
    consumedIndexes.add(finiteIndex);
  }
  const unresolved = records
    .filter((record, index) => record.pyashSequence.length === 0 && !consumedIndexes.has(index))
    .map((record) => record.surface);
  const subjectReady = isSubject(subject) && subject.pyashSequence.length > 0;
  const objectRecords = verbIndex >= 0 ? records.slice(verbIndex + 1) : [];
  const objectReady = objectRecords.every((record) => record.pyashSequence.length > 0);
  const deterministic = Boolean(verbPhrase)
    && verbPhrase.certainty === "deterministic"
    && subjectReady
    && unresolved.length === 0
    && objectReady;
  const sentence = deterministic ? makeSentence(subject, verbPhrase, objectRecords) : null;
  return {
    format: ENGLISH_SENTENCE_FORMAT,
    sourceText: source,
    status: deterministic ? "resolved" : "review",
    tokens: records,
    subject,
    verbPhrase,
    candidates: verbPhrase ? [verbPhrase] : [],
    unresolved,
    sentence,
    pyash: sentence ? sentenceToPyash(sentence) : verbPhrase?.pyashSequence?.join(" ") ?? ""
  };
}

export async function loadDefaultEnglishSentenceResources() {
  if (!defaultResourcesPromise) {
    defaultResourcesPromise = Promise.all([
      loadDefaultEnglish30kCoverage({ atomicEntries: pyashWords }),
      loadEnglishLemmaCatalog(),
      loadEnglishGrammarCatalog()
    ]).then(([coverage, lemmaCatalog, grammarCatalog]) => ({
      coverage,
      lemmaCatalog,
      grammarIndex: buildEnglishGrammarIndex({ catalogEntries: grammarCatalog.entries })
    }));
  }
  return defaultResourcesPromise;
}

export async function analyzeDefaultEnglishSentence(source) {
  const { coverage, lemmaCatalog, grammarIndex } = await loadDefaultEnglishSentenceResources();
  return analyzeEnglishSentence(source, {
    resolveWord: (word) => lookupEnglish30kCoverage(coverage, word),
    lemmaEntries: lemmaCatalog.entries,
    grammarIndex
  });
}

export async function resolveEnglishSentence(source, {
  analyze = analyzeDefaultEnglishSentence,
  verify
} = {}) {
  const analysis = await analyze(source);
  if (analysis.status === "resolved" || typeof verify !== "function" || analysis.candidates.length === 0) {
    return analysis;
  }
  const review = await verify({
    sourceText: source,
    analysis,
    candidates: analysis.candidates
  });
  if (review?.verdict !== "accept" || !review.candidateId) {
    return { ...analysis, review };
  }
  return applyEnglishSentenceCandidate(analysis, review.candidateId);
}

export function applyEnglishSentenceCandidate(analysis, candidateId) {
  const candidate = analysis?.candidates?.find((row) => row.id === candidateId);
  if (!candidate) return analysis;
  const subject = analysis.subject;
  const verbIndex = analysis.tokens.findIndex((record) => record.surface === candidate.phrase.split(" ").at(-1));
  const objectRecords = verbIndex >= 0 ? analysis.tokens.slice(verbIndex + 1) : [];
  const sentence = subject?.pyashSequence?.length && objectRecords.every((record) => record.pyashSequence.length > 0)
    ? makeSentence(subject, candidate, objectRecords)
    : null;
  return {
    ...analysis,
    status: sentence ? "resolved" : "review",
    verbPhrase: candidate,
    sentence,
    pyash: sentence ? sentenceToPyash(sentence) : candidate.pyashSequence.join(" ")
  };
}
