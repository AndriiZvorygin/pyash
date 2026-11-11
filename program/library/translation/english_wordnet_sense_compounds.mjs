import { createHash } from "node:crypto";

import { buildProgram } from "../../program.mjs";
import { recordExchangeJsonArtifact } from "../../bridge/exchange.mjs";
import { extractBoundedJsonObject } from "./english_verification.mjs";
import { hasWordNetHeadSenseRelation, buildWordNetHeadRelationIndex } from "./english_wordnet.mjs";
import { englishWordNetTargetId } from "./english_wordnet_bridges.mjs";

export const ENGLISH_WORDNET_SENSE_COMPOUNDS_NAME = "translation_wordnet_sense_compounds";
export const ENGLISH_WORDNET_SENSE_COMPOUNDS_FORMAT = "english-wordnet-sense-compounds-v1";
export const ENGLISH_WORDNET_SENSE_COMPOUNDS_CONFIG_URL = new URL("./wordnet_sense_compound_refinery.pya", import.meta.url);
export const ENGLISH_WORDNET_SENSE_TRANSLATION_CACHE_NAME = "translation_wordnet_sense_translation_cache";
export const ENGLISH_WORDNET_SENSE_COMPOUNDS_LANGUAGES = Object.freeze([
  "chinese", "hindi", "russian", "german", "japanese", "korean", "finnish"
]);
export const ENGLISH_WORDNET_SENSE_COMPOUNDS_MODEL = "qwen3.5:9b";
export const ENGLISH_WORDNET_SENSE_COMPOUNDS_PROMPT_REVISION = "sense-translation-gloss-alternatives-v11";
export const ENGLISH_WORDNET_SENSE_COMPOUND_CHOICE_PROMPT_REVISION = "sense-component-choice-v14";
export const ENGLISH_WORDNET_SENSE_COMPOUND_CANDIDATE_REVISION = "sense-component-choice-v11";
export const ENGLISH_WORDNET_SENSE_COMPOUNDS_MAX_OUTPUT_TOKENS = 2048;
export const ENGLISH_WORDNET_SENSE_COMPOUND_CHOICE_MAX_OUTPUT_TOKENS = 256;
export const ENGLISH_WORDNET_SENSE_COMPOUNDS_PARALLELISM = 8;
export const ENGLISH_WORDNET_SENSE_COMPOUND_MAX_ATOMS = 2;

const COMPOSITION_KINDS = new Set(["compound", "simple", "uncertain"]);
const MAX_RESPONSE_CHARS = 48000;
const MAX_FAILURE_RESPONSE_CHARS = 2000;
const MAX_SURFACE_CHARS = 300;
const MAX_COMPONENT_CHARS = 180;
const MAX_TRANSLATION_COMPONENTS = 3;
const MAX_COMPOUND_ATOMS = ENGLISH_WORDNET_SENSE_COMPOUND_MAX_ATOMS;
const MAX_COMPONENT_CHOICES = 4;
const MAX_SENSE_COMPOSITION_PROMPT_CHARS = 8000;
const MAX_WORDNET_FALLBACK_SENSES = 4;
const DIRECT_COMPONENT_MAPPING_KINDS = new Set(["root", "lemma", "dictionary-alias", "gloss", "wordnet-synset", "vocab-suggest-sense"]);
const DIRECT_COMPONENT_COVERAGE_TYPES = new Set(["atomic", "root", "lemma", "alias", "dictionary-alias"]);
const serializedInterpreterQueues = new WeakMap();

function serializedInterpreter(interpret) {
  let queue = serializedInterpreterQueues.get(interpret);
  if (!queue) {
    queue = { tail: Promise.resolve() };
    serializedInterpreterQueues.set(interpret, queue);
  }
  return (sentence) => {
    const result = queue.tail.then(() => interpret(sentence), () => interpret(sentence));
    queue.tail = result.then(() => undefined, () => undefined);
    return result;
  };
}

function invalid(message, details = {}) {
  const error = new Error(message);
  error.code = "invalid-wordnet-sense-compound";
  error.details = details;
  return error;
}

function text(value) {
  return typeof value === "string" ? value.normalize("NFC").trim() : "";
}

function normalizeTranslationSurface(value, language) {
  const surface = text(value);
  return language === "chinese"
    ? surface.replace(/\s+/gu, "")
    : surface.replace(/\s+/gu, " ");
}

function normalized(value) {
  return text(value).toLowerCase().replace(/[_-]+/gu, " ").replace(/\s+/gu, " ").trim();
}

function hanCharacters(value) {
  return [...text(value).matchAll(/\p{Script=Han}/gu)].map(([character]) => character);
}

export function componentGlossAlternatives(value) {
  return [...new Set(text(value).split(/\s*(?:\/|\|)\s*/u).map(normalized).filter(Boolean))];
}

