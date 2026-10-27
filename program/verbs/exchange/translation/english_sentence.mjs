import { createHash } from "node:crypto";

import { sentenceToPyash } from "../../../beautiful.mjs";
import pyashWords from "../../../library/pyashWords.json" with { type: "json" };
import {
  DEFAULT_GRAMMAR_MAPPINGS,
  buildEnglish30kCoverage,
  loadEnglish30k,
  english30kLookupVariants,
  lookupEnglish30kCoverage
} from "./english30k_coverage.mjs";
import { loadAnchorWordForms } from "./anchor_words.mjs";
import {
  buildEnglishDictionaryAliases,
  loadEnglishDictionaryBlacklist
} from "./english_dictionary_aliases.mjs";
import { loadEnglishGrammarCatalog, buildEnglishGrammarIndex } from "./english_grammar.mjs";
import { buildEnglishLemmaIndex, loadEnglishLemmaCatalog } from "./english_lemmas.mjs";
import { buildEnglishWordNetIndex, loadEnglishWordNet } from "./english_wordnet.mjs";
import { loadEnglishWordNetBridges } from "./english_wordnet_bridges.mjs";
import { loadCuratedCompoundDecompositions } from "./compound_coverage.mjs";
import { compositionalGrid } from "../../../library/compositionalCases.mjs";
import { translationOccurrenceKey } from "./translation_occurrence.mjs";

export const ENGLISH_SENTENCE_FORMAT = "english-sentence-v1";

const SUBJECT_GRAMMAR_KINDS = new Set(["pronoun", "possessive-pronoun"]);
const NEGATION_GRAMMAR_KIND = "negation";
const PRESENT_TENSE_MARKER = "ra";
const PRESENT_TENSE_NAME = "present_tense_";
const NOMINATIVE_MARKER = "na";
const ACCUSATIVE_MARKER = "ka";
const COPULA_SURFACES = new Set(["be", "am", "is", "are", "was", "were", "been", "being"]);
const COMPOSITIONAL_CASE_INDEX = new Map(
  Object.values(compositionalGrid)
    .flatMap((context) => ["source", "way", "destination"]
      .map((axis) => context[axis])
      .filter((entry) => entry?.keyword && entry?.pya)
      .map((entry) => [entry.keyword, {
        axis: entry.axis,
        case: entry.case,
        keyword: entry.keyword,
        pya: entry.pya
      }]))
);
const COMPOSITIONAL_CASE_ALIASES = new Map([
  ["within", "in"],
  ["inside", "in"],
  ["through", "in"],
  ["before", "since"],
  ["after", "until"],
  ["below", "beneath"],
  ["upon", "on"]
]);
const WORDNET_CONTEXT_STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "but", "by", "can", "for", "from",
  "has", "have", "in", "into", "is", "it", "of", "on", "or", "that", "the", "their",
  "there", "these", "this", "those", "to", "was", "were", "with",
  "certain", "different", "many", "other", "particular", "same", "several", "various"
]);
const WORDNET_MODAL_PRECEDERS = new Set([
  "can", "could", "may", "might", "must", "shall", "should", "will", "would"
]);
const WORDNET_NOUN_PRECEDERS = new Set([
  "a", "an", "the", "this", "that", "these", "those", "some", "many", "another", "each",
  "my", "your", "our", "their", "of", "for", "from", "with", "in", "on", "within", "into"
]);
const WORDNET_GRAPH_SELECTION_MIN_MARGIN = 0.3;

let defaultResourcesPromise = null;
let sentenceResourcesPromise = null;

function stableResourceValue(value) {
  if (Array.isArray(value)) return value.map(stableResourceValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, stableResourceValue(value[key])])
    );
  }
  return value;
}

function resourceHash(value) {
  return createHash("sha256")
    .update(JSON.stringify(stableResourceValue(value)))
    .digest("hex");
}

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

function wordNetLookupVariants(surface) {
  const normalized = surface.toLowerCase();
  return [
    normalized,
    ...pluralBaseCandidates(normalized),
    ...(normalized.endsWith("ed") ? [normalized.slice(0, -2)] : []),
    ...(normalized.endsWith("ing") ? [normalized.slice(0, -3), `${normalized.slice(0, -3)}e`] : [])
  ].filter((value, index, values) => value.length > 1 && values.indexOf(value) === index);
}

function wordNetTerms(value) {
  return wordNetLookupVariants(value)
    .flatMap((variant) => variant.split(/\s+/u))
    .map((term) => term.replace(/^[^a-z0-9]+|[^a-z0-9]+$/giu, ""))
    .filter((term) => term.length > 2);
}

