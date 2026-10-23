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
const NEGATION_GRAMMAR_KIND = "negation";
const PRESENT_TENSE_MARKER = "ra";
const PRESENT_TENSE_NAME = "present_tense_";

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

function pluralBaseCandidates(surface) {
  const word = surface.toLowerCase();
  const candidates = [];
  if (word.endsWith("ies")) candidates.push(`${word.slice(0, -3)}y`);
  if (word.endsWith("ves")) candidates.push(`${word.slice(0, -3)}f`, `${word.slice(0, -3)}fe`);
  if (word.endsWith("es")) candidates.push(word.slice(0, -2), word.slice(0, -1));
  if (word.endsWith("s")) candidates.push(word.slice(0, -1));
  return [...new Set(candidates.filter((candidate) => candidate.length > 1))];
}

function wordRecord(surface, { resolveWord, lemmaBySurface, grammarIndex } = {}) {
  const normalized = surface.toLowerCase();
  const coverage = typeof resolveWord === "function" ? resolveWord(normalized) : null;
  const lemma = lemmaBySurface?.get(normalized) ?? null;
  const grammar = grammarIndex?.resolve(normalized) ?? null;
  let pyashSequence = coverage?.pyashSequence?.length
    ? [...coverage.pyashSequence]
    : grammar?.pyashSequence?.length
      ? [...grammar.pyashSequence]
      : [];
  const morphology = cloneMorphology(coverage?.morphology ?? lemma?.morphology);
  let grammaticalNumber = coverage?.grammaticalNumber ?? lemma?.grammaticalNumber ?? "";
  if (!grammar && !morphology && grammaticalNumber !== "plural" && pyashSequence.length > 0 && normalized.endsWith("s")) {
    const singular = pluralBaseCandidates(normalized)
      .map((candidate) => ({ candidate, coverage: typeof resolveWord === "function" ? resolveWord(candidate) : null }))
      .find((row) => row.coverage?.pyashSequence?.length);
    if (singular) {
      pyashSequence = [...singular.coverage.pyashSequence, "pu"];
      grammaticalNumber = "plural";
    }
  }
  if (grammaticalNumber === "plural" && !pyashSequence.includes("pu")) pyashSequence.push("pu");
  return {
    surface: normalized,
    coverageType: coverage?.coverageType ?? (grammar ? "grammar" : "unresolved"),
    lemma: coverage?.lemma ?? lemma?.lemma ?? "",
    pyashSequence,
    morphology,
    grammaticalNumber,
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

function subjectPredicateStart(records) {
  if (records[0]?.grammar?.kind === "pronoun" || records[0]?.grammar?.kind === "possessive-pronoun") return 1;
  if (records[0]?.grammar?.position !== "prefix") return 1;
  let index = 1;
  if (records[index]?.pyashSequence?.length && !records[index]?.grammar) index += 1;
  while (index < records.length && records[index]?.grammar?.kind === "conjunction") {
    index += 1;
    if (records[index]?.grammar?.position === "prefix") index += 1;
    if (records[index]?.pyashSequence?.length) index += 1;
  }
  return index;
}

function findLexicalVerbIndex(records, startIndex = subjectPredicateStart(records)) {
  for (let index = startIndex; index < records.length; index += 1) {
    const record = records[index];
    if (!record?.pyashSequence?.length || record.grammar) continue;
    if (record.morphology?.kind === "progressive") continue;
    return index;
  }
  return -1;
}

function findImperativeVerbIndex(records) {
  if (!records[0]?.pyashSequence?.length || records[0].grammar || records[0].morphology) return -1;
  const following = records[1];
  if (!following) return -1;
  if (following.grammar?.kind === "pronoun"
    || following.grammar?.kind === "possessive-determiner"
    || following.grammar?.kind === NEGATION_GRAMMAR_KIND
    || following.grammar?.position === "link") return 0;
  return -1;
}

function findProgressiveIndex(records) {
  for (let index = 1; index < records.length; index += 1) {
    if (records[index].morphology?.kind !== "progressive") continue;
    let previousIndex = index - 1;
    while (previousIndex >= 0 && records[previousIndex]?.grammar?.kind === NEGATION_GRAMMAR_KIND) previousIndex -= 1;
    const previous = records[previousIndex];
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

function makeSubjectPhrase(records, verbIndex) {
  if (verbIndex === 0) {
    return {
      surface: "you",
      coverageType: "grammar",
      pyashSequence: ["sa"],
      grammar: { kind: "pronoun", components: ["you_"], position: "standalone" },
      evidence: "English imperative uses the understood second-person subject"
    };
  }
  const phraseRecords = records.slice(0, verbIndex);
  const first = phraseRecords[0] ?? records[0];
  return {
    ...first,
    surface: phraseRecords.map((record) => record.surface).join(" "),
    pyashSequence: phraseRecords.flatMap((record) => record.pyashSequence)
  };
}

function hasNegation(records, verbIndex) {
  return records.some((record, index) => index > verbIndex && record.grammar?.kind === NEGATION_GRAMMAR_KIND);
}

function objectRecordsAfter(records, verbIndex) {
  return verbIndex >= 0
    ? records.slice(verbIndex + 1).filter((record) => record.grammar?.kind !== NEGATION_GRAMMAR_KIND)
    : [];
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
  const progressiveIndex = findProgressiveIndex(records);
  const finiteIndex = findVerbIndex(records);
  const imperativeIndex = progressiveIndex < 0 && finiteIndex < 0 ? findImperativeVerbIndex(records) : -1;
  const lexicalIndex = progressiveIndex < 0 && finiteIndex < 0 && imperativeIndex < 0
    ? findLexicalVerbIndex(records)
    : -1;
  let verbIndex = progressiveIndex >= 0
    ? progressiveIndex
    : finiteIndex >= 0
      ? finiteIndex
      : lexicalIndex >= 0
        ? lexicalIndex
        : imperativeIndex;
  let verbPhrase = null;

  if (progressiveIndex >= 0) {
    let auxiliaryIndex = progressiveIndex - 1;
    while (auxiliaryIndex >= 0 && records[auxiliaryIndex]?.grammar?.kind === NEGATION_GRAMMAR_KIND) auxiliaryIndex -= 1;
    const auxiliary = records[auxiliaryIndex];
    const progressive = records[progressiveIndex];
    if (progressive.pyashSequence.length > 0) {
      const morphology = progressive.morphology;
      const auxiliaryMorphology = auxiliary.morphology;
      const negated = hasNegation(records, progressiveIndex);
      verbPhrase = makeCandidate({
        phrase: tokens.slice(auxiliaryIndex, progressiveIndex + 1).join(" "),
        lemma: progressive.lemma,
        lexicalSequence: progressive.pyashSequence,
        morphologySequence: [
          ...(morphology?.markerSequence ?? []),
          ...(auxiliaryMorphology?.markerSequence ?? []),
          ...(negated ? ["no"] : [])
        ],
        markerNames: [
          ...(morphology?.markerNames ?? []),
          ...(auxiliaryMorphology?.markerNames ?? []),
          ...(negated ? ["negatory_quantifier_"] : [])
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
      const negated = hasNegation(records, finiteIndex);
      verbPhrase = makeCandidate({
        phrase: tokens[finiteIndex],
        lemma: finite.lemma,
        lexicalSequence: finite.pyashSequence,
        morphologySequence: [...morphology.markerSequence, ...(negated ? ["no"] : [])],
        markerNames: [...morphology.markerNames, ...(negated ? ["negatory_quantifier_"] : [])],
        certainty: morphology.certainty,
        evidence: morphology.evidence
      });
    }
  }

  if (!verbPhrase && (lexicalIndex >= 0 || imperativeIndex >= 0)) {
    const selectedIndex = lexicalIndex >= 0 ? lexicalIndex : imperativeIndex;
    const lexical = records[selectedIndex];
    if (lexical.pyashSequence.length > 0) {
      const negated = hasNegation(records, selectedIndex);
      verbPhrase = makeCandidate({
        phrase: tokens[selectedIndex],
        lemma: lexical.lemma,
        lexicalSequence: lexical.pyashSequence,
        morphologySequence: [PRESENT_TENSE_MARKER, ...(negated ? ["no"] : [])],
        markerNames: [PRESENT_TENSE_NAME, ...(negated ? ["negatory_quantifier_"] : [])],
        certainty: "contextual",
        evidence: "sentence context supplies a present-tense lexical predicate"
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
        morphologySequence: [...progressive.morphology.markerSequence, ...(hasNegation(records, verbIndex) ? ["no"] : [])],
        markerNames: [...progressive.morphology.markerNames, ...(hasNegation(records, verbIndex) ? ["negatory_quantifier_"] : [])],
        certainty: "contextual",
        evidence: progressive.morphology.evidence
      });
    }
  }

  const consumedIndexes = new Set();
  for (let index = 0; index < Math.max(0, verbIndex); index += 1) consumedIndexes.add(index);
  if (progressiveIndex >= 0) {
    let auxiliaryIndex = progressiveIndex - 1;
    while (auxiliaryIndex >= 0 && records[auxiliaryIndex]?.grammar?.kind === NEGATION_GRAMMAR_KIND) auxiliaryIndex -= 1;
    consumedIndexes.add(auxiliaryIndex);
    consumedIndexes.add(progressiveIndex);
  } else if (finiteIndex >= 0) {
    consumedIndexes.add(finiteIndex);
  } else if (verbIndex >= 0) {
    consumedIndexes.add(verbIndex);
  }
  const unresolved = records
    .filter((record, index) => (
      record.pyashSequence.length === 0
      && !consumedIndexes.has(index)
      && record.grammar?.kind !== NEGATION_GRAMMAR_KIND
    ))
    .map((record) => record.surface);
  let subjectBoundary = verbIndex;
  if (progressiveIndex >= 0) {
    subjectBoundary = progressiveIndex - 1;
    while (subjectBoundary >= 0 && records[subjectBoundary]?.grammar?.kind === NEGATION_GRAMMAR_KIND) subjectBoundary -= 1;
  }
  const subject = makeSubjectPhrase(records, subjectBoundary);
  const subjectRecords = subjectBoundary > 0 ? records.slice(0, subjectBoundary) : [];
  const subjectRecordsReady = subjectRecords.every((record) => record.pyashSequence.length > 0);
  const subjectReady = subject.pyashSequence.length > 0
    && subjectRecordsReady
    && (verbIndex === 0 || isSubject(subject) || subject.pyashSequence.some(Boolean));
  const objectRecords = objectRecordsAfter(records, verbIndex);
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
    verbIndex,
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
  const verbIndex = Number.isInteger(analysis.verbIndex)
    ? analysis.verbIndex
    : analysis.tokens.findIndex((record) => record.surface === candidate.phrase.split(" ").at(-1));
  const objectRecords = objectRecordsAfter(analysis.tokens, verbIndex);
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