export function componentGlossLookupAlternatives(value) {
  return [...new Set(componentGlossAlternatives(value).flatMap((alternative) => {
    const infinitive = /^to\s+([\p{L}]+(?:['’-][\p{L}]+)*)$/u.exec(alternative);
    if (infinitive) return [infinitive[1]];
    const phrase = alternative.replace(/^to\s+/u, "");
    return [alternative, ...phrase.split(/\s+/u).filter(Boolean)];
  }))];
}

export function wordNetLemmaComponentTranslations(sense) {
  const lemmas = [...new Set([
    ...(Array.isArray(sense?.lemmas) ? sense.lemmas : []),
    text(sense?.lemma)
  ].map((lemma) => text(lemma).replace(/_/gu, " ").toLowerCase()).filter(Boolean))];
  return lemmas.flatMap((lemma) => {
    const parts = lemma.split(/\s+/u).filter(Boolean);
    if (parts.length < 2 || parts.length > MAX_TRANSLATION_COMPONENTS) return [];
    return [{
      language: "english",
      surface: lemma,
      composition: "compound",
      compositionEvidence: "WordNet lists this multiword lemma for the exact target sense; its lexical words are exposed as English component candidates.",
      components: parts.map((part) => ({ surface: part, gloss: part, role: "lexical" }))
    }];
  });
}

export function hasCompositionSourceTranslations(sense, translationRecord) {
  if (translationRecord?.status === "complete") return true;
  const usableRows = (translationRecord?.translations ?? []).some((translation) => (
    ["compound", "uncertain"].includes(normalized(translation?.composition))
    && Array.isArray(translation?.components)
    && translation.components.length >= 2
  ));
  return usableRows || wordNetLemmaComponentTranslations(sense).length > 0;
}

export function mergeWordNetSenseTranslationFailures(existingRows = [], newRows = [], {
  resolvedTranslations = []
} = {}) {
  const byId = new Map();
  for (const row of existingRows) {
    const id = text(row?.id ?? row?.senseId);
    if (id) byId.set(id, { ...row, id });
  }
  for (const row of newRows) {
    const senseId = text(row?.senseId);
    const language = normalized(row?.language);
    if (!senseId || !language) continue;
    const id = text(row?.id) || `translation-failure-${hash([
      senseId,
      language,
      text(row?.promptRevision),
      text(row?.handleId),
      String(row?.attempt ?? "")
    ].join("\u0000")).slice(0, 24)}`;
    const previous = byId.get(id);
    const attempts = new Map();
    for (const event of [...(previous?.attemptErrors ?? []), ...(row.attemptErrors ?? [])]) {
      const eventId = text(event?.id) || hash(stableJson(event));
      attempts.set(eventId, { ...event, id: eventId });
    }
    byId.set(id, {
      ...previous,
      ...row,
      id,
      attemptErrors: [...attempts.values()].sort((left, right) => (
        Number(left.attempt ?? 0) - Number(right.attempt ?? 0) || text(left.id).localeCompare(text(right.id))
      ))
    });
  }
  const resolved = new Map();
  for (const record of resolvedTranslations) {
    for (const translation of record?.translations ?? []) {
      const key = `${text(record.senseId)}\u0000${normalized(translation?.language)}`;
      if (key !== "\u0000") resolved.set(key, text(record.id));
    }
  }
  for (const [id, row] of byId) {
    const resolutionKey = `${text(row.senseId)}\u0000${normalized(row.language)}`;
    const resolutionId = resolved.get(resolutionKey);
    if (resolved.has(resolutionKey)) byId.set(id, {
      ...row,
      status: "recovered",
      ...(resolutionId ? { recoveredByTranslationId: resolutionId } : {})
    });
  }
  return [...byId.values()].sort((left, right) => (
    text(left.senseId).localeCompare(text(right.senseId))
    || normalized(left.language).localeCompare(normalized(right.language))
    || Number(left.attempt ?? 0) - Number(right.attempt ?? 0)
    || text(left.id).localeCompare(text(right.id))
  ));
}

export function mapComponentGlossChoices(componentGlosses, choicesByLookupGloss) {
  const byGloss = new Map(choicesByLookupGloss instanceof Map ? choicesByLookupGloss : []);
  for (const gloss of componentGlosses ?? []) {
    const alternatives = componentGlossAlternatives(gloss);
    const allChoices = [];
    for (const alternative of alternatives) {
      const choices = componentGlossLookupAlternatives(alternative)
        .flatMap((lookup) => byGloss.get(normalized(lookup)) ?? []);
      const unique = new Map(choices.map((choice) => [
        `${text(choice?.linkedSense?.source)}\u0000${(choice?.pyashSequence ?? []).join("+")}`,
        choice
      ]));
      const rows = [...unique.values()];
      byGloss.set(normalized(alternative), rows);
      allChoices.push(...rows);
    }
    const unique = new Map(allChoices.map((choice) => [
      `${text(choice?.linkedSense?.source)}\u0000${(choice?.pyashSequence ?? []).join("+")}`,
      choice
    ]));
    byGloss.set(normalized(gloss), [...unique.values()]);
  }
  return byGloss;
}

function definitionOnly(value, maximum = 320) {
  return text(value).split(";")[0].slice(0, maximum);
}

function lookupGlossSenseEvidence(wordnetIndex, gloss, maximum = 4, prioritizedSenseIds = []) {
  if (!wordnetIndex || typeof wordnetIndex.lookup !== "function") return [];
  const unique = new Map();
  const prioritized = new Set(prioritizedSenseIds.map(text).filter(Boolean));
  const rows = [...wordnetIndex.lookup(gloss)];
  rows.sort((left, right) => {
    const leftId = `${text(left?.pos)}:${text(left?.synset)}`;
    const rightId = `${text(right?.pos)}:${text(right?.synset)}`;
    return Number(prioritized.has(rightId)) - Number(prioritized.has(leftId));
  });
  for (const row of rows) {
    const source = `${text(row?.pos)}:${text(row?.synset)}`;
    if (!source || source === ":" || unique.has(source)) continue;
    const lemmas = wordnetIndex.bySynset instanceof Map
      ? (wordnetIndex.bySynset.get(source) ?? []).map((entry) => text(entry.lemma)).filter(Boolean)
      : [text(row?.lemma)].filter(Boolean);
    unique.set(source, {
      source,
      pos: text(row?.pos),
      lemmas: [...new Set(lemmas)],
      definition: definitionOnly(row?.gloss)
    });
    if (unique.size >= maximum) break;
  }
  return [...unique.values()];
}

function isVocabularyTermMapping(mapping) {
  const mappingKind = text(mapping?.kind);
  return DIRECT_COMPONENT_MAPPING_KINDS.has(mappingKind)
    && DIRECT_COMPONENT_COVERAGE_TYPES.has(text(mapping?.coverageType))
    && !/duplicate|deprecated|grammar/iu.test(text(mapping?.status))
    && Boolean(text(mapping?.word));
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function hash(value) {
  return createHash("sha256").update(String(value ?? "")).digest("hex");
}

function senseIdOf(sense) {
  return text(sense?.senseId ?? sense?.source ?? `${text(sense?.pos)}:${text(sense?.synset)}`);
}

function senseLemma(sense) {
  return normalized(sense?.lemma) || normalized(sense?.lemmas?.[0]);
}

export function senseTranslationKey({
  senseId,
  wordNetHash,
  promptRevision = ENGLISH_WORDNET_SENSE_COMPOUNDS_PROMPT_REVISION,
  languages = ENGLISH_WORDNET_SENSE_COMPOUNDS_LANGUAGES
} = {}) {
  const id = text(senseId);
  const sourceHash = text(wordNetHash);
  const revision = text(promptRevision);
  if (!id || !sourceHash || !revision || !Array.isArray(languages) || languages.length === 0) {
    throw invalid("sense translation identity requires a sense, WordNet hash, revision, and languages");
  }
  return `sense-translation-${hash(stableJson({
    senseId: id,
    wordNetHash: sourceHash,
    promptRevision: revision,
    languages: languages.map((language) => normalized(language)).sort()
  })).slice(0, 24)}`;
}

export function buildWordNetSenseTranslationPrompt({
  sense,
  languages = ENGLISH_WORDNET_SENSE_COMPOUNDS_LANGUAGES,
  missingLanguages = languages,
  repairReason = ""
} = {}) {
  const id = senseIdOf(sense);
  const lemma = senseLemma(sense);
  const lemmas = [...new Set([lemma, ...(sense?.lemmas ?? []).map(normalized)].filter(Boolean))];
  const gloss = definitionOnly(sense?.definition ?? sense?.gloss);
  const requested = [...new Set((missingLanguages ?? []).map(normalized).filter(Boolean))];
  if (!id || !lemma || !gloss || !requested.length) {
    throw invalid("sense translation prompt requires one identified sense, definition, and language set");
  }
  return [
    "Translate this one WordNet sense into the requested comparison languages.",
    "Use its definition to preserve this sense; translate the ordinary lexical meaning, not an explanatory sentence.",
    "When English is requested, use the listed sense lemmas to select the clearest expression for this sense. If the fitting lemma is a transparent compound, list its lexical parts even if other languages express the sense differently.",
    "For Chinese, decompose every translation containing two or more Han characters into contiguous morpheme spans in written order. Their component surfaces must cover every character of the translation surface exactly once, with no omissions, repetitions, or reordering.",
    "Use the smallest meaningful lexical morphemes. If multiple Han characters in a lexical span each contribute meaning to this sense, list those contributions as separate lexical components. Keep multiple characters in one component only when they form a lexicalized morpheme whose characters do not independently contribute to this sense.",
    "Do not insert spaces inside the Chinese translation or component surfaces.",
    "List known grammatical or derivational material as its own component. It can occur alongside a transparent Chinese compound and does not by itself make the decomposition uncertain or count as a lexical component.",
    "Mark a Chinese translation compound only when at least two lexical components jointly express this sense. Do not call one lexical component plus grammatical material a compound.",
    "For other languages, mark compound when the current ordinary word meaning is transparently composed from its listed parts.",
    "For each part, label role lexical, grammatical, bound, or uncertain. A classifier, article, particle, inflection, derivational ending, or other grammatical material is not a lexical compound part.",
    "Do not split prefixes, suffixes, inflectional endings, or grammatical material in other languages. For Chinese, explain each character's current contribution in this word; historical meaning alone is not sufficient.",
    "When compound, list two or three source-language parts in natural written order. For each part, provide up to three distinct concise English lexical glosses that fit this exact sense, separated by / when needed. Include multiple glosses when they express distinct context-compatible contributions; do not add loose synonyms. Explain in compositionEvidence how their current meanings jointly express the sense.",
    "Return exactly one translation row and one best translation surface for each requested language; do not combine alternatives with commas or slashes. The components array can contain at most three entries. A compound requires at least two lexical components; known grammatical or bound components do not count toward that minimum. Simple requires an empty components array. Uncertain may use an empty array or a best segmentation of two or three spans; never return exactly one component.",
    "Chinese multi-character translations cannot be simple or have empty components. If a character's contribution is unclear, use uncertain and still provide a best segmentation covering the entire surface. Do not use uncertain only because a known grammatical or derivational component is present. For other languages, do not mark a mere phrase, classifier construction, idiom, or opaque lexicalized form as compound; use simple with empty components, or uncertain when unsure.",
    "Do not invent Pyash words or choose Pyash atoms. No Pyash atom inventory is provided.",
    "Return one JSON object only, with this shape:",
    '{"senseId":"...","translations":[{"language":"...","surface":"...","composition":"compound|simple|uncertain","compositionEvidence":"...","components":[{"surface":"...","gloss":"...","role":"lexical|grammatical|bound|uncertain"}]}]}',
    `SENSE ID: ${id}`,
    `PART OF SPEECH: ${text(sense?.pos)}`,
    `SENSE WORD: ${lemma}`,
    `SENSE LEMMAS: ${JSON.stringify(lemmas)}`,
    `DEFINITION: ${gloss}`,
    `LANGUAGES: ${JSON.stringify(requested)}`,
    repairReason ? `REPAIR REQUIREMENT: ${text(repairReason).slice(0, 300)}` : ""
  ].filter(Boolean).join("\n");
}

export function buildSenseCompoundWorklist({
  residualSenses = [],
  linkedSenseIds = [],
  resolveTargetCoverage = null,
  maximum = Number.POSITIVE_INFINITY,
  minimumTagCount = 0,
  order = "english30k-rank",
  rankForEnglish = () => Number.POSITIVE_INFINITY,
  requirePrincetonIntersection = false
} = {}) {
  if (!Array.isArray(residualSenses)) {
    throw invalid("sense compound worklist requires residual senses");
  }
  if (!["english30k-rank", "tag-count-descending"].includes(order)) {
    throw invalid("sense compound worklist order is unsupported", { order });
  }
  if (!Number.isSafeInteger(minimumTagCount) || minimumTagCount < 0) {
    throw invalid("sense compound worklist minimum tag count must be a nonnegative integer", { minimumTagCount });
  }
  const alreadyLinked = new Set(linkedSenseIds.map(text).filter(Boolean));
  return residualSenses.map((sense) => {
    const source = senseIdOf(sense);
    const pos = text(sense?.pos || source.split(":")[0]);
    const lemmas = [...new Set((sense?.lemmas ?? []).map(normalized).filter(Boolean))];
    const definition = definitionOnly(sense?.gloss ?? sense?.definition);
    if (!source || !pos || lemmas.length === 0 || !definition || alreadyLinked.has(source)) return null;
    const tagCounts = [
      ...(sense?.candidates ?? []).map((candidate) => candidate.tagCount),
      sense?.tagCount
    ].filter(Number.isSafeInteger);
    const tagCount = tagCounts.length ? Math.max(...tagCounts) : -1;
    if (requirePrincetonIntersection && sense?.princetonMatched !== true) return null;
    if (minimumTagCount > 0 && tagCount < minimumTagCount) return null;
    const candidateRanks = (sense?.candidates ?? []).map((candidate) => Number(candidate.rank ?? candidate.english30kRank))
      .filter((rank) => Number.isFinite(rank) && rank > 0);
    const lemmaRanks = typeof rankForEnglish === "function"
      ? lemmas.map((lemma) => Number(rankForEnglish(lemma))).filter((rank) => Number.isFinite(rank) && rank > 0)
      : [];
    const suppliedRank = Number(sense.frequencyRank);
    const frequencyRanks = [
      ...(Number.isFinite(suppliedRank) && suppliedRank > 0 ? [suppliedRank] : []),
      ...candidateRanks,
      ...lemmaRanks
    ];
    const frequencyRank = frequencyRanks.length ? Math.min(...frequencyRanks) : Number.MAX_SAFE_INTEGER;
    const targetCoverage = typeof resolveTargetCoverage === "function"
      ? resolveTargetCoverage({
        senseId: source,
        pos,
        lemmas,
        definition
      })
      : null;
    const coverageType = text(targetCoverage?.coverageType).toLowerCase();
    const canonicalCoverageType = text(targetCoverage?.canonicalCoverageType).toLowerCase();
    const resolvedCoverageType = ["alias", "dictionary-alias"].includes(coverageType)
      ? canonicalCoverageType
      : coverageType;
    if (resolvedCoverageType === "grammar" || resolvedCoverageType === "compound") return null;
    let targetHead;
    if (resolvedCoverageType === "atomic") {
      const word = normalized(targetCoverage?.canonicalEnglish ?? targetCoverage?.word ?? lemmas[0]);
      const pyashSequence = Array.isArray(targetCoverage?.pyashSequence)
        ? targetCoverage.pyashSequence.map(text).filter(Boolean)
        : [];
      const componentLayer = Number(targetCoverage?.componentLayer);
      if (!word || pyashSequence.length !== 1 || !Number.isInteger(componentLayer)) return null;
      targetHead = { coverageType: "atomic", word, pyashSequence, componentLayer };
    }
    return {
      senseId: source,
      pos,
      synset: text(sense?.synset || source.slice(source.indexOf(":") + 1)),
      lemma: lemmas[0],
      lemmas,
      gloss: definition,
      frequencyRank,
      tagCount,
      ...(typeof sense?.princetonMatched === "boolean" ? { princetonMatched: sense.princetonMatched } : {}),
      ...(targetHead ? { targetHead } : {})
    };
  }).filter(Boolean)
    .sort(order === "tag-count-descending"
      ? (left, right) => right.tagCount - left.tagCount
        || left.frequencyRank - right.frequencyRank
        || left.senseId.localeCompare(right.senseId)
      : (left, right) => left.frequencyRank - right.frequencyRank
        || right.tagCount - left.tagCount
        || left.senseId.localeCompare(right.senseId))
    .slice(0, Math.max(0, Number.isFinite(Number(maximum)) ? Math.trunc(Number(maximum)) : Infinity));
}

export function buildKwonLinkedAtomicChoices({
  suggestions = [],
  linkedWordNetSenses = [],
  componentGlosses = [],
  activeAtomEntries = [],
  layerByWord = new Map(),
  deprecatedSurfaces = [],
  wordnetIndex = null
} = {}) {
  if (!Array.isArray(suggestions) || !Array.isArray(linkedWordNetSenses) || !Array.isArray(activeAtomEntries)) {
    throw invalid("Kwon atom mapping requires suggestion and active atom arrays");
  }
  const deprecated = new Set(deprecatedSurfaces.map(normalized).filter(Boolean));
  const activeByWord = new Map();
  const activeRows = [];
  for (const entry of activeAtomEntries) {
    const sequence = Array.isArray(entry?.pyashSequence) ? entry.pyashSequence.map(text).filter(Boolean) : [];
    const source = text(entry?.source);
    const layer = layerByWord instanceof Map ? layerByWord.get(sequence[0]) : layerByWord?.[sequence[0]];
    if (!source || deprecated.has(normalized(entry.target)) || /duplicate|deprecated|grammar/iu.test(text(entry.status))
      || text(entry?.targetKind) !== "atom" || sequence.length !== 1 || !Number.isInteger(layer)) continue;
    const row = {
      word: text(entry.target),
      coverageType: "atomic",
      status: "active-linked-atom",
      pyashSequence: sequence,
      componentLayers: [layer],
      linkedSense: {
        source,
        pos: text(entry.targetPartOfSpeech),
        lemmas: Array.isArray(entry.lemmas) ? entry.lemmas.map(text).filter(Boolean) : [],
        definition: definitionOnly(entry.definition ?? entry.gloss)
      }
    };
    activeRows.push(row);
    for (const label of [entry.target, ...(entry.lemmas ?? [])]) {
      const key = normalized(label);
      if (!key || deprecated.has(key)) continue;
      activeByWord.set(key, [...(activeByWord.get(key) ?? []), row]);
    }
  }
  const suggestionsByInput = new Map();
  for (const suggestion of suggestions) {
    const input = normalized(suggestion?.input);
    if (!input) continue;
    suggestionsByInput.set(input, [...(suggestionsByInput.get(input) ?? []), suggestion]);
  }
  const linkedSensesByInput = new Map();
  for (const sense of linkedWordNetSenses) {
    const input = normalized(sense?.input);
    const source = text(sense?.source);
    if (!input || !source || sense?.active === false) continue;
    linkedSensesByInput.set(input, [...(linkedSensesByInput.get(input) ?? []), sense]);
  }
  const inputGlosses = [...new Set([
    ...suggestionsByInput.keys(),
    ...linkedSensesByInput.keys(),
    ...componentGlosses.map(normalized).filter(Boolean)
  ])];
  const result = new Map();
  for (const input of inputGlosses) {
    const inputSuggestions = suggestionsByInput.get(input) ?? [];
    const inputLinkedSenses = linkedSensesByInput.get(input) ?? [];
    if (!input) continue;
    const hasVocabularySuggestionTerm = inputSuggestions.some((suggestion) => (
      text(suggestion?.status) !== "unresolved"
      && ((Array.isArray(suggestion?.wordSuggestions) && suggestion.wordSuggestions.some((word) => Boolean(normalized(word))))
        || (Array.isArray(suggestion?.mappings) && suggestion.mappings.some(isVocabularyTermMapping)))
    ));
    const choices = [];

    if (!hasVocabularySuggestionTerm && inputLinkedSenses.length > 0) {
      for (const linkedSense of inputLinkedSenses.slice(0, MAX_WORDNET_FALLBACK_SENSES)) {
        const linkedId = text(linkedSense.source);
        const sequence = Array.isArray(linkedSense.pyashSequence) ? linkedSense.pyashSequence.map(text).filter(Boolean) : [];
        const active = activeRows.find((row) => row.linkedSense.source === linkedId
          && (!sequence.length || row.pyashSequence.join(" ") === sequence.join(" "))
          && (!text(linkedSense.target) || normalized(row.word) === normalized(linkedSense.target)));
        if (!active) continue;
        choices.push({
          ...active,
          mappingKind: "vocab-suggest-sense",
          mappingCoverageType: "atomic",
          mappingLookupGloss: input,
          mappingLookupSenseEvidence: [{
            source: linkedId,
            pos: text(linkedSense.targetPartOfSpeech ?? linkedSense.pos),
            lemmas: Array.isArray(linkedSense.lemmas) ? linkedSense.lemmas.map(text).filter(Boolean) : [],
            definition: definitionOnly(linkedSense.gloss ?? linkedSense.definition)
          }]
        });
      }
    }

    for (const suggestion of inputSuggestions) for (const mapping of suggestion?.mappings ?? []) {
      const mappingKind = text(mapping?.kind);
      const isDiscoverySuggestion = mappingKind === "word-suggestion";
      if (!isVocabularyTermMapping(mapping) && !isDiscoverySuggestion) continue;
      if (isDiscoverySuggestion && text(suggestion?.status) === "unresolved") continue;
      const sequence = mapping.pyacSequence ?? mapping.pyashSequence;
      if (!Array.isArray(sequence) || sequence.length !== 1) continue;
      for (const active of activeByWord.get(normalized(mapping.word)) ?? []) {
        if (active.pyashSequence[0] !== sequence[0]) continue;
        // Direct mappings must match the component gloss's WordNet evidence already.
        // Word suggestions remain candidates for the composition decision.
        if (!isDiscoverySuggestion && wordnetIndex && typeof wordnetIndex.lookup === "function") {
          const expectedSenseIds = new Set(wordnetIndex.lookup(input)
            .map((sense) => `${text(sense?.pos)}:${text(sense?.synset)}`)
            .filter((senseId) => senseId !== ":"));
          const linkedSense = candidateSense(active);
          const glossIsLinkedLemma = linkedSense?.lemmas.some((lemma) => normalized(lemma) === input);
          if (!expectedSenseIds.has(linkedSense?.source) && !glossIsLinkedLemma) continue;
        }
        choices.push({
          ...active,
          mappingKind,
          mappingCoverageType: text(mapping.coverageType),
          mappingLookupGloss: input,
          mappingLookupSenseEvidence: lookupGlossSenseEvidence(wordnetIndex, input, 4, [active.linkedSense.source]),
          ...(isDiscoverySuggestion ? { mappingSuggestedWord: normalized(mapping.word) } : {})
        });
      }
    }
    // Treat WordNet as a narrow discovery fallback; ambiguous glosses such as "set" otherwise flood candidates.
    if (!hasVocabularySuggestionTerm && inputLinkedSenses.length === 0
      && wordnetIndex && typeof wordnetIndex.lookup === "function") {
      const fallbackSenseIds = [];
      const seenFallbackSenseIds = new Set();
      for (const sense of wordnetIndex.lookup(input)) {
        const senseId = `${text(sense?.pos)}:${text(sense?.synset)}`;
        if (!senseId || senseId === ":" || seenFallbackSenseIds.has(senseId)) continue;
        seenFallbackSenseIds.add(senseId);
        fallbackSenseIds.push(senseId);
        if (fallbackSenseIds.length >= MAX_WORDNET_FALLBACK_SENSES) break;
      }
      for (const senseId of fallbackSenseIds) {
        for (const active of activeRows) {
          if (active.linkedSense.source !== senseId) continue;
          choices.push({
            ...active,
            mappingKind: "wordnet-synset",
            mappingCoverageType: "atomic",
            mappingLookupGloss: input,
            mappingLookupSenseEvidence: lookupGlossSenseEvidence(
              wordnetIndex,
              input,
              MAX_WORDNET_FALLBACK_SENSES,
              [active.linkedSense.source]
            )
          });
        }
      }
    }
    const rankedChoices = choices
      .map((choice, index) => ({ choice, index, score: componentMappingScore(choice) }))
      .sort((left, right) => right.score - left.score || left.index - right.index);
    const unique = new Map();
    for (const { choice } of rankedChoices) {
      // A prompt shows one linked meaning per available atom; duplicate senses
      // for the same word otherwise crowd other Kwon alternatives out.
      const key = `${normalized(choice.word)}\u0000${choice.pyashSequence.join("+")}`;
      if (unique.has(key)) continue;
      unique.set(key, choice);
      if (unique.size >= MAX_WORDNET_FALLBACK_SENSES) break;
    }
    result.set(input, [...unique.values()]);
  }
  return result;
}

function parseWordNetSenseTranslationPayload(value, { senseId, maxResponseChars = MAX_RESPONSE_CHARS } = {}) {
  const raw = String(value ?? "");
  if (raw.length > maxResponseChars) throw invalid("sense translation response exceeds its character limit");
  const payload = extractBoundedJsonObject(raw, { maxResponseChars });
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw invalid("sense translation response has no bounded JSON object");
  }
  let translationPayload = payload;
  const wrappedResponse = typeof payload.response === "string"
    ? payload.response
    : typeof payload.message?.content === "string" ? payload.message.content : "";
  if (wrappedResponse) {
    if (wrappedResponse.length > maxResponseChars) throw invalid("wrapped sense translation response exceeds its character limit");
    translationPayload = extractBoundedJsonObject(wrappedResponse, { maxResponseChars });
  }
  if (!translationPayload || typeof translationPayload !== "object" || Array.isArray(translationPayload)) {
    throw invalid("wrapped sense translation response has no bounded JSON object");
  }
  const expectedSenseId = text(senseId);
  if (!expectedSenseId || text(translationPayload.senseId) !== expectedSenseId) {
    throw invalid("sense translation response names a different sense", {
      expected: expectedSenseId,
      actual: text(translationPayload.senseId)
    });
  }
  if (!Array.isArray(translationPayload.translations) || translationPayload.translations.length === 0) {
    throw invalid("sense translation response has no translations");
  }
  return { raw, wrappedResponse, translationPayload, expectedSenseId };
}

export function parseWordNetSenseTranslationResponse(value, {
  senseId,
  languages = ENGLISH_WORDNET_SENSE_COMPOUNDS_LANGUAGES,
  maxResponseChars = MAX_RESPONSE_CHARS
} = {}) {
  const { raw, wrappedResponse, translationPayload, expectedSenseId } = parseWordNetSenseTranslationPayload(value, {
    senseId,
    maxResponseChars
  });
  const allowed = new Set(languages.map(normalized));
  const seen = new Set();
  const translations = [];
  for (const [index, row] of translationPayload.translations.entries()) {
    const language = normalized(row?.language);
    const surface = normalizeTranslationSurface(row?.surface, language);
    const composition = normalized(row?.composition);
    if (!allowed.has(language)) throw invalid("sense translation response contains an unrequested language", { index, language });
    if (seen.has(language)) throw invalid("sense translation response contains a duplicate language", { index, language });
    if (!surface || surface.length > MAX_SURFACE_CHARS) throw invalid("sense translation surface is empty or too long", { index, language });
    if (!COMPOSITION_KINDS.has(composition)) throw invalid("sense translation composition kind is invalid", { index, language, composition });
    if (!Array.isArray(row?.components)) throw invalid("sense translation components must be an array", { index, language });
    const components = row.components.map((component, componentIndex) => {
      const partSurface = normalizeTranslationSurface(component?.surface, language);
      const gloss = text(component?.gloss);
      const role = normalized(component?.role);
      if (!partSurface || partSurface.length > MAX_COMPONENT_CHARS || !gloss || gloss.length > MAX_COMPONENT_CHARS) {
        throw invalid("sense translation component is empty or too long", { index, language, componentIndex });
      }
      if (!["lexical", "grammatical", "bound", "uncertain"].includes(role)) {
        throw invalid("sense translation component role is invalid", { index, language, componentIndex, role });
      }
      return { surface: partSurface, gloss, role };
    });
    const compositionEvidence = text(row?.compositionEvidence).slice(0, 500);
    const han = language === "chinese" ? hanCharacters(surface) : [];
    if (han.length >= 2) {
      if (composition === "simple") {
        throw invalid("multi-character Chinese translation must be decomposed", { index, language, surface, hanCharacterCount: han.length });
      }
      if (components.length < 2 || components.length > MAX_TRANSLATION_COMPONENTS) {
        throw invalid("multi-character Chinese translation requires two or three decomposed parts", { index, language, surface, componentCount: components.length });
      }
      const joinedParts = components.map((component) => component.surface).join("").normalize("NFC");
      if (joinedParts !== surface.normalize("NFC")) {
        throw invalid("Chinese decomposition parts must cover every character of the surface in written order", { index, language, surface, joinedParts });
      }
    }
    if (components.length > MAX_TRANSLATION_COMPONENTS) {
      throw invalid("sense translation decomposition exceeds three components", { index, language, componentCount: components.length });
    }
    if (composition === "compound" && (components.length < 2 || components.length > MAX_TRANSLATION_COMPONENTS)) {
      throw invalid("compound translations require two or three components", { index, language, componentCount: components.length });
    }
    if (composition === "uncertain" && components.length !== 0 && (components.length < 2 || components.length > MAX_TRANSLATION_COMPONENTS)) {
      throw invalid("uncertain translation decomposition must be empty or contain two or three parts", { index, language });
    }
    seen.add(language);
    const nonLexicalParts = components.some((component) => component.role !== "lexical");
    const lexicalComponentCount = components.filter((component) => component.role === "lexical").length;
    const hasUncertainPart = components.some((component) => component.role === "uncertain");
    const hasBoundMorphemeMarkers = composition === "compound"
      && components.some((component) => /^[\p{Pd}]|[\p{Pd}]$/u.test(component.surface));
    const evidenceMissing = composition === "compound" && compositionEvidence.length === 0;
    const invalidCompoundParts = language === "chinese"
      ? lexicalComponentCount < 2 || hasUncertainPart || hasBoundMorphemeMarkers
      : nonLexicalParts || hasBoundMorphemeMarkers;
    const rejectComposition = composition === "compound" && (invalidCompoundParts || evidenceMissing);
    translations.push({
      language,
      surface,
      composition: rejectComposition ? "uncertain" : composition,
      components: composition === "simple" ? [] : components,
      compositionEvidence: rejectComposition
        ? language === "chinese" && lexicalComponentCount < 2
          ? "Chinese compound needs at least two lexical components"
          : hasUncertainPart
            ? "decomposition contains an uncertain component"
            : hasBoundMorphemeMarkers
          ? "decomposition contains a bound-morpheme marker"
          : nonLexicalParts
            ? "decomposition includes a grammatical, bound, or unverified component"
            : "compound decomposition has no compositional evidence"
        : compositionEvidence
    });
  }
  const requested = [...new Set(languages.map(normalized))];
  return {
    valid: true,
    senseId: expectedSenseId,
    translations: translations.sort((left, right) => requested.indexOf(left.language) - requested.indexOf(right.language)),
    missingLanguages: requested.filter((language) => !seen.has(language)),
    raw: wrappedResponse || raw
  };
}

export function parseWordNetSenseTranslationResponsePartial(value, {
  senseId,
  languages = ENGLISH_WORDNET_SENSE_COMPOUNDS_LANGUAGES,
  maxResponseChars = MAX_RESPONSE_CHARS
} = {}) {
  const { raw, wrappedResponse, translationPayload, expectedSenseId } = parseWordNetSenseTranslationPayload(value, {
    senseId,
    maxResponseChars
  });
  const requested = [...new Set(languages.map(normalized))];
  const allowed = new Set(requested);
  const seen = new Set();
  const translationsByLanguage = new Map();
  const failuresByLanguage = new Map();
  for (const [index, row] of translationPayload.translations.entries()) {
    const language = normalized(row?.language);
    if (!allowed.has(language)) continue;
    if (seen.has(language)) {
      translationsByLanguage.delete(language);
      failuresByLanguage.set(language, {
        language,
        error: "sense translation response contains a duplicate language",
        details: { index, language }
      });
      continue;
    }
    seen.add(language);
    try {
      const parsed = parseWordNetSenseTranslationResponse(JSON.stringify({
        senseId: expectedSenseId,
        translations: [row]
      }), { senseId: expectedSenseId, languages: [language], maxResponseChars });
      translationsByLanguage.set(language, parsed.translations[0]);
    } catch (error) {
      failuresByLanguage.set(language, {
        language,
        error: text(error?.message ?? error) || "sense translation row failed validation",
        ...(error?.details && typeof error.details === "object" ? { details: error.details } : {})
      });
    }
  }
  for (const language of requested) {
    if (!translationsByLanguage.has(language) && !failuresByLanguage.has(language)) {
      failuresByLanguage.set(language, { language, error: "sense translation response omitted the requested language" });
    }
  }
  return {
    valid: true,
    senseId: expectedSenseId,
    translations: requested.map((language) => translationsByLanguage.get(language)).filter(Boolean),
    failures: requested.map((language) => failuresByLanguage.get(language)).filter(Boolean),
    missingLanguages: requested.filter((language) => !translationsByLanguage.has(language)),
    raw: wrappedResponse || raw
  };
}

export function parseWordNetSenseTranslationCache(source) {
  if (typeof source !== "string") throw invalid("sense translation cache must be Pyash text");
  const sentences = buildProgram(source).sentences;
  const header = sentences.find((sentence) => sentence?.mood === "def"
    && sentence?.be === "map"
    && sentence?.su?.name === ENGLISH_WORDNET_SENSE_TRANSLATION_CACHE_NAME);
  if (!header) throw invalid("sense translation cache has no canonical map header");
  const metadata = {};
  const recordsById = new Map();
  for (const [index, sentence] of sentences.entries()) {
    if (sentence?.mood !== "ya" || typeof sentence.su?.text !== "string") continue;
    if (sentence.su.text === "format") continue;
    if (sentence.su.text.startsWith("meta:")) {
      metadata[sentence.su.text.slice("meta:".length)] = sentence.ob?.text ?? "";
      continue;
    }
    if (typeof sentence.ob?.text !== "string") throw invalid("sense translation cache row requires JSON text", { index });
    let record;
    try {
      record = JSON.parse(sentence.ob.text);
    } catch (error) {
      throw invalid("sense translation cache row contains malformed JSON", { index, cause: error.message });
    }
    if (record?.id !== sentence.su.text
      || record.id !== senseTranslationKey(record)
      || !text(record.senseId)
      || !Array.isArray(record.translations)) {
      throw invalid("sense translation cache row has an invalid identity", { index, id: sentence.su.text });
    }
    // The cache is an append-only Pyash map: a later row with the same stable
    // sense key records an updated partial/complete translation.
    recordsById.set(record.id, record);
  }
  const records = [...recordsById.values()];
  records.sort((left, right) => left.senseId.localeCompare(right.senseId));
  return {
    format: ENGLISH_WORDNET_SENSE_COMPOUNDS_FORMAT,
    metadata,
    records,
    bySense: new Map(records.map((record) => [record.senseId, record]))
  };
}

export function renderWordNetSenseTranslationCacheEntry(record) {
  const id = text(record?.id);
  if (!id || id !== senseTranslationKey(record) || !text(record?.senseId)
    || !Array.isArray(record?.translations)) {
    throw invalid("sense translation cache entry has an invalid identity", { id });
  }
  return `su text ${JSON.stringify(id)} ob text ${JSON.stringify(JSON.stringify(record))} ya\n`;
}

export function renderWordNetSenseTranslationCache(records = [], metadata = {}) {
  if (!Array.isArray(records)) throw invalid("sense translation cache renderer requires records");
  const lines = [`su name ${ENGLISH_WORDNET_SENSE_TRANSLATION_CACHE_NAME} be map def`];
  for (const [key, value] of Object.entries({ format: ENGLISH_WORDNET_SENSE_COMPOUNDS_FORMAT, ...metadata }).sort(([left], [right]) => left.localeCompare(right))) {
    lines.push(`su text ${JSON.stringify(`meta:${key}`)} ob text ${JSON.stringify(String(value))} ya`);
  }
  const seen = new Set();
  for (const record of [...records].sort((left, right) => left.senseId.localeCompare(right.senseId))) {
    const id = text(record?.id);
    if (!id || id !== senseTranslationKey(record) || seen.has(id)) {
      throw invalid("sense translation cache renderer received an invalid or duplicate identity", { id });
    }
    seen.add(id);
    lines.push(renderWordNetSenseTranslationCacheEntry(record).trimEnd());
  }
  lines.push("prah", "");
  return lines.join("\n");
}

function candidateSense(candidate) {
  const sense = candidate?.linkedSense;
  const source = text(sense?.source ?? sense?.senseId ?? `${text(sense?.pos)}:${text(sense?.synset)}`);
  if (!source || !text(sense?.pos)) return null;
  return {
    source,
    pos: text(sense.pos),
    lemmas: Array.isArray(sense.lemmas) ? sense.lemmas.map(text).filter(Boolean) : [],
    definition: definitionOnly(sense.definition ?? sense.gloss)
  };
}

const COMPONENT_STOP_WORDS = new Set([
  "a", "an", "and", "as", "at", "be", "by", "for", "from", "have", "in", "into",
  "is", "it", "of", "on", "or", "the", "to", "with"
]);

function meaningTokens(values = []) {
  return [...new Set(values.flatMap((value) => normalized(value)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length > 2 && !COMPONENT_STOP_WORDS.has(token))))];
}

function componentMappingScore(choice) {
  const linked = candidateSense(choice);
  if (!linked) return Number.NEGATIVE_INFINITY;
  const linkedLemmas = new Set(linked.lemmas.map(normalized));
  const linkedTokens = new Set(meaningTokens([...linked.lemmas, linked.definition]));
  const glossEvidence = Array.isArray(choice.mappingLookupSenseEvidence)
    ? choice.mappingLookupSenseEvidence
    : [];
  let score = DIRECT_COMPONENT_MAPPING_KINDS.has(text(choice.mappingKind)) ? 1000 : 0;
  for (const glossSense of glossEvidence) {
    if (text(glossSense.source) === linked.source) score += 200;
    const glossLemmas = (Array.isArray(glossSense.lemmas) ? glossSense.lemmas : []).map(normalized);
    score += glossLemmas.filter((lemma) => linkedLemmas.has(lemma)).length * 80;
    const glossTokens = new Set(meaningTokens([...glossLemmas, glossSense.definition]));
    score += Math.min(40, [...glossTokens].filter((token) => linkedTokens.has(token)).length * 8);
    if (glossSense.pos && text(glossSense.pos) === linked.pos) score += 4;
  }
  return score;
}

function linkedAtomicChoices(choices, maximum = 4) {
  return (Array.isArray(choices) ? choices : [])
    .filter((choice) => choice?.coverageType === "atomic"
      && !/duplicate|deprecated|grammar/iu.test(text(choice.status))
      && Array.isArray(choice.pyashSequence)
      && choice.pyashSequence.length === 1
      && text(choice.pyashSequence[0])
      && Number.isInteger(choice.componentLayers?.[0])
      && candidateSense(choice))
    .slice(0, Math.max(1, maximum));
}

function optionList(index, gloss) {
  if (index instanceof Map) return index.get(normalized(gloss)) ?? [];
  return index?.[normalized(gloss)] ?? [];
}

function choiceMeaning(choice) {
  return definitionOnly(choice?.linkedSense?.definition ?? choice?.linkedSense?.gloss, 180);
}

function sourceDecompositionChoices(
  translations,
  kwonCandidatesByGloss,
  maximumChoices = MAX_COMPONENT_CHOICES,
  minimumAvailableParts = 1
) {
  if (!Array.isArray(translations)) return [];
  const decompositions = [];
  for (const translation of translations) {
    if (normalized(translation?.composition) !== "compound"
      || !text(translation?.language)
      || !text(translation?.surface)
      || !Array.isArray(translation?.components)
      || translation.components.length < 2
      || translation.components.length > MAX_TRANSLATION_COMPONENTS) continue;
    const parts = translation.components.map((component, sourceIndex) => {
      const surface = text(component?.surface);
      const glossOptions = componentGlossAlternatives(component?.gloss).map((gloss) => {
        const choices = linkedAtomicChoices(optionList(kwonCandidatesByGloss, gloss), maximumChoices)
          .filter((choice) => choiceMeaning(choice))
          .map((choice) => ({ gloss, choice }));
        return { gloss, choices };
      });
      return {
        sourceIndex,
        surface,
        role: normalized(component?.role),
        glosses: glossOptions.map((row) => row.gloss),
        glossOptions
      };
    });
    const availableParts = parts.filter((part) => part.surface
      && part.role === "lexical"
      && part.glossOptions.some((option) => option.choices.length > 0));
    if (availableParts.length < minimumAvailableParts) continue;
    decompositions.push({
      language: normalized(translation.language),
      surface: text(translation.surface),
      compositionEvidence: text(translation.compositionEvidence),
      translation,
      parts: availableParts
    });
  }
  return decompositions;
}

function availableChoiceValues(decompositions) {
  const rows = [];
  for (const decomposition of decompositions) for (const part of decomposition.parts) {
    for (const glossOption of part.glossOptions) for (const { choice } of glossOption.choices) {
      rows.push({
        language: decomposition.language,
        translationSurface: decomposition.surface,
        sourcePart: part.surface,
        sourceIndex: part.sourceIndex,
        sourceGloss: glossOption.gloss,
        word: text(choice.word),
        pyashSequence: choice.pyashSequence.map(text),
        componentLayer: choice.componentLayers[0],
        meaning: choiceMeaning(choice),
        choice
      });
    }
  }
  const unique = new Map();
  for (const row of rows) {
    const key = [row.language, row.sourceIndex, row.sourceGloss, row.word, row.pyashSequence.join("+"), row.meaning].join("\u0000");
    if (!unique.has(key)) unique.set(key, row);
  }
  return [...unique.values()];
}

export function buildSenseCompoundChoiceResponseFormat(input) {
  const options = Array.isArray(input?.sourceOptions) ? input.sourceOptions : [];
  const atoms = [...new Set(options.map((row) => text(row.word)).filter(Boolean))];
  const hasFixedHead = Boolean(input?.targetHead);
  return {
    type: "object",
    oneOf: [
      {
        type: "object",
        required: ["verdict", "atoms"],
        additionalProperties: false,
        properties: {
          verdict: { type: "string", enum: ["compound"] },
          atoms: {
            type: "array",
            minItems: hasFixedHead ? 1 : 2,
            maxItems: hasFixedHead ? MAX_COMPOUND_ATOMS - 1 : MAX_COMPOUND_ATOMS,
            uniqueItems: true,
            items: { type: "string", enum: atoms }
          }
        }
      },
      {
        type: "object",
        required: ["verdict", "atoms"],
        additionalProperties: false,
        properties: {
          verdict: { type: "string", enum: ["uncertain"] },
          atoms: { type: "array", maxItems: 0 }
        }
      }
    ]
  };
}

export function buildSenseCompoundChoiceInput({
  sense,
  translations = [],
  kwonCandidatesByGloss = new Map(),
  reservedTargetIds = [],
  maximumChoices = MAX_COMPONENT_CHOICES
} = {}) {
  if (!normalizedSense(sense)) throw invalid("component-choice prompt requires one target sense");
  const targetHead = normalizeTargetHead(sense?.targetHead);
  const targetPos = text(sense?.pos);
  const reservedTargets = new Set((reservedTargetIds instanceof Set
    ? [...reservedTargetIds]
    : Array.isArray(reservedTargetIds) ? reservedTargetIds : [])
    .map(text)
    .filter(Boolean));
  const decompositions = sourceDecompositionChoices(
    translations,
    kwonCandidatesByGloss,
    maximumChoices,
    1
  );
  if (decompositions.length === 0) return null;
  const sourceOptions = availableChoiceValues(decompositions).filter((option) => (
    !targetHead
    || (option.pyashSequence.join("+") !== targetHead.pyashSequence[0]
      && !reservedTargets.has(englishWordNetTargetId(
        "compound",
        [...option.pyashSequence, ...targetHead.pyashSequence],
        targetPos
      )))
  ));
  const distinctAvailableAtoms = new Set(sourceOptions.map((option) => option.pyashSequence.join("+")));
  if (distinctAvailableAtoms.size < (targetHead ? 1 : 2)) return null;
  const optionsByGloss = new Map();
  for (const option of sourceOptions) {
    const gloss = option.sourceGloss;
    const glossGroup = optionsByGloss.get(gloss) ?? {
      gloss,
      atoms: [],
      atomMeanings: {}
    };
    if (!glossGroup.atoms.includes(option.word)) glossGroup.atoms.push(option.word);
    if (!glossGroup.atomMeanings[option.word] && option.meaning) glossGroup.atomMeanings[option.word] = option.meaning;
    optionsByGloss.set(gloss, glossGroup);
  }
  const atomOptions = [...optionsByGloss.values()];
  const componentCountRule = targetHead
    ? "The final compound has exactly two atoms total, including the existing target head. Choose one distinct modifier atom. The pipeline appends the target head."
    : "Choose exactly two distinct atoms in Pyash head-final order. A single atom is not a compound.";
  const minimumAtoms = targetHead ? 1 : 2;
  const renderPrompt = (groups, truncated) => [
    "Form one Pyash compound for the target meaning.",
    "Pyash has a limited inventory of existing atoms. Use only the listed atom words; do not invent or alter words.",
    "Each gloss lists available atoms and their linked meanings. Choose any listed atoms whose meanings jointly express the target. Atoms may be combined across gloss groups.",
    componentCountRule,
    targetHead
      ? `This target already has an existing lexical head ${targetHead.word} (${targetHead.pyashSequence[0]}). Keep that exact word as the final atom; place modifiers before it.`
      : "Pyash compounds are head-final: the final atom is the semantic head; earlier atoms modify it.",
    ...(targetHead ? ["Modifiers whose modifier + head sequence is already assigned for this part of speech have been removed from the available options."] : []),
    "Ordering example (illustrative only, not candidate atoms): bird snake means a type of snake, so the Pyash order is [bird, snake]. Snake bird means a type of bird, so the Pyash order is [snake, bird].",
    targetHead
      ? "If no available modifier improves the target's meaning, return uncertain with an empty atoms array."
      : "If fewer than two available atoms fit, return uncertain with an empty atoms array.",
    ...(targetHead ? [`EXISTING TARGET HEAD: ${JSON.stringify({ word: targetHead.word, pyac: targetHead.pyashSequence[0] })}`] : []),
    `TARGET: ${senseLemma(sense)} — ${definitionOnly(sense?.definition ?? sense?.gloss)}`,
    "Select atoms by their linked meanings and the target sense.",
    "AVAILABLE ATOM OPTIONS:",
    JSON.stringify(groups, null, 2),
    ...(truncated ? ["Lower-priority atom options were omitted to stay within the safe prompt size."] : []),
    targetHead
      ? "Return only modifier atoms selected from AVAILABLE ATOM OPTIONS; the pipeline appends the existing head."
      : 'Example: part one offers atom1 and part two offers atom2; return {"verdict":"compound","atoms":["atom1","atom2"]}',
    targetHead
      ? 'If no useful modifier fits: {"verdict":"uncertain","atoms":[]}'
      : 'If fewer than two different atoms fit: {"verdict":"uncertain","atoms":[]}',
    "Return one compound, not a list of alternatives.",
    "Return only this JSON shape:",
    targetHead
      ? '{"verdict":"compound|uncertain","atoms":["modifier atom word"]}'
      : '{"verdict":"compound|uncertain","atoms":["atom word"]}'
  ].join("\n");
  const retainedGroups = atomOptions.map((group) => ({
    ...group,
    atoms: [...group.atoms],
    atomMeanings: { ...group.atomMeanings }
  }));
  const distinctWords = (groups) => new Set(groups.flatMap((group) => group.atoms));
  let prompt = renderPrompt(retainedGroups, false);
  while (prompt.length > MAX_SENSE_COMPOSITION_PROMPT_CHARS) {
    const removableGroup = [...retainedGroups].reverse().find((group) => group.atoms.length > 1);
    if (removableGroup) {
      const removedWord = removableGroup.atoms.pop();
      delete removableGroup.atomMeanings[removedWord];
    } else if (retainedGroups.length > 1) {
      const lastGroup = retainedGroups.at(-1);
      const remainingWords = new Set(retainedGroups.slice(0, -1).flatMap((group) => group.atoms));
      if (remainingWords.size < minimumAtoms) return null;
      retainedGroups.pop();
      lastGroup.atoms = [];
    } else {
      return null;
    }
    if (distinctWords(retainedGroups).size < minimumAtoms) return null;
    prompt = renderPrompt(retainedGroups, true);
  }
  const retainedGlossWords = new Set(retainedGroups.flatMap((group) => group.atoms.map((word) => `${group.gloss}\u0000${word}`)));
  const retainedSourceOptions = sourceOptions.filter((option) => retainedGlossWords.has(`${option.sourceGloss}\u0000${option.word}`));
  const input = {
    prompt,
    sourceOptions: retainedSourceOptions,
    targetPos,
    promptTruncated: retainedSourceOptions.length < sourceOptions.length,
    omittedOptionCount: Math.max(0, sourceOptions.length - retainedSourceOptions.length),
    ...(targetHead ? { targetHead } : {})
  };
  input.responseFormat = buildSenseCompoundChoiceResponseFormat(input);
  return input;
}

export function parseSenseCompoundChoiceResponse(value, { input } = {}) {
  if (!input || typeof input !== "object" || !Array.isArray(input.sourceOptions)) {
    throw invalid("component-choice response requires the supplied atom options");
  }
  const raw = String(value ?? "");
  if (raw.length > MAX_RESPONSE_CHARS) throw invalid("component-choice response exceeds its character limit");
  let payload = extractBoundedJsonObject(raw);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw invalid("component-choice response has no bounded JSON object");
  }
  const wrappedResponse = payload.verdict === undefined
    ? typeof payload.response === "string"
      ? payload.response
      : typeof payload.message?.content === "string" ? payload.message.content : ""
    : "";
  if (wrappedResponse) {
    if (wrappedResponse.length > MAX_RESPONSE_CHARS) {
      throw invalid("wrapped component-choice response exceeds its character limit");
    }
    payload = extractBoundedJsonObject(wrappedResponse);
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw invalid("wrapped component-choice response has no bounded JSON object");
    }
  }
  const unexpectedFields = Object.keys(payload).filter((key) => !["verdict", "atoms"].includes(key));
  if (unexpectedFields.length || !Array.isArray(payload.atoms)) {
    throw invalid("component-choice response must contain only verdict and an atoms array", { unexpectedFields });
  }
  const verdict = normalized(payload.verdict);
  const atoms = payload.atoms.map(text);
  if (verdict === "uncertain") {
    if (atoms.length) {
      throw invalid("uncertain component-choice response must not select atom words");
    }
    return { verdict, selectedComponents: [], rationale: input.targetHead
      ? "Available mapped atoms do not provide a useful modifier for the existing lexical head."
      : "Available mapped atoms do not provide two distinct components." };
  }
  if (verdict !== "compound") throw invalid("component-choice response verdict is unsupported", { verdict });
  const minimumAtoms = input.targetHead ? 1 : 2;
  const maximumAtoms = input.targetHead ? MAX_COMPOUND_ATOMS - 1 : MAX_COMPOUND_ATOMS;
  if (atoms.length < minimumAtoms || atoms.length > maximumAtoms) {
    throw invalid(input.targetHead
      ? "component-choice response must select exactly one modifier atom word"
      : "component-choice response must select exactly two atom words");
  }
  if (new Set(atoms.map(normalized)).size !== atoms.length) {
    throw invalid("component-choice response repeats an atom word");
  }
  const compareOptions = (left, right) => (
    Number(normalized(right.choice?.linkedSense?.pos) === normalized(input.targetPos))
    - Number(normalized(left.choice?.linkedSense?.pos) === normalized(input.targetPos))
    || componentMappingScore(right.choice) - componentMappingScore(left.choice)
    || left.sourceGloss.localeCompare(right.sourceGloss)
    || left.language.localeCompare(right.language)
    || left.translationSurface.localeCompare(right.translationSurface)
    || left.sourceIndex - right.sourceIndex
  );
  const optionsByWord = atoms.map((word) => input.sourceOptions
    .filter((option) => normalized(option.word) === normalized(word))
    .sort(compareOptions));
  if (optionsByWord.some((options) => options.length === 0)) {
    const unavailable = atoms.filter((word, index) => optionsByWord[index].length === 0);
    throw invalid("component-choice response selected an atom that is not an available atom", { unavailable });
  }
  const choose = (index, current, usedSequences) => {
    if (index === optionsByWord.length) return current;
    for (const option of optionsByWord[index]) {
      const sequence = option.pyashSequence.join("+");
      if (usedSequences.has(sequence)) continue;
      const selected = choose(index + 1, [...current, option], new Set([...usedSequences, sequence]));
      if (selected) return selected;
    }
    return null;
  };
  let selectedComponents = choose(0, [], new Set());
  if (!selectedComponents) {
    throw invalid("component-choice response selected words that resolve to the same Pyac atom");
  }
  selectedComponents = selectedComponents.map((option) => ({
    ...option,
    sourceGloss: normalized(option.sourceGloss),
    componentMeaning: option.meaning
  }));
  const rationale = `Selected existing atoms: ${selectedComponents.map((component) => component.word).join(" + ")}`.slice(0, 180);
  return { verdict, selectedComponents, rationale };
}