function wordNetMetadata(surface, wordnetIndex) {
  if (!wordnetIndex?.lookup) return null;
  const variants = wordNetLookupVariants(surface);
  const rowsByVariant = variants.map((variant) => wordnetIndex.lookup(variant));
  const inflectionRows = rowsByVariant.slice(1).flat();
  const preferInflectedVerb = surface.toLowerCase().endsWith("ing")
    && inflectionRows.some((row) => row.pos === "v");
  const rows = (preferInflectedVerb
    ? rowsByVariant[0].concat(inflectionRows.filter((row) => row.pos === "v"))
    : rowsByVariant.flat())
    .filter((row, index, matches) => matches.findIndex((candidate) => candidate.id === row.id) === index);
  if (rows.length === 0) return null;
  const senses = rows.map((row) => ({
    pos: row.pos,
    synset: row.synset,
    lemma: row.lemma,
    gloss: row.gloss,
    lemmas: wordnetIndex.bySynset?.get(`${row.pos}:${row.synset}`)?.map((candidate) => candidate.lemma) ?? [row.lemma]
  }));
  return {
    partsOfSpeech: [...new Set(rows.map((row) => row.pos))],
    senses,
    evidence: senses.map((sense) => `${sense.pos}:${sense.synset}${sense.gloss ? ` ${sense.gloss}` : ""}`).join("; ")
  };
}

function isVerbOnlyWordNetRecord(surface, wordnetIndex) {
  const metadata = wordNetMetadata(surface, wordnetIndex);
  return Boolean(metadata?.partsOfSpeech?.length)
    && metadata.partsOfSpeech.every((partOfSpeech) => partOfSpeech === "v");
}

function wordNetContextTerms(records, index) {
  const terms = new Set();
  const start = Math.max(0, index - 4);
  const end = Math.min(records.length, index + 5);
  for (let contextIndex = start; contextIndex < end; contextIndex += 1) {
    if (contextIndex === index) continue;
    const record = records[contextIndex];
    for (const value of [record?.surface, record?.lemma]) {
      for (const term of wordNetTerms(value)) {
        if (!WORDNET_CONTEXT_STOP_WORDS.has(term)) terms.add(term);
      }
    }
  }
  return terms;
}

export function wordNetSenseKey(sense) {
  return `${sense?.pos ?? ""}:${sense?.synset ?? ""}`;
}