function normalizeTargetHead(value) {
  if (value === undefined || value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw invalid("existing target head must be an atomic coverage record");
  }
  const word = normalized(value.word ?? value.canonicalEnglish);
  const pyashSequence = Array.isArray(value.pyashSequence) ? value.pyashSequence.map(text).filter(Boolean) : [];
  const componentLayer = Number(value.componentLayer);
  if (text(value.coverageType).toLowerCase() !== "atomic"
    || !word
    || pyashSequence.length !== 1
    || !Number.isInteger(componentLayer)) {
    throw invalid("existing target head requires one covered atom and its complexity layer", {
      word,
      coverageType: text(value.coverageType),
      pyashSequence,
      componentLayer: value.componentLayer
    });
  }
  return { coverageType: "atomic", word, pyashSequence, componentLayer };
}

function normalizedSense(sense) {
  const source = senseIdOf(sense);
  const pos = text(sense?.pos || source.split(":")[0]);
  const lemmas = Array.isArray(sense?.lemmas) ? sense.lemmas.map(normalized).filter(Boolean) : [];
  const lemma = senseLemma(sense) || lemmas[0] || "";
  if (!source || !pos || !lemma) return null;
  return {
    source,
    pos,
    lemmas: [...new Set([lemma, ...lemmas])],
    definition: definitionOnly(sense?.definition ?? sense?.gloss),
    frequencyRank: Number.isFinite(Number(sense?.frequencyRank)) && Number(sense.frequencyRank) > 0
      ? Number(sense.frequencyRank)
      : Number.MAX_SAFE_INTEGER,
    frequencyTagCount: Number.isSafeInteger(sense?.tagCount) ? sense.tagCount : -1
  };
}

function senseRecordForTarget(targetSense) {
  return {
    source: targetSense.source,
    pos: targetSense.pos,
    lemmas: targetSense.lemmas,
    definition: targetSense.definition
  };
}

function combinations(optionsByPart, visit, index = 0, current = []) {
  if (index >= optionsByPart.length) {
    visit(current);
    return;
  }
  for (const option of optionsByPart[index]) {
    combinations(optionsByPart, visit, index + 1, [...current, option]);
  }
}

export function buildSenseDerivedCompoundCandidates({
  sense,
  translations = [],
  kwonCandidatesByGloss = new Map(),
  relations = [],
  maxKwonCandidates = 4,
  maxCandidates = 8,
  candidateRevision = ENGLISH_WORDNET_SENSE_COMPOUND_CANDIDATE_REVISION,
  headRelationPolicy = "advisory"
} = {}) {
  const targetSense = normalizedSense(sense);
  if (!targetSense || !Array.isArray(translations)) throw invalid("sense compound generation requires a target sense and translations");
  if (!text(candidateRevision) || headRelationPolicy !== "advisory") {
    throw invalid("sense compound generation requires a versioned advisory head-relation policy");
  }
  const relationIndex = buildWordNetHeadRelationIndex(relations);
  const grouped = new Map();
  const mappingScoreBySequence = new Map();
  const canonicalTarget = targetSense.lemmas[0];
  const aliases = targetSense.lemmas.slice(1);
  for (const translation of translations) {
    if (normalized(translation?.composition) !== "compound"
      || !text(translation?.language)
      || !text(translation?.compositionEvidence)
      || !Array.isArray(translation?.components)
      || translation.components.length < 2
      || translation.components.length > MAX_TRANSLATION_COMPONENTS) continue;
    const sourceComponents = translation.components.map((component) => ({
      surface: text(component?.surface),
      gloss: text(component?.gloss),
      role: normalized(component?.role)
    }));
    if (sourceComponents.some((component) => !component.surface || !component.gloss || component.role !== "lexical")) continue;
    const choices = sourceComponents.map((component) => linkedAtomicChoices(
      optionList(kwonCandidatesByGloss, component.gloss),
      maxKwonCandidates
    ));
    if (choices.some((rows) => rows.length === 0)) continue;
    combinations(choices, (selection) => {
      const pyash = selection.map((candidate) => text(candidate.pyashSequence[0]));
      if (pyash.some((word) => !word) || new Set(pyash).size !== pyash.length) return;
      for (let headIndex = 0; headIndex < selection.length; headIndex += 1) {
        const headSense = candidateSense(selection[headIndex]);
        const order = [...selection.keys()].filter((index) => index !== headIndex).concat(headIndex);
        const ordered = order.map((index) => selection[index]);
        if (ordered.length > MAX_COMPOUND_ATOMS) continue;
        const orderedSourceComponents = order.map((index) => sourceComponents[index]);
        const orderedPyash = ordered.map((candidate) => text(candidate.pyashSequence[0]));
        if (new Set(orderedPyash).size !== orderedPyash.length) continue;
        const sequenceKey = orderedPyash.join("+");
        const mappingScore = selection.reduce((score, option) => score + componentMappingScore(option), 0);
        mappingScoreBySequence.set(sequenceKey, Math.max(
          mappingScoreBySequence.get(sequenceKey) ?? Number.NEGATIVE_INFINITY,
          mappingScore
        ));
        const components = ordered.map((candidate) => normalized(candidate.word));
        if (components.some((component) => !component)) continue;
        const candidateId = `sense-compound-${hash(`${candidateRevision}\u0000${targetSense.source}\u0000${sequenceKey}`).slice(0, 24)}`;
        const candidate = grouped.get(sequenceKey) ?? {
          id: candidateId,
          candidateId,
          target: canonicalTarget,
          aliases,
          candidateRevision,
          headRelationPolicy,
          senseId: targetSense.source,
          targetPartOfSpeech: targetSense.pos,
          sourceMorphemes: components,
          componentGlosses: components,
          componentRoles: components.map(() => "lexeme"),
          pyashSequence: orderedPyash,
          componentLayers: ordered.map((option) => option.componentLayers[0]),
          maxLayer: Math.max(...ordered.map((option) => option.componentLayers[0])),
          head: components.at(-1),
          modifiers: components.slice(0, -1),
          sourceSurfaces: {},
          sourceMorphemesByLanguage: {},
          sourceComponentGlossesByLanguage: {},
        sourceComponentRolesByLanguage: {},
        sourceCompositionEvidenceByLanguage: {},
          sourceTranslationMorphemesByLanguage: {},
          sourceTranslationGlossesByLanguage: {},
          sourceComponentIndexesByLanguage: {},
          sourceLanguages: [],
          status: "candidate-closed",
          confidence: "sense-derived-comparison-compound",
          provenance: "WordNet sense translation and linked atom composition",
          frequencyRank: targetSense.frequencyRank,
          frequencyTagCount: targetSense.frequencyTagCount,
          targetSenseEvidence: [{
            ...senseRecordForTarget(targetSense),
            compatibleHeadSenseIds: hasWordNetHeadSenseRelation(targetSense.source, headSense.source, relationIndex)
              ? [headSense.source]
              : [],
            headRelationPolicy
          }],
          headRelationPolicy,
          componentSenseEvidence: ordered.map((option, index) => ({
            component: components[index],
            ...candidateSense(option),
            ...(option.mappingKind ? { mappingKind: option.mappingKind } : {}),
            ...(option.mappingCoverageType ? { mappingCoverageType: option.mappingCoverageType } : {}),
            ...(option.mappingLookupGloss ? { mappingLookupGloss: option.mappingLookupGloss } : {}),
            ...(option.mappingLookupSenseEvidence?.length ? { mappingLookupSenseEvidence: option.mappingLookupSenseEvidence } : {}),
            ...(option.mappingSuggestedWord ? { mappingSuggestedWord: option.mappingSuggestedWord } : {})
          })),
          evidence: `target ${targetSense.source}; comparison-language decomposition; linked atoms ${components.join(" + ")}`
        };
        const targetEvidence = candidate.targetSenseEvidence[0];
        const headRelationSupported = hasWordNetHeadSenseRelation(targetSense.source, headSense.source, relationIndex);
        if (headRelationSupported && !targetEvidence.compatibleHeadSenseIds.includes(headSense.source)) {
          targetEvidence.compatibleHeadSenseIds.push(headSense.source);
        }
        const evidenceByKey = new Set(candidate.componentSenseEvidence.map((evidence) => `${evidence.component}\u0000${evidence.source}`));
        for (const [index, option] of ordered.entries()) {
          const evidence = {
            component: components[index],
            ...candidateSense(option),
            ...(option.mappingKind ? { mappingKind: option.mappingKind } : {}),
            ...(option.mappingCoverageType ? { mappingCoverageType: option.mappingCoverageType } : {}),
            ...(option.mappingLookupGloss ? { mappingLookupGloss: option.mappingLookupGloss } : {}),
            ...(option.mappingLookupSenseEvidence?.length ? { mappingLookupSenseEvidence: option.mappingLookupSenseEvidence } : {}),
            ...(option.mappingSuggestedWord ? { mappingSuggestedWord: option.mappingSuggestedWord } : {})
          };
          const evidenceKey = `${evidence.component}\u0000${evidence.source}`;
          if (!evidenceByKey.has(evidenceKey)) {
            candidate.componentSenseEvidence.push(evidence);
            evidenceByKey.add(evidenceKey);
          }
        }
        candidate.sourceSurfaces[translation.language] = text(translation.surface);
        candidate.sourceCompositionEvidenceByLanguage[translation.language] = text(translation.compositionEvidence);
        candidate.sourceComponentRolesByLanguage[translation.language] = sourceComponents.map((component) => component.role);
        candidate.sourceMorphemesByLanguage[translation.language] = orderedSourceComponents.map((component) => component.surface);
        candidate.sourceComponentGlossesByLanguage[translation.language] = orderedSourceComponents.map((component) => component.gloss);
        candidate.sourceTranslationMorphemesByLanguage[translation.language] = sourceComponents.map((component) => component.surface);
        candidate.sourceTranslationGlossesByLanguage[translation.language] = sourceComponents.map((component) => component.gloss);
        candidate.sourceComponentIndexesByLanguage[translation.language] = order;
        candidate.sourceLanguages = [...new Set([...candidate.sourceLanguages, text(translation.language)])].sort();
        grouped.set(sequenceKey, candidate);
      }
    });
  }
  return [...grouped.values()]
    .sort((left, right) => (mappingScoreBySequence.get(right.pyashSequence.join("+")) ?? 0)
      - (mappingScoreBySequence.get(left.pyashSequence.join("+")) ?? 0)
      || right.sourceLanguages.length - left.sourceLanguages.length
      || left.maxLayer - right.maxLayer
      || left.frequencyRank - right.frequencyRank
      || left.pyashSequence.join("+").localeCompare(right.pyashSequence.join("+")))
    .slice(0, Math.max(1, Math.trunc(Number(maxCandidates) || 1)));
}