function wordNetGraphContext(sense, records, index, wordnetIndex) {
  if (typeof wordnetIndex?.relatedness !== "function") return { score: 0, matched: [] };
  const matched = [];
  let score = 0;
  for (let contextIndex = 0; contextIndex < records.length; contextIndex += 1) {
    if (contextIndex === index) continue;
    const contextRecord = records[contextIndex];
    const related = (contextRecord?.wordnet?.senses ?? [])
      .map((contextSense) => ({
        score: wordnetIndex.relatedness(wordNetSenseKey(sense), wordNetSenseKey(contextSense)),
        surface: contextRecord.surface
      }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score)[0];
    if (!related) continue;
    score += related.score;
    matched.push(`${related.surface} (${related.score})`);
  }
  return { score, matched };
}

function expectedWordNetPartsOfSpeech(records, index) {
  const expected = new Set();
  const record = records[index];
  const previous = records[index - 1];
  const next = records[index + 1];
  const previousTwo = records[index - 2];
  if (!record) return expected;
  if (WORDNET_MODAL_PRECEDERS.has(previous?.surface) || WORDNET_MODAL_PRECEDERS.has(previousTwo?.surface)) {
    expected.add("v");
  }
  if (WORDNET_NOUN_PRECEDERS.has(previous?.surface)) expected.add("n");
  if (previous?.surface === "and" || previous?.surface === "or") {
    if (previousTwo?.wordnet?.partsOfSpeech?.includes("n")) expected.add("n");
  }
  if (previous?.wordnet?.partsOfSpeech?.includes("a")) expected.add("n");
  if (previous?.grammar?.kind === "pronoun") expected.add("v");
  if (next && ["a", "an", "the", "this", "that", "these", "those"].includes(next.surface)) {
    expected.add("v");
  }
  if (next?.wordnet?.partsOfSpeech?.some((partOfSpeech) => ["a", "s"].includes(partOfSpeech))) {
    expected.add("v");
  }
  if (record.surface.endsWith("ing") && ["is", "are", "was", "were", "be", "been", "being"].includes(previous?.surface)) {
    expected.add("v");
  }
  if (record.surface.endsWith("s") && !WORDNET_MODAL_PRECEDERS.has(previous?.surface)
    && previous?.surface !== "to" && !expected.has("v")) {
    expected.add("n");
  }
  return expected;
}

function wordNetSenseContext(sense, contextTerms, records, index, wordnetIndex) {
  const senseTerms = new Set([
    ...wordNetTerms(sense?.gloss ?? ""),
    ...(sense?.lemmas ?? []).flatMap((lemma) => wordNetTerms(lemma))
  ]);
  const matched = [...contextTerms].filter((term) => senseTerms.has(term));
  const graph = wordNetGraphContext(sense, records, index, wordnetIndex);
  return {
    score: (matched.length * 2) + graph.score,
    matched: [
      ...matched,
      ...graph.matched.map((term) => `graph:${term}`)
    ]
  };
}

export function selectEnglishWordNetSenses(record, records, index, wordnetIndex) {
  const allSenses = record?.wordnet?.senses ?? [];
  const expectedPartsOfSpeech = expectedWordNetPartsOfSpeech(records, index);
  const filteredSenses = allSenses.filter((sense) => expectedPartsOfSpeech.has(sense.pos));
  const senses = filteredSenses.length > 0 ? filteredSenses : allSenses;
  if (senses.length < 2) return { senses, evidence: "" };
  const contextTerms = wordNetContextTerms(records, index);
  if (contextTerms.size === 0) return { senses, evidence: "" };
  const scored = senses.map((sense) => ({
    sense,
    context: wordNetSenseContext(sense, contextTerms, records, index, wordnetIndex)
  }));
  const bestScore = Math.max(...scored.map((entry) => entry.context.score));
  if (bestScore <= 0) return { senses, evidence: "" };
  const selected = scored.filter((entry) => entry.context.score === bestScore);
  if (selected.length !== 1) return { senses, evidence: "" };
  const rankedScores = scored
    .map((entry) => entry.context.score)
    .sort((left, right) => right - left);
  const secondBestScore = rankedScores[1] ?? 0;
  const directMatches = selected[0].context.matched.filter((term) => !term.startsWith("graph:"));
  if (directMatches.length === 0
    && (bestScore - secondBestScore) < WORDNET_GRAPH_SELECTION_MIN_MARGIN) {
    return { senses, evidence: "" };
  }
  return {
    senses: selected.map((entry) => entry.sense),
    evidence: `sentence context matched ${entryTerms(selected[0].context.matched)}`
  };
}

function entryTerms(terms) {
  return terms.join(", ");
}

function wordRecord(surface, {
  resolveWord,
  lemmaBySurface,
  grammarIndex,
  wordnetIndex,
  tokenIndex
} = {}) {
  const normalized = surface.toLowerCase();
  let coverage = typeof resolveWord === "function" ? resolveWord(normalized, tokenIndex) : null;
  const lemma = lemmaBySurface?.get(normalized) ?? null;
  const catalogGrammar = grammarIndex?.resolve(normalized) ?? null;
  const compositionalCase = COMPOSITIONAL_CASE_INDEX.get(normalized)
    ?? COMPOSITIONAL_CASE_INDEX.get(COMPOSITIONAL_CASE_ALIASES.get(normalized))
    ?? null;
  const grammar = catalogGrammar ?? (compositionalCase ? {
    kind: "case-marker",
    components: [compositionalCase.case],
    pyashSequence: [compositionalCase.pya],
    position: "link",
    evidence: `compositional ${compositionalCase.keyword} maps to ${compositionalCase.case}`
  } : null);
  let pyashSequence = grammar?.pyashSequence?.length
    ? [...grammar.pyashSequence]
    : coverage?.pyashSequence?.length
      ? [...coverage.pyashSequence]
      : [];
  const morphology = cloneMorphology(coverage?.morphology ?? lemma?.morphology);
  let grammaticalNumber = coverage?.grammaticalNumber ?? lemma?.grammaticalNumber ?? "";
  if (!grammar && !morphology && grammaticalNumber !== "plural" && normalized.endsWith("s")) {
    const singular = pluralBaseCandidates(normalized)
      .map((candidate) => ({ candidate, coverage: typeof resolveWord === "function" ? resolveWord(candidate, tokenIndex) : null }))
      .find((row) => row.coverage?.pyashSequence?.length
        && row.coverage.coverageType !== "dictionary-alias");
    if (singular) {
      coverage = singular.coverage;
      pyashSequence = [...singular.coverage.pyashSequence];
      if (!isVerbOnlyWordNetRecord(singular.candidate, wordnetIndex)) {
        pyashSequence.push("pu");
        grammaticalNumber = "plural";
      }
    }
  }
  const wordnet = lemma?.lemma && lemma.lemma !== normalized
    ? (wordNetMetadata(lemma.lemma, wordnetIndex) ?? wordNetMetadata(normalized, wordnetIndex))
    : wordNetMetadata(normalized, wordnetIndex);
  if (coverage?.coverageType === "dictionary-alias" && wordnet?.senses?.length > 1) {
    coverage = null;
    pyashSequence = [];
    grammaticalNumber = "";
  }
  if (grammaticalNumber === "plural" && !pyashSequence.includes("pu")) pyashSequence.push("pu");
  return {
    surface: normalized,
    coverageType: coverage?.coverageType ?? (grammar ? "grammar" : "unresolved"),
    lemma: coverage?.lemma ?? lemma?.lemma ?? "",
    pyashSequence,
    morphology,
    copula: COPULA_SURFACES.has(normalized),
    grammaticalNumber,
    compositionalCase,
    grammar: grammar ? {
      kind: grammar.kind,
      components: [...grammar.components],
      position: grammar.position
    } : null,
    wordnet,
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
    if (records[index].copula) continue;
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
    if (!record?.pyashSequence?.length || record.grammar || record.copula) continue;
    if (record.wordnetPartOfSpeech && record.wordnetPartOfSpeech !== "v") continue;
    if (record.wordnet?.partsOfSpeech?.length && !record.wordnet.partsOfSpeech.includes("v")) continue;
    if (record.morphology?.kind === "progressive") continue;
    return index;
  }
  return -1;
}

function applyContextualEnglishGrammar(records, grammarIndex) {
  const exemplifier = grammarIndex?.resolve("such as");
  return records.map((record, index) => {
    if (record.surface === "such" && records[index + 1]?.surface === "as" && exemplifier) {
      return {
        ...record,
        coverageType: "grammar",
        pyashSequence: [...exemplifier.pyashSequence],
        grammar: { ...exemplifier },
        construction: {
          kind: "exemplifier",
          category: "exemplification",
          evidence: "such as lowers to the example_ referential head with the space-way case ga"
        },
        evidence: "such as lowers to the example_ referential head with the space-way case ga"
      };
    }
    if (record.surface === "as" && records[index - 1]?.surface === "such" && exemplifier) {
      return {
        ...record,
        coverageType: "grammar",
        pyashSequence: [],
        grammar: { ...exemplifier },
        consumedBy: "such as",
        evidence: "as is consumed by the preceding such as exemplifier construction"
      };
    }
    if (record.copula) {
      const following = records[index + 1];
      const passiveParticiple = following
        && following.pyashSequence.length > 0
        && following.morphology?.kind !== "progressive"
        && (following.morphology?.kind === "participle"
          || /(?:ed|en)$/u.test(following.surface)
          || following.wordnet?.partsOfSpeech?.includes("v"));
      if (passiveParticiple) {
        return {
          ...record,
          construction: {
            kind: "passive-auxiliary",
            evidence: "copula plus a participial predicate is a passive-voice construction"
          }
        };
      }
    }
    if (record.surface === "that") {
      const previous = records[index - 1];
      const following = records.slice(index + 1, index + 5);
      const firstFollowing = following.find((candidate) => (
        candidate.grammar?.kind !== "negation"
        && !candidate.copula
      ));
      const hasFollowingPredicate = Boolean(firstFollowing && (
        firstFollowing.morphology?.kind === "finite-past"
        || firstFollowing.morphology?.kind === "finite-present"
        || firstFollowing.morphology?.kind === "progressive"
        || firstFollowing.wordnet?.partsOfSpeech?.includes("v")
        || ["can", "could", "may", "might", "shall", "should", "will", "would", "must"].includes(firstFollowing.surface)
      ));
      const hasFollowingVerbEvidence = following.some((candidate) => (
        candidate.morphology?.kind === "finite-past"
        || candidate.morphology?.kind === "finite-present"
        || candidate.morphology?.kind === "progressive"
        || candidate.wordnet?.partsOfSpeech?.includes("v")
      ));
      const hasNominalHead = previous && !previous.grammar && !previous.copula;
      if (hasNominalHead && (hasFollowingPredicate || (!firstFollowing && hasFollowingVerbEvidence))) {
        return {
          ...record,
          coverageType: "grammar",
          pyashSequence: ["la"],
          grammar: {
            kind: "dependent-clause",
            components: ["dependent_clause_"],
            position: "link"
          },
          evidence: "contextual English relative-clause marker maps to dependent_clause_ la"
        };
      }
      const next = following.find((candidate) => candidate.pyashSequence.length > 0 && !candidate.grammar);
      if (next) {
        return {
          ...record,
          coverageType: "grammar",
          pyashSequence: ["tsuh"],
          grammar: {
            kind: "pronoun",
            components: ["distal_demonstrative_"],
            position: "standalone"
          },
          evidence: "contextual English distal demonstrative maps to distal_demonstrative_ tsuh"
        };
      }
    }
    if (record.surface === "such" && records[index + 1]?.surface === "as") {
      return {
        ...record,
        construction: {
          kind: "exemplifier",
          category: "exemplification",
          evidence: "such as is a contextual exemplifier construction"
        },
        evidence: "such as is a contextual exemplifier construction"
      };
    }
    return record;
  });
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

function isPassiveAuxiliary(records, index) {
  const following = records[index + 1];
  return Boolean(following
    && following.morphology?.kind !== "progressive"
    && (following.morphology?.kind === "participle"
      || /(?:ed|en)$/u.test(following.surface)
      || following.wordnet?.partsOfSpeech?.includes("v")));
}

function nominalHeadAfter(records, startIndex) {
  for (let index = startIndex; index < records.length; index += 1) {
    const record = records[index];
    if (!record || record.copula) return null;
    if (record.grammar?.position === "prefix") continue;
    if (record.grammar?.kind === "case-marker") {
      continue;
    }
    if (record.grammar?.kind === "conjunction") return null;
    return { record, index };
  }
  return null;
}

function isStructuralCopularComplement(records, index) {
  if (index <= 0 || records[0]?.surface === "there") return false;
  const following = records[index + 1];
  if (!following || isPassiveAuxiliary(records, index)) return false;
  if (following.morphology?.kind === "progressive") return false;
  const head = nominalHeadAfter(records, index + 1);
  if (!head) return false;
  const partsOfSpeech = head.record.wordnet?.partsOfSpeech ?? [];
  const nominal = (partsOfSpeech.includes("n") && !partsOfSpeech.includes("v"))
    || partsOfSpeech.includes("a")
    || ["pronoun", "possessive-pronoun", "referential"].includes(head.record.grammar?.kind);
  const hasDeterminer = following.grammar?.position === "prefix";
  const caseLed = following.grammar?.kind === "case-marker";
  return nominal || (hasDeterminer && head.record.pyashSequence.length > 0) || caseLed;
}

function findStructuralCopulaIndex(records) {
  for (let index = 1; index < records.length; index += 1) {
    if (records[index].copula && isStructuralCopularComplement(records, index)) return index;
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

function wordNetSenseCandidates(record, resolveWord, records, index, wordnetIndex, wordnetBridges) {
  if (record?.consumedBy || record?.pyashSequence?.length || !record?.wordnet?.senses || typeof resolveWord !== "function") return [];
  const selection = selectEnglishWordNetSenses(record, records, index, wordnetIndex);
  const dynamicSenses = record.wordnet.senses.filter((sense) => (
    wordnetBridges?.has?.(wordNetSenseKey(sense))
  ));
  const senses = dynamicSenses.length > 0
    ? dynamicSenses
    : selection.senses;
  return senses.map((sense) => {
    const candidates = new Map();
    const bridge = wordnetBridges?.get?.(wordNetSenseKey(sense))
      ?? wordnetIndex?.bridgeIndex?.get(wordNetSenseKey(sense));
    if (bridge) {
      const coverage = resolveWord(bridge.target);
      if (coverage?.pyashSequence?.length && coverage.coverageType !== "dictionary-alias") {
        const candidate = makeCandidate({
          phrase: record.surface,
          lemma: bridge.target,
          lexicalSequence: coverage.pyashSequence,
          morphologySequence: [],
          markerNames: [],
          certainty: bridge.certainty,
          evidence: [
            `WordNet ${sense.pos}:${sense.synset} bridge ${bridge.target}${sense.gloss ? `; ${sense.gloss}` : ""}`,
            bridge.evidence,
            selection.evidence
          ].filter(Boolean).join("; ")
        });
        candidate.partOfSpeech = bridge.targetPartOfSpeech;
        candidates.set(candidate.id, candidate);
      }
      return [...candidates.values()];
    }
    for (const lemma of sense.lemmas ?? []) {
      if (!lemma || lemma === record.surface) continue;
      const coverage = resolveWord(lemma);
      if (!coverage?.pyashSequence?.length || coverage.coverageType === "dictionary-alias") continue;
      const candidate = makeCandidate({
        phrase: record.surface,
        lemma,
        lexicalSequence: coverage.pyashSequence,
        morphologySequence: [],
        markerNames: [],
        certainty: "contextual",
        evidence: [
          `WordNet ${sense.pos}:${sense.synset} synonym ${lemma}${sense.gloss ? `; ${sense.gloss}` : ""}`,
          selection.evidence
        ].filter(Boolean).join("; ")
      });
      candidate.partOfSpeech = sense.pos;
      candidates.set(candidate.id, candidate);
    }
    return [...candidates.values()];
  });
}

function addWordNetCandidates(records, resolveWord, wordnetIndex, wordnetBridges) {
  return records.map((record, index) => {
    const candidateSets = wordNetSenseCandidates(record, resolveWord, records, index, wordnetIndex, wordnetBridges);
    const candidates = candidateSets.flat();
    const uniqueSequences = new Map(candidates.map((candidate) => [candidate.pyashSequence.join(" "), candidate]));
    if (candidateSets.length > 0
      && candidateSets.every((set) => set.length === 1)
      && uniqueSequences.size === 1) {
      const candidate = [...uniqueSequences.values()][0];
      return {
        ...record,
        coverageType: "semantic-wordnet",
        lemma: candidate.lemma,
        wordnetPartOfSpeech: candidate.partOfSpeech,
        pyashSequence: [...candidate.lexicalSequence],
        evidence: `deterministic WordNet sense agreement; ${candidate.evidence}`,
        semanticCandidates: []
      };
    }
    return { ...record, semanticCandidates: candidates };
  });
}

function objectSequence(objectRecords) {
  const sequence = composeObjectSequence(objectRecords);
  const compositionalMarked = objectRecords.some((record) => record.compositionalCase);
  if (!compositionalMarked && sequence.at(-1) !== ACCUSATIVE_MARKER) sequence.push(ACCUSATIVE_MARKER);
  return sequence;
}

function makeSentence(subject, verbPhrase, objectRecords) {
  const sentence = {
    mood: "ya",
    su: { name: subject.pyashSequence.join(" ") }
  };
  if (verbPhrase?.pyashSequence?.length) sentence.be = verbPhrase.pyashSequence.join(" ");
  if (objectRecords.length > 0) {
    sentence.ob = { name: objectSequence(objectRecords).join(" ") };
  }
  return sentence;
}

function composeObjectSequence(records) {
  const phrase = [];
  const linkedCases = [];
  for (const record of records) {
    if (record.grammar?.kind === "case-marker" && record.grammar.position === "link") {
      linkedCases.push(...record.pyashSequence);
      continue;
    }
    phrase.push(...record.pyashSequence);
  }
  return [...phrase, ...linkedCases];
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

function addNominativeCase(subject) {
  if (!subject?.pyashSequence?.length || subject.pyashSequence.at(-1) === NOMINATIVE_MARKER) {
    return subject;
  }
  return {
    ...subject,
    pyashSequence: [...subject.pyashSequence, NOMINATIVE_MARKER]
  };
}

function hasNegation(records, verbIndex) {
  return records.some((record, index) => index > verbIndex && record.grammar?.kind === NEGATION_GRAMMAR_KIND);
}

function objectRecordsAfter(records, verbIndex) {
  return verbIndex >= 0
    ? records.slice(verbIndex + 1).filter((record) => (
      record.grammar?.kind !== NEGATION_GRAMMAR_KIND && !record.consumedBy
    ))
    : [];
}

function phraseRecord(slot, tokens, start, end, pyashSequence) {
  return {
    slot,
    start,
    end,
    surface: tokens.slice(start, end).join(" "),
    pyashSequence: [...pyashSequence]
  };
}

function buildPhraseRecords({
  tokens,
  subject,
  subjectBoundary,
  verbPhrase,
  verbStart,
  verbEnd,
  objectRecords,
  objectStart
} = {}) {
  const phrases = [];
  if (subjectBoundary > 0 && subject?.pyashSequence?.length) {
    phrases.push(phraseRecord("su", tokens, 0, subjectBoundary, subject.pyashSequence));
  }
  if (verbPhrase?.pyashSequence?.length && verbStart >= 0 && verbEnd > verbStart) {
    phrases.push(phraseRecord("be", tokens, verbStart, verbEnd, verbPhrase.pyashSequence));
  }
  if (objectRecords?.length > 0 && objectStart >= 0) {
    phrases.push(phraseRecord("ob", tokens, objectStart, tokens.length, objectSequence(objectRecords)));
  }
  return phrases;
}

export function analyzeEnglishSentence(source, {
  resolveWord,
  lemmaEntries = [],
  grammarIndex,
  wordnetIndex,
  wordnetBridges = null,
  coverageOverrides = null,
  sourceRecordId = "",
  occurrenceOverrides = null
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
  const resolveWithOverrides = (word, tokenIndex) => {
    const normalized = String(word ?? "").trim().toLowerCase();
    const occurrence = translationOccurrenceKey({ sourceRecordId, tokenIndex });
    const override = occurrenceOverrides?.get?.(occurrence)
      ?? occurrenceOverrides?.get?.(String(tokenIndex))
      ?? coverageOverrides?.get?.(normalized)
      ?? (coverageOverrides && typeof coverageOverrides === "object" ? coverageOverrides[normalized] : null);
    return override ?? resolveWord?.(word);
  };
  const records = addWordNetCandidates(applyContextualEnglishGrammar(tokens.map((token, tokenIndex) => wordRecord(token, {
    resolveWord: resolveWithOverrides,
    lemmaBySurface,
    grammarIndex,
    wordnetIndex,
    tokenIndex
  })), grammarIndex), resolveWithOverrides, wordnetIndex, wordnetBridges);
  const progressiveIndex = findProgressiveIndex(records);
  const finiteIndex = findVerbIndex(records);
  const copulaIndex = progressiveIndex < 0 && finiteIndex < 0
    ? findStructuralCopulaIndex(records)
    : -1;
  const imperativeIndex = progressiveIndex < 0 && finiteIndex < 0 && copulaIndex < 0
    ? findImperativeVerbIndex(records)
    : -1;
  const lexicalIndex = progressiveIndex < 0 && finiteIndex < 0 && copulaIndex < 0 && imperativeIndex < 0
    ? findLexicalVerbIndex(records)
    : -1;
  let verbIndex = copulaIndex >= 0
    ? -1
    : progressiveIndex >= 0
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
  if (copulaIndex >= 0) {
    for (let index = 0; index <= copulaIndex; index += 1) consumedIndexes.add(index);
  } else if (progressiveIndex >= 0) {
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
      && !record.consumedBy
      && (!consumedIndexes.has(index) || (!record.copula && !record.grammar))
      && record.grammar?.kind !== NEGATION_GRAMMAR_KIND
      && !record.copula
    ))
    .map((record) => record.surface);
  let subjectBoundary = copulaIndex >= 0 ? copulaIndex : verbIndex;
  if (progressiveIndex >= 0) {
    subjectBoundary = progressiveIndex - 1;
    while (subjectBoundary >= 0 && records[subjectBoundary]?.grammar?.kind === NEGATION_GRAMMAR_KIND) subjectBoundary -= 1;
  } else if (verbIndex >= 0) {
    const copulaIndex = records.findIndex((record, index) => index < verbIndex && record.copula);
    if (copulaIndex >= 0) subjectBoundary = copulaIndex;
  }
  const subject = addNominativeCase(makeSubjectPhrase(records, subjectBoundary));
  const subjectRecords = subjectBoundary > 0 ? records.slice(0, subjectBoundary) : [];
  const subjectRecordsReady = subjectRecords.every((record) => record.pyashSequence.length > 0);
  const subjectReady = subject.pyashSequence.length > 0
    && subjectRecordsReady
    && (verbIndex === 0 || isSubject(subject) || subject.pyashSequence.some(Boolean));
  const objectStart = copulaIndex >= 0 ? copulaIndex + 1 : verbIndex + 1;
  const objectRecords = objectRecordsAfter(records, copulaIndex >= 0 ? copulaIndex : verbIndex);
  const objectReady = objectRecords.every((record) => record.pyashSequence.length > 0);
  const deterministic = (copulaIndex >= 0 || Boolean(verbPhrase))
    && (copulaIndex >= 0 || verbPhrase.certainty === "deterministic")
    && subjectReady
    && unresolved.length === 0
    && objectReady;
  const sentence = deterministic ? makeSentence(subject, verbPhrase, objectRecords) : null;
  const verbStart = progressiveIndex >= 0
    ? Math.max(0, progressiveIndex - 1)
    : verbIndex;
  const verbEnd = progressiveIndex >= 0 ? progressiveIndex + 1 : verbIndex + 1;
  const phrases = buildPhraseRecords({
    tokens,
    subject,
    subjectBoundary,
    verbPhrase,
    verbStart,
    verbEnd,
    objectRecords,
    objectStart
  });
  return {
    format: ENGLISH_SENTENCE_FORMAT,
    sourceText: source,
    status: deterministic ? "resolved" : "review",
    tokens: records,
    subject,
    verbPhrase,
    verbIndex,
    ...(copulaIndex >= 0 ? { copulaIndex, construction: "zero-copula" } : {}),
    phrases,
    candidates: verbPhrase ? [verbPhrase] : [],
    unresolved,
    sentence,
    pyash: sentence ? sentenceToPyash(sentence) : verbPhrase?.pyashSequence?.join(" ") ?? ""
  };
}

export async function loadDefaultEnglishSentenceResources() {
  if (!defaultResourcesPromise) defaultResourcesPromise = loadEnglishSentenceResources();
  return defaultResourcesPromise;
}

export async function loadEnglishSentenceResources() {
  if (!sentenceResourcesPromise) {
    sentenceResourcesPromise = Promise.all([
      loadEnglish30k(),
      loadEnglishLemmaCatalog(),
      loadEnglishGrammarCatalog(),
      loadEnglishDictionaryBlacklist(),
      loadAnchorWordForms(),
      loadEnglishWordNet(),
      loadEnglishWordNetBridges(),
      loadCuratedCompoundDecompositions()
    ]).then(([source, lemmaCatalog, grammarCatalog, dictionary, anchors, wordnet, bridgeCatalog, compoundRecords]) => {
      const grammarIndex = buildEnglishGrammarIndex({ catalogEntries: grammarCatalog.entries });
      const aliases = anchors.formsToAnchor;
      const dictionaryAliases = buildEnglishDictionaryAliases({
        dictionary,
        atomicEntries: pyashWords
      }).aliases;
      const lemmaIndex = buildEnglishLemmaIndex({
        atomicEntries: pyashWords,
        aliases,
        catalogEntries: lemmaCatalog.entries
      });
      const sourceByVariant = new Map();
      for (const row of source.rows) {
        for (const variant of english30kLookupVariants(row.word)) {
          if (!sourceByVariant.has(variant)) sourceByVariant.set(variant, row);
        }
      }
      const atomicByVariant = new Map();
      for (const entry of pyashWords) {
        if (typeof entry?.en !== "string" || typeof entry?.pya !== "string") continue;
        const english = entry.en.trim();
        const pya = entry.pya.trim();
        if (!english || !pya || english.startsWith("_") || english.endsWith("_")) continue;
        for (const variant of english30kLookupVariants(english)) {
          if (!atomicByVariant.has(variant)) atomicByVariant.set(variant, {
            en: english,
            pya,
            hnuc: entry.hnuc
          });
        }
      }
      const grammarMappings = new Map(DEFAULT_GRAMMAR_MAPPINGS);
      for (const [surface, mapping] of grammarIndex.mappings) grammarMappings.set(surface, mapping);
      const wordnetIndex = buildEnglishWordNetIndex({
        rows: wordnet.rows,
        relations: wordnet.relations,
        bridges: bridgeCatalog.entries
      });
      const curatedCompoundRecords = compoundRecords.map((entry) => ({
        ...entry,
        status: "accepted-curated"
      }));
      const resources = {
        source,
        lemmaCatalog,
        dictionary,
        grammarCatalog,
        grammarIndex,
        grammarMappings,
        grammarOverrides: grammarIndex.mappings,
        dictionaryAliases,
        aliases,
        compoundRecords: curatedCompoundRecords,
        lemmaIndex,
        sourceByVariant,
        atomicByVariant,
        wordnet: {
          ...wordnet,
          bridges: bridgeCatalog,
          index: wordnetIndex
        }
      };
      resources.coverage = buildEnglish30kCoverage({
        source,
        atomicEntries: pyashWords,
        aliases,
        dictionaryAliases,
        grammarMappings,
        grammarOverrides: grammarIndex.mappings,
        compoundRecords: curatedCompoundRecords,
        lemmaEntries: lemmaCatalog.entries,
        lemmaIndex
      });
      resources.resourceHashes = Object.freeze({
        english30k: source.sourceHash,
        englishLemmas: lemmaCatalog.sourceHash,
        englishGrammar: grammarCatalog.sourceHash,
        englishDictionary: dictionary.sourceHash,
        englishAnchors: resourceHash([...aliases.entries()].sort(([left], [right]) => left.localeCompare(right))),
        englishCompounds: resourceHash(curatedCompoundRecords),
        englishWordNet: wordnet.sourceHash,
        englishWordNetBridges: resourceHash(bridgeCatalog.entries)
      });
      return resources;
    });
  }
  return sentenceResourcesPromise;
}

function stagedEnglishCoverage(resources, word) {
  const variants = english30kLookupVariants(word);
  const row = variants.map((variant) => resources.sourceByVariant.get(variant)).find(Boolean);
  const sourceRow = row ?? {
    word,
    normalizedWord: word.toLowerCase(),
    rank: null,
    score: null
  };
  const grammarOverride = variants.map((variant) => resources.grammarOverrides.get(variant)).find(Boolean);
  if (grammarOverride) {
    return {
      ...sourceRow,
      coverageType: "grammar",
      status: "covered-grammar",
      pyashSequence: [...grammarOverride]
    };
  }
  const exact = variants.map((variant) => resources.atomicByVariant.get(variant)).find(Boolean);
  if (exact) {
    return {
      ...sourceRow,
      coverageType: "atomic",
      status: "covered-atomic",
      canonicalEnglish: exact.en,
      pyashSequence: [exact.pya],
      hnuc: exact.hnuc
    };
  }
  const resolved = resources.lemmaIndex.resolve(word);
  if (resolved && resolved.status !== "accepted-deterministic") {
    return {
      ...sourceRow,
      coverageType: "lemma",
      status: "covered-lemma",
      canonicalEnglish: resolved.canonicalEnglish,
      pyashSequence: [...resolved.pyashSequence],
      hnuc: resolved.hnuc,
      lemma: resolved.lemma,
      lemmaKind: resolved.kind,
      lemmaStatus: resolved.status,
      lemmaRule: resolved.rule,
      lemmaEvidence: resolved.evidence,
      lemmaPyashSequence: [...resolved.pyashSequence],
      ...(resolved.morphology ? {
        morphology: {
          ...resolved.morphology,
          markerNames: [...resolved.morphology.markerNames],
          markerSequence: [...resolved.morphology.markerSequence]
        }
      } : {}),
      ...(resolved.grammaticalNumber ? { grammaticalNumber: resolved.grammaticalNumber } : {})
    };
  }
  if (!row) return null;
  const alias = variants.map((variant) => resources.aliases.get(variant)).find(Boolean);
  if (alias) {
    const anchor = english30kLookupVariants(alias)
      .map((variant) => resources.atomicByVariant.get(variant))
      .find(Boolean);
    if (anchor) {
      return {
        ...row,
        coverageType: "alias",
        status: "covered-alias",
        canonicalEnglish: anchor.en,
        aliasOf: alias,
        pyashSequence: [anchor.pya],
        hnuc: anchor.hnuc
      };
    }
  }
  const grammar = variants.map((variant) => resources.grammarMappings.get(variant)).find(Boolean);
  if (grammar) {
    return {
      ...row,
      coverageType: "grammar",
      status: "covered-grammar",
      pyashSequence: [...grammar]
    };
  }
  const dictionaryAlias = variants.map((variant) => resources.dictionaryAliases.get(variant)).find(Boolean);
  if (dictionaryAlias) {
    const anchor = english30kLookupVariants(dictionaryAlias)
      .map((variant) => resources.atomicByVariant.get(variant))
      .find(Boolean);
    if (anchor) {
      return {
        ...row,
        coverageType: "dictionary-alias",
        status: "covered-dictionary-alias",
        canonicalEnglish: anchor.en,
        aliasOf: dictionaryAlias,
        pyashSequence: [anchor.pya],
        hnuc: anchor.hnuc
      };
    }
  }
  return {
    ...row,
    coverageType: "unresolved",
    status: "unresolved"
  };
}

function needsFullCoverage(analysis) {
  return analysis.unresolved?.length > 0;
}

export async function analyzeDefaultEnglishSentence(source, options = {}) {
  const resources = await loadEnglishSentenceResources();
  const analysis = analyzeEnglishSentence(source, {
    resolveWord: (word) => stagedEnglishCoverage(resources, word),
    lemmaEntries: resources.lemmaCatalog.entries,
    grammarIndex: resources.grammarIndex,
    wordnetIndex: resources.wordnet?.index,
    ...options
  });
  if (!needsFullCoverage(analysis)) return analysis;

  const fullResources = await loadDefaultEnglishSentenceResources();
  return analyzeEnglishSentence(source, {
    resolveWord: (word) => lookupEnglish30kCoverage(fullResources.coverage, word)
      ?? stagedEnglishCoverage(resources, word),
    lemmaEntries: fullResources.lemmaCatalog.entries,
    grammarIndex: fullResources.grammarIndex,
    wordnetIndex: fullResources.wordnet?.index,
    ...options
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