export function buildSenseDerivedCompoundCandidateFromChoice({
  sense,
  selectedComponents = [],
  translations = [],
  relations = [],
  candidateRevision = ENGLISH_WORDNET_SENSE_COMPOUND_CANDIDATE_REVISION,
  choicePromptRevision = ENGLISH_WORDNET_SENSE_COMPOUND_CHOICE_PROMPT_REVISION,
  rationale = "",
  headRelationPolicy = "advisory"
} = {}) {
  const targetSense = normalizedSense(sense);
  const targetHead = normalizeTargetHead(sense?.targetHead);
  if (!targetSense || !Array.isArray(selectedComponents) || !Array.isArray(translations)) {
    throw invalid("component-choice candidate requires a target, selected atoms, and source translations");
  }
  if (!text(candidateRevision) || headRelationPolicy !== "advisory") {
    throw invalid("component-choice candidate requires a versioned advisory head policy");
  }
  const minimumModifiers = targetHead ? 1 : 2;
  const maximumModifiers = targetHead ? MAX_COMPOUND_ATOMS - 1 : MAX_COMPOUND_ATOMS;
  if (selectedComponents.length < minimumModifiers || selectedComponents.length > maximumModifiers) {
    throw invalid(targetHead
      ? "component-choice candidate requires exactly one selected modifier"
      : "component-choice candidate requires exactly two selected atoms");
  }
  const selected = selectedComponents.map((component) => {
    const language = normalized(component?.language);
    const translation = translations.find((row) => normalized(row?.language) === language
      && text(row?.surface) === text(component?.translationSurface)
      && normalized(row?.composition) === "compound");
    if (!translation) {
      throw invalid("component-choice candidate has no matching source evidence", {
        language,
        translationSurface: component?.translationSurface
      });
    }
    const sourceComponents = translation.components ?? [];
    const sourceIndex = Number(component?.sourceIndex);
    const source = sourceComponents[sourceIndex];
    const choice = component?.choice;
    const linked = candidateSense(choice);
    const sequence = Array.isArray(choice?.pyashSequence) ? choice.pyashSequence.map(text).filter(Boolean) : [];
    if (!Number.isSafeInteger(sourceIndex) || !source
      || text(source?.surface) !== text(component?.sourcePart)
      || !componentGlossAlternatives(source?.gloss).includes(normalized(component?.sourceGloss))
      || normalized(source?.role) !== "lexical"
      || normalized(choice?.word) !== normalized(component?.word)
      || !linked || sequence.length !== 1 || !Number.isInteger(choice.componentLayers?.[0])) {
      throw invalid("component-choice candidate contains an ungrounded atom selection", {
        sourcePart: component?.sourcePart,
        word: component?.word
      });
    }
    return {
      language,
      translation,
      sourceIndex,
      sourcePart: text(component.sourcePart),
      sourceGloss: normalized(component.sourceGloss),
      componentMeaning: text(component.componentMeaning),
      word: normalized(component.word),
      choice,
      linked,
      sequence: sequence[0]
    };
  });
  if (new Set(selected.map((component) => component.sequence)).size !== selected.length) {
    throw invalid("component-choice candidate repeats an atom");
  }
  if (targetHead && selected.some((component) => component.sequence === targetHead.pyashSequence[0])) {
    throw invalid("component-choice modifier repeats the existing lexical head", { head: targetHead.word });
  }
  const targetId = targetSense.source;
  const canonicalTarget = targetSense.lemmas[0];
  const aliases = targetSense.lemmas.slice(1);
  const headSense = targetHead ? {
    source: targetSense.source,
    pos: targetSense.pos,
    lemmas: [...targetSense.lemmas],
    definition: targetSense.definition
  } : selected.at(-1).linked;
  const targetHeadChoice = targetHead ? {
    mappingKind: "target-lexical-head",
    mappingCoverageType: "atomic",
    mappingLookupGloss: targetHead.word,
    mappingLookupSenseEvidence: [{
      source: targetSense.source,
      pos: targetSense.pos,
      lemmas: [...targetSense.lemmas],
      definition: targetSense.definition
    }]
  } : null;
  const allSelected = targetHead
    ? [...selected, {
      word: targetHead.word,
      sequence: targetHead.pyashSequence[0],
      linked: headSense,
      choice: targetHeadChoice,
      sourceGloss: targetHead.word,
      componentMeaning: targetSense.definition,
      componentLayer: targetHead.componentLayer
    }]
    : selected;
  const sourceEvidenceByLanguage = new Map();
  selected.forEach((component, candidateIndex) => {
    const sourceEvidence = sourceEvidenceByLanguage.get(component.language) ?? {
      translation: component.translation,
      selected: []
    };
    if (text(sourceEvidence.translation.surface) !== text(component.translation.surface)) {
      throw invalid("selected source evidence has multiple translations for one language", { language: component.language });
    }
    sourceEvidence.selected.push({ ...component, candidateIndex });
    sourceEvidenceByLanguage.set(component.language, sourceEvidence);
  });
  const sourceSurfaces = {};
  const sourceMorphemesByLanguage = {};
  const sourceComponentGlossesByLanguage = {};
  const sourceComponentRolesByLanguage = {};
  const sourceCompositionEvidenceByLanguage = {};
  const sourceTranslationMorphemesByLanguage = {};
  const sourceTranslationGlossesByLanguage = {};
  const sourceComponentIndexesByLanguage = {};
  const sourceCandidateComponentIndexesByLanguage = {};
  for (const [language, sourceEvidence] of sourceEvidenceByLanguage) {
    const translation = sourceEvidence.translation;
    const sourceComponents = translation.components ?? [];
    const selectedForLanguage = sourceEvidence.selected;
    sourceSurfaces[language] = text(translation.surface);
    sourceMorphemesByLanguage[language] = selectedForLanguage.map((component) => component.sourcePart);
    sourceComponentGlossesByLanguage[language] = selectedForLanguage.map((component) => component.sourceGloss);
    sourceComponentRolesByLanguage[language] = sourceComponents.map((component) => text(component.role));
    sourceCompositionEvidenceByLanguage[language] = text(translation.compositionEvidence);
    sourceTranslationMorphemesByLanguage[language] = sourceComponents.map((component) => text(component.surface));
    sourceTranslationGlossesByLanguage[language] = sourceComponents.map((component) => text(component.gloss));
    sourceComponentIndexesByLanguage[language] = selectedForLanguage.map((component) => component.sourceIndex);
    sourceCandidateComponentIndexesByLanguage[language] = selectedForLanguage.map((component) => component.candidateIndex);
  }
  const pyashSequence = allSelected.map((component) => component.sequence);
  const componentGlosses = allSelected.map((component) => component.word);
  const relationIndex = buildWordNetHeadRelationIndex(relations);
  const candidateId = `sense-compound-${hash(`${candidateRevision}\u0000${targetId}\u0000${pyashSequence.join("+")}`).slice(0, 24)}`;
  const componentSenseEvidence = allSelected.map((component) => ({
    component: component.word,
    ...component.linked,
    ...(component.choice?.mappingKind ? { mappingKind: component.choice.mappingKind } : {}),
    ...(component.choice?.mappingCoverageType ? { mappingCoverageType: component.choice.mappingCoverageType } : {}),
    ...(component.choice?.mappingLookupGloss ? { mappingLookupGloss: component.choice.mappingLookupGloss } : {}),
    ...(component.choice?.mappingLookupSenseEvidence?.length
      ? { mappingLookupSenseEvidence: component.choice.mappingLookupSenseEvidence }
      : {}),
    ...(component.choice?.mappingSuggestedWord ? { mappingSuggestedWord: component.choice.mappingSuggestedWord } : {})
  }));
  const componentLayers = allSelected.map((component) => component.componentLayer ?? component.choice?.componentLayers?.[0]);
  const targetHeadRelation = Boolean(targetHead) || hasWordNetHeadSenseRelation(targetId, headSense.source, relationIndex);
  const rationaleText = text(rationale).slice(0, 180);
  return {
    id: candidateId,
    candidateId,
    target: canonicalTarget,
    aliases,
    candidateRevision,
    choicePromptRevision,
    headRelationPolicy,
    senseId: targetId,
    targetPartOfSpeech: targetSense.pos,
    sourceMorphemes: componentGlosses,
    componentGlosses,
    componentRoles: componentGlosses.map(() => "lexeme"),
    pyashSequence,
    componentLayers,
    maxLayer: Math.max(...componentLayers),
    head: componentGlosses.at(-1),
    modifiers: componentGlosses.slice(0, -1),
    sourceSurfaces,
    sourceMorphemesByLanguage,
    sourceComponentGlossesByLanguage,
    sourceComponentRolesByLanguage,
    sourceCompositionEvidenceByLanguage,
    sourceTranslationMorphemesByLanguage,
    sourceTranslationGlossesByLanguage,
    sourceComponentIndexesByLanguage,
    sourceCandidateComponentIndexesByLanguage,
    sourceLanguages: [...sourceEvidenceByLanguage.keys()].sort(),
    ...(targetHead ? {
      targetHeadEvidence: {
        word: targetHead.word,
        pyashSequence: [...targetHead.pyashSequence],
        componentLayer: targetHead.componentLayer,
        targetSenseId: targetSense.source,
        coverageType: targetHead.coverageType
      }
    } : {}),
    status: "candidate-closed",
    confidence: targetHead ? "sense-derived-subtype-compound" : "sense-derived-comparison-compound",
    provenance: "WordNet sense translation and Housekeeper component-choice proposal",
    frequencyRank: targetSense.frequencyRank,
    frequencyTagCount: targetSense.frequencyTagCount,
    targetSenseEvidence: [{
      ...senseRecordForTarget(targetSense),
      compatibleHeadSenseIds: targetHeadRelation ? [headSense.source] : [],
      headRelationPolicy
    }],
    componentSenseEvidence,
    compositionVerdict: "compound",
    compositionRationale: rationaleText,
    choicePromptRevision,
    verificationComposition: "literal",
    verificationMethod: "wordnet-sense-component-choice",
    verificationSenseId: targetId,
    verificationComponentSenseIds: allSelected.map((component) => component.linked.source),
    verificationSourceGlosses: allSelected.map((component) => component.sourceGloss),
    verificationComponentMeanings: allSelected.map((component) => component.componentMeaning),
    verificationHeadSenseId: headSense.source,
    verificationRationale: rationaleText,
    evidence: `target ${targetId}; selected linked atoms ${componentGlosses.join(" + ")}; source gloss evidence retained by language${targetHead ? `; fixed lexical head ${targetHead.word}` : ""}`
  };
}

export function buildWordNetSenseTranslationResponseFormat(languages = ENGLISH_WORDNET_SENSE_COMPOUNDS_LANGUAGES) {
  const allowed = [...new Set(languages.map(normalized))];
  return {
    type: "object",
    required: ["senseId", "translations"],
    additionalProperties: false,
    properties: {
      senseId: { type: "string" },
      translations: {
        type: "array",
        minItems: 1,
        maxItems: allowed.length,
        items: {
          type: "object",
          required: ["language", "surface", "composition", "compositionEvidence", "components"],
          additionalProperties: false,
          properties: {
            language: { type: "string", enum: allowed },
            surface: { type: "string", minLength: 1, maxLength: MAX_SURFACE_CHARS },
            composition: { type: "string", enum: [...COMPOSITION_KINDS] },
            compositionEvidence: { type: "string", maxLength: 500 },
            components: {
              type: "array",
              maxItems: MAX_TRANSLATION_COMPONENTS,
              items: {
                type: "object",
                required: ["surface", "gloss", "role"],
                additionalProperties: false,
                properties: {
                  surface: { type: "string", minLength: 1, maxLength: MAX_COMPONENT_CHARS },
                  gloss: { type: "string", minLength: 1, maxLength: MAX_COMPONENT_CHARS },
                  role: { type: "string", enum: ["lexical", "grammatical", "bound", "uncertain"] }
                }
              }
            }
          }
        }
      }
    }
  };
}

export async function translateWordNetSenseWave({
  senses = [],
  cachedRecords = [],
  wordNetHash,
  languages = ENGLISH_WORDNET_SENSE_COMPOUNDS_LANGUAGES,
  promptRevision = ENGLISH_WORDNET_SENSE_COMPOUNDS_PROMPT_REVISION,
  parallelism = ENGLISH_WORDNET_SENSE_COMPOUNDS_PARALLELISM,
  maxAttempts = 2,
  submit,
  awaitHandle,
  onCache,
  onCacheEntry,
  onFailure
} = {}) {
  if (!Array.isArray(senses) || typeof submit !== "function" || typeof awaitHandle !== "function") {
    throw invalid("sense translation wave requires senses and Housekeeper submit/await functions");
  }
  const cache = new Map(cachedRecords.map((record) => [record.senseId, record]));
  const width = Math.max(1, Math.trunc(Number(parallelism) || 1));
  const attemptsLimit = Math.max(1, Math.trunc(Number(maxAttempts) || 1));
  const failures = [];
  const fatalErrors = [];
  let submittedCount = 0;
  let cacheWrite = Promise.resolve();
  const cacheSnapshot = () => [...cache.values()].sort((left, right) => left.senseId.localeCompare(right.senseId));
  const persistRecord = (record) => {
    if (typeof onCacheEntry !== "function" && typeof onCache !== "function") return Promise.resolve();
    cacheWrite = cacheWrite.then(() => typeof onCacheEntry === "function"
      ? onCacheEntry(record)
      : onCache(cacheSnapshot(), record));
    return cacheWrite;
  };
  const describeError = (error) => {
    const message = text(error?.message ?? error) || "sense translation failed";
    const details = error?.details && typeof error.details === "object" ? error.details : {};
    const concise = Object.fromEntries(Object.entries(details).filter(([key]) => key !== "response").slice(0, 4));
    const handleId = text(details.handleId);
    const providerStatus = text(details.response?.ob?.text ?? details.response?.status ?? details.status);
    const suffix = [
      handleId ? "handle=" + handleId : "",
      providerStatus ? "provider-status=" + providerStatus : "",
      Object.keys(concise).length ? JSON.stringify(concise).slice(0, 300) : ""
    ].filter(Boolean).join(" ");
    return (message + (suffix ? " " + suffix : "")).slice(0, 800);
  };
  const failureId = (senseId, language) => "translation-failure-" + hash(stableJson([
    senseId, normalized(language), promptRevision
  ])).slice(0, 24);
  const recordAttemptFailure = async (state, language, error, handleId, response = "") => {
    const senseId = senseIdOf(state.sense);
    const detail = describeError(error);
    const event = {
      id: "translation-attempt-" + hash(stableJson([
        senseId, language, promptRevision, state.attempt, handleId, detail
      ])).slice(0, 24),
      attempt: state.attempt,
      handleId,
      error: detail
    };
    state.attemptErrorsByLanguage[language] = [
      ...(state.attemptErrorsByLanguage[language] ?? []),
      event
    ];
    state.lastFailureByLanguage.set(language, event);
    if (response) state.lastResponseByLanguage.set(language, response.slice(0, MAX_FAILURE_RESPONSE_CHARS));
    if (typeof onFailure !== "function") return;
    try {
      await onFailure({
        id: failureId(senseId, language),
        senseId,
        language,
        promptRevision,
        status: "failed",
        attempts: state.attempt,
        handleId,
        error: detail,
        attemptErrors: state.attemptErrorsByLanguage[language],
        ...(state.lastResponseByLanguage.has(language)
          ? { response: state.lastResponseByLanguage.get(language) }
          : {})
      });
    } catch (writeError) {
      fatalErrors.push(writeError);
    }
  };
  const makeRecord = (state) => {
    const senseId = senseIdOf(state.sense);
    const translations = languages.map((language) => state.translationsByLanguage.get(normalized(language))).filter(Boolean);
    if (!translations.length) return null;
    const attemptErrorsByLanguage = {
      ...state.priorAttemptErrorsByLanguage,
      ...Object.fromEntries(Object.entries(state.attemptErrorsByLanguage).filter(([, rows]) => rows.length > 0))
    };
    return {
      id: senseTranslationKey({ senseId, wordNetHash, promptRevision, languages }),
      senseId,
      wordNetHash,
      promptRevision,
      languages: [...languages],
      translationPromptRevisionByLanguage: state.languagePromptRevisionByLanguage,
      status: languages.every((language) => state.translationsByLanguage.has(normalized(language))) ? "complete" : "partial",
      translations,
      attempts: state.attempt,
      ...(Object.keys(attemptErrorsByLanguage).length ? { attemptErrorsByLanguage } : {})
    };
  };
  const saveRecord = async (state) => {
    const record = makeRecord(state);
    if (!record) return;
    cache.set(record.senseId, record);
    try {
      await persistRecord(record);
    } catch (error) {
      fatalErrors.push(error);
    }
  };
  const summarizeRemainingError = (state, language) => {
    const row = state.lastFailureByLanguage.get(normalized(language));
    return row?.error || "translation row missing";
  };

  for (let offset = 0; offset < senses.length; offset += width) {
    const wave = senses.slice(offset, offset + width).map((sense, index) => ({
      sense,
      handleId: "wordnet-sense-" + hash(senseIdOf(sense) + "\u0000" + (offset + index)).slice(0, 20)
    }));
    await Promise.all(wave.map(async (state) => {
      const senseId = senseIdOf(state.sense);
      const existing = cache.get(senseId);
      const existingTranslations = Array.isArray(existing?.translations) ? existing.translations : [];
      state.translationsByLanguage = new Map(existingTranslations.map((row) => [normalized(row.language), row]));
      state.languagePromptRevisionByLanguage = { ...(existing?.translationPromptRevisionByLanguage ?? {}) };
      for (const translation of existingTranslations) {
        const language = normalized(translation.language);
        if (language && !state.languagePromptRevisionByLanguage[language]) {
          state.languagePromptRevisionByLanguage[language] = text(existing?.promptRevision) || promptRevision;
        }
      }
      state.priorAttemptErrorsByLanguage = { ...(existing?.attemptErrorsByLanguage ?? {}) };
      state.attemptErrorsByLanguage = {};
      state.lastFailureByLanguage = new Map();
      state.lastResponseByLanguage = new Map();
      state.attempt = 0;
      state.missingLanguages = languages.filter((language) => !state.translationsByLanguage.has(normalized(language)));
      if (!state.missingLanguages.length) {
        if (existing && (existing.promptRevision !== promptRevision
          || stableJson(existing.languages ?? []) !== stableJson(languages))) await saveRecord(state);
        return;
      }
      let repairReason = "";
      while (state.missingLanguages.length > 0 && state.attempt < attemptsLimit) {
        state.attempt += 1;
        const requestedLanguages = [...state.missingLanguages];
        let attemptHandle = state.handleId + "-translate-" + state.attempt;
        let raw = "";
        try {
          const queued = await submit({
            sense: state.sense,
            handleId: state.handleId,
            attempt: state.attempt,
            languages: requestedLanguages,
            repairReason
          });
          if (text(queued?.status ?? queued?.ob?.text).toLowerCase() !== "queued") {
            throw invalid("Housekeeper did not queue sense translation", { handleId: attemptHandle });
          }
          attemptHandle = text(queued?.handleId) || attemptHandle;
          submittedCount += 1;
          const value = await awaitHandle(attemptHandle);
          raw = typeof value === "object" && value !== null && typeof value.text === "string"
            ? value.text
            : String(value ?? "");
        } catch (error) {
          for (const language of requestedLanguages) await recordAttemptFailure(state, language, error, attemptHandle, raw);
          repairReason = requestedLanguages.map((language) => language + ": " + summarizeRemainingError(state, language)).join("; ").slice(0, 1000);
          await saveRecord(state);
          continue;
        }
        const boundedResponse = raw.slice(0, MAX_FAILURE_RESPONSE_CHARS);
        let parsed;
        try {
          parsed = parseWordNetSenseTranslationResponsePartial(raw, { senseId, languages: requestedLanguages });
        } catch (error) {
          for (const language of requestedLanguages) await recordAttemptFailure(state, language, error, attemptHandle, boundedResponse);
          repairReason = requestedLanguages.map((language) => language + ": " + summarizeRemainingError(state, language)).join("; ").slice(0, 1000);
          await saveRecord(state);
          continue;
        }
        for (const translation of parsed.translations) {
          const language = normalized(translation.language);
          state.translationsByLanguage.set(language, translation);
          state.languagePromptRevisionByLanguage[language] = promptRevision;
        }
        for (const failure of parsed.failures) {
          await recordAttemptFailure(state, failure.language, {
            message: failure.error,
            details: failure.details
          }, attemptHandle, boundedResponse);
        }
        state.missingLanguages = requestedLanguages.filter((language) => !state.translationsByLanguage.has(normalized(language)));
        repairReason = state.missingLanguages.map((language) => language + ": " + summarizeRemainingError(state, language)).join("; ").slice(0, 1000);
        await saveRecord(state);
      }
      for (const language of state.missingLanguages) {
        const normalizedLanguage = normalized(language);
        const lastFailure = state.lastFailureByLanguage.get(normalizedLanguage);
        failures.push({
          id: failureId(senseId, normalizedLanguage),
          senseId,
          language: normalizedLanguage,
          promptRevision,
          error: lastFailure?.error ?? "sense translation response did not contain a valid row for this language",
          attempts: state.attempt,
          handleId: lastFailure?.handleId ?? "",
          attemptErrors: state.attemptErrorsByLanguage[normalizedLanguage] ?? [],
          ...(state.lastResponseByLanguage.has(normalizedLanguage)
            ? { response: state.lastResponseByLanguage.get(normalizedLanguage) }
            : {})
        });
      }
      const record = makeRecord(state);
      if (record) cache.set(senseId, record);
    }));
    if (fatalErrors.length) throw fatalErrors[0];
  }
  return {
    records: cacheSnapshot(),
    failures: failures.sort((left, right) => left.senseId.localeCompare(right.senseId)
      || left.language.localeCompare(right.language)),
    submittedCount,
    completedCount: senses.filter((sense) => cache.get(senseIdOf(sense))?.status === "complete").length,
    partialCount: senses.filter((sense) => cache.get(senseIdOf(sense))?.status === "partial").length
  };
}
export function createQueuedMindWordNetSenseTranslationTransport({
  interpret,
  parse,
  model = ENGLISH_WORDNET_SENSE_COMPOUNDS_MODEL,
  maxOutputTokens = ENGLISH_WORDNET_SENSE_COMPOUNDS_MAX_OUTPUT_TOKENS,
  timeoutMs = 1800000
} = {}) {
  if (typeof interpret !== "function" || typeof parse !== "function") {
    throw invalid("queued sense translator requires Pyash interpret and parse functions");
  }
  const runInterpret = serializedInterpreter(interpret);
  return {
    model,
    async submit({ sense, languages = ENGLISH_WORDNET_SENSE_COMPOUNDS_LANGUAGES, handleId, attempt = 1, repairReason = "" } = {}) {
    const id = text(handleId) || `wordnet-sense-translation-${hash(`${senseIdOf(sense)}\u0000${languages.join(",")}`).slice(0, 20)}`;
    const prompt = buildWordNetSenseTranslationPrompt({ sense, languages, repairReason });
    const jobSpec = {
      kind: "ollama-generate",
      prompt,
      model,
      stream: false,
      think: false,
      format: buildWordNetSenseTranslationResponseFormat(languages),
      options: {
        temperature: 0,
        num_predict: Math.max(1, Math.trunc(Number(maxOutputTokens) || ENGLISH_WORDNET_SENSE_COMPOUNDS_MAX_OUTPUT_TOKENS))
      }
    };
    const requestRevision = hash(stableJson(jobSpec)).slice(0, 12);
    const queuedHandle = `${id}-${requestRevision}-translate-${attempt}`;
    recordExchangeJsonArtifact({ identity: queuedHandle, label: "request", producer: "gpu mind request", payload: { handleId: queuedHandle, job: jobSpec } });
    const start = await runInterpret(parse(
      `su name ${JSON.stringify(queuedHandle)} ob text ${JSON.stringify(JSON.stringify(jobSpec))} vyah start future be gpu mind do`
    ));
    return { status: text(start?.ob?.text), handleId: queuedHandle, response: start };
    },
    async await(handleId) {
    const completed = await runInterpret(parse(
      `accordingto text ${JSON.stringify(text(handleId))} during num ${Math.max(1000, Math.trunc(Number(timeoutMs) || 1800000))} vyah await be gpu do`
    ));
    recordExchangeJsonArtifact({ identity: handleId, label: "response", producer: "gpu mind response", payload: { handleId: text(handleId), status: text(completed?.ob?.text), result: completed?.result ?? null } });
    if (text(completed?.ob?.text) !== "success") throw invalid("Housekeeper sense translation did not complete", { handleId, response: completed });
    return { text: text(completed?.result?.text), handleId: text(handleId), model, metadata: completed?.result?.metadata ?? null };
    }
  };
}

export function createQueuedMindSenseCompoundChoiceTransport({
  interpret,
  parse,
  model = ENGLISH_WORDNET_SENSE_COMPOUNDS_MODEL,
  maxOutputTokens = ENGLISH_WORDNET_SENSE_COMPOUND_CHOICE_MAX_OUTPUT_TOKENS,
  timeoutMs = 1800000
} = {}) {
  if (typeof interpret !== "function" || typeof parse !== "function") {
    throw invalid("queued component chooser requires Pyash interpret and parse functions");
  }
  const runInterpret = serializedInterpreter(interpret);
  const waitMs = Math.max(1000, Math.trunc(Number(timeoutMs) || 1800000));
  return async ({ input, handleId, attempt = 1 } = {}) => {
    if (!input?.prompt || !input?.responseFormat) throw invalid("queued component chooser requires a prepared prompt");
    const id = text(handleId) || `wordnet-sense-component-choice-${hash(input.prompt).slice(0, 20)}`;
    const jobSpec = {
      kind: "ollama-generate",
      prompt: String(input.prompt),
      model,
      stream: false,
      think: false,
      format: input.responseFormat,
      options: {
        temperature: 0,
        num_predict: Math.max(32, Math.trunc(Number(maxOutputTokens) || ENGLISH_WORDNET_SENSE_COMPOUND_CHOICE_MAX_OUTPUT_TOKENS))
      }
    };
    const queuedHandle = `${id}-compose-${Math.max(1, Math.trunc(Number(attempt) || 1))}`;
    recordExchangeJsonArtifact({ identity: queuedHandle, label: "request", producer: "gpu mind request", payload: { handleId: queuedHandle, job: jobSpec } });
    const started = await runInterpret(parse(
      `su name ${JSON.stringify(queuedHandle)} ob text ${JSON.stringify(JSON.stringify(jobSpec))} vyah start future be gpu mind do`
    ));
    if (text(started?.ob?.text) !== "queued") {
      throw invalid("Housekeeper did not queue component-choice prompt", { handleId: queuedHandle, response: started });
    }
    const completed = await runInterpret(parse(
      `accordingto text ${JSON.stringify(queuedHandle)} during num ${waitMs} vyah await be gpu do`
    ));
    recordExchangeJsonArtifact({ identity: queuedHandle, label: "response", producer: "gpu mind response", payload: { handleId: queuedHandle, status: text(completed?.ob?.text), result: completed?.result ?? null } });
    if (text(completed?.ob?.text) !== "success") {
      throw invalid("Housekeeper component-choice duty did not complete successfully", { handleId: queuedHandle, response: completed });
    }
    return text(completed?.result?.text);
  };
}

export function createQueuedMindWordNetSenseTranslator(options = {}) {
  const transport = createQueuedMindWordNetSenseTranslationTransport(options);
  return async ({ sense, languages = ENGLISH_WORDNET_SENSE_COMPOUNDS_LANGUAGES, handleId, attempt = 1, repairReason = "" } = {}) => {
    const queued = await transport.submit({ sense, languages, handleId, attempt, repairReason });
    if (queued.status !== "queued") throw invalid("Housekeeper did not queue sense translation", { handleId, response: queued.response });
    return transport.await(queued.handleId);
  };
}
