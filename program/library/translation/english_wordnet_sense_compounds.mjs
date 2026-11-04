import { createHash } from "node:crypto";

import { buildProgram } from "../../program.mjs";
import { recordExchangeJsonArtifact } from "../../bridge/exchange.mjs";
import { extractBoundedJsonObject } from "./english_verification.mjs";
import { hasWordNetHeadSenseRelation, buildWordNetHeadRelationIndex } from "./english_wordnet.mjs";

export const ENGLISH_WORDNET_SENSE_COMPOUNDS_NAME = "translation_wordnet_sense_compounds";
export const ENGLISH_WORDNET_SENSE_COMPOUNDS_FORMAT = "english-wordnet-sense-compounds-v1";
export const ENGLISH_WORDNET_SENSE_COMPOUNDS_CONFIG_URL = new URL("./wordnet_sense_compound_refinery.pya", import.meta.url);
export const ENGLISH_WORDNET_SENSE_TRANSLATION_CACHE_NAME = "translation_wordnet_sense_translation_cache";
export const ENGLISH_WORDNET_SENSE_COMPOUNDS_LANGUAGES = Object.freeze([
  "chinese", "french", "russian", "hindi"
]);
export const ENGLISH_WORDNET_SENSE_COMPOUNDS_MODEL = "qwen3.5:9b";
export const ENGLISH_WORDNET_SENSE_COMPOUNDS_PROMPT_REVISION = "sense-translation-gloss-alternatives-v5";
export const ENGLISH_WORDNET_SENSE_COMPOUND_CHOICE_PROMPT_REVISION = "sense-component-choice-v8";
export const ENGLISH_WORDNET_SENSE_COMPOUND_CANDIDATE_REVISION = "sense-component-choice-v6";
export const ENGLISH_WORDNET_SENSE_COMPOUNDS_MAX_OUTPUT_TOKENS = 1024;
export const ENGLISH_WORDNET_SENSE_COMPOUND_CHOICE_MAX_OUTPUT_TOKENS = 256;
export const ENGLISH_WORDNET_SENSE_COMPOUNDS_PARALLELISM = 8;

const COMPOSITION_KINDS = new Set(["compound", "simple", "uncertain"]);
const MAX_RESPONSE_CHARS = 24000;
const MAX_FAILURE_RESPONSE_CHARS = 2000;
const MAX_SURFACE_CHARS = 300;
const MAX_COMPONENT_CHARS = 180;
const MAX_COMPONENTS = 3;
const MAX_COMPONENT_CHOICES = 4;
const MAX_SENSE_COMPOSITION_PROMPT_CHARS = 8000;
const MAX_WORDNET_FALLBACK_SENSES = 4;
const DIRECT_COMPONENT_MAPPING_KINDS = new Set(["root", "lemma", "dictionary-alias", "gloss", "wordnet-synset", "vocab-suggest-sense"]);
const DIRECT_COMPONENT_COVERAGE_TYPES = new Set(["atomic", "root", "lemma", "alias", "dictionary-alias"]);

function invalid(message, details = {}) {
  const error = new Error(message);
  error.code = "invalid-wordnet-sense-compound";
  error.details = details;
  return error;
}

function text(value) {
  return typeof value === "string" ? value.normalize("NFC").trim() : "";
}

function normalized(value) {
  return text(value).toLowerCase().replace(/[_-]+/gu, " ").replace(/\s+/gu, " ").trim();
}

export function componentGlossAlternatives(value) {
  return [...new Set(text(value).split(/\s*\/\s*/u).map(normalized).filter(Boolean))];
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
  const gloss = definitionOnly(sense?.definition ?? sense?.gloss);
  const requested = [...new Set((missingLanguages ?? []).map(normalized).filter(Boolean))];
  if (!id || !lemma || !gloss || !requested.length) {
    throw invalid("sense translation prompt requires one identified sense, definition, and language set");
  }
  return [
    "Translate this one WordNet sense into the requested comparison languages.",
    "Use its definition to preserve this sense; translate the ordinary lexical meaning, not an explanatory sentence.",
    "Mark compound only when the current ordinary word meaning is transparently composed from its listed parts.",
    "For each part, label role lexical, grammatical, bound, or uncertain. A classifier, article, particle, inflection, derivational ending, or other grammatical material is not a lexical compound part.",
    "Do not split prefixes, suffixes, inflectional endings, or grammatical material. Chinese characters count only when each has a current lexical meaning that contributes to this word, not just a historical or dictionary character meaning.",
    "When compound, list two or three source-language parts in natural written order. For each part, provide up to three distinct concise English lexical glosses that fit this exact sense, separated by / when needed. Include multiple glosses when they express distinct context-compatible contributions; do not add loose synonyms. Explain in compositionEvidence how their current meanings jointly express the sense.",
    "Do not mark a mere phrase, classifier construction, idiom, or opaque lexicalized form as compound. Use simple with empty components, or uncertain when unsure.",
    "Do not invent Pyash words or choose Pyash atoms. No Pyash atom inventory is provided.",
    "Return one JSON object only, with this shape:",
    '{"senseId":"...","translations":[{"language":"...","surface":"...","composition":"compound|simple|uncertain","compositionEvidence":"...","components":[{"surface":"...","gloss":"...","role":"lexical|grammatical|bound|uncertain"}]}]}',
    `SENSE ID: ${id}`,
    `PART OF SPEECH: ${text(sense?.pos)}`,
    `SENSE WORD: ${lemma}`,
    `DEFINITION: ${gloss}`,
    `LANGUAGES: ${JSON.stringify(requested)}`,
    repairReason ? `REPAIR REQUIREMENT: ${text(repairReason).slice(0, 300)}` : ""
  ].filter(Boolean).join("\n");
}

export function buildSenseCompoundWorklist({
  residualSenses = [],
  linkedSenseIds = [],
  maximum = Number.POSITIVE_INFINITY,
  minimumTagCount = 0,
  order = "english30k-rank"
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
    const tagCounts = (sense?.candidates ?? []).map((candidate) => candidate.tagCount)
      .filter(Number.isSafeInteger);
    const tagCount = tagCounts.length ? Math.max(...tagCounts) : Number.isSafeInteger(sense?.tagCount) ? sense.tagCount : -1;
    if (minimumTagCount > 0 && tagCount < minimumTagCount) return null;
    const candidateRanks = (sense?.candidates ?? []).map((candidate) => Number(candidate.rank ?? candidate.english30kRank))
      .filter((rank) => Number.isFinite(rank) && rank > 0);
    const frequencyRank = Number.isFinite(Number(sense.frequencyRank)) && Number(sense.frequencyRank) > 0
      ? Number(sense.frequencyRank)
      : candidateRanks.length ? Math.min(...candidateRanks) : Number.MAX_SAFE_INTEGER;
    return {
      senseId: source,
      pos,
      synset: text(sense?.synset || source.slice(source.indexOf(":") + 1)),
      lemma: lemmas[0],
      lemmas,
      gloss: definition,
      frequencyRank,
      tagCount
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

export function parseWordNetSenseTranslationResponse(value, {
  senseId,
  languages = ENGLISH_WORDNET_SENSE_COMPOUNDS_LANGUAGES,
  maxResponseChars = MAX_RESPONSE_CHARS
} = {}) {
  const raw = String(value ?? "");
  if (raw.length > maxResponseChars) throw invalid("sense translation response exceeds its character limit");
  const payload = extractBoundedJsonObject(raw);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw invalid("sense translation response has no bounded JSON object");
  }
  let translationPayload = payload;
  const wrappedResponse = typeof payload.response === "string"
    ? payload.response
    : typeof payload.message?.content === "string" ? payload.message.content : "";
  if (wrappedResponse) {
    if (wrappedResponse.length > maxResponseChars) throw invalid("wrapped sense translation response exceeds its character limit");
    translationPayload = extractBoundedJsonObject(wrappedResponse);
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
  const allowed = new Set(languages.map(normalized));
  const seen = new Set();
  const translations = [];
  for (const [index, row] of translationPayload.translations.entries()) {
    const language = normalized(row?.language);
    const surface = text(row?.surface);
    const composition = normalized(row?.composition);
    if (!allowed.has(language)) throw invalid("sense translation response contains an unrequested language", { index, language });
    if (seen.has(language)) throw invalid("sense translation response contains a duplicate language", { index, language });
    if (!surface || surface.length > MAX_SURFACE_CHARS) throw invalid("sense translation surface is empty or too long", { index, language });
    if (!COMPOSITION_KINDS.has(composition)) throw invalid("sense translation composition kind is invalid", { index, language, composition });
    if (!Array.isArray(row?.components)) throw invalid("sense translation components must be an array", { index, language });
    const components = row.components.map((component, componentIndex) => {
      const partSurface = text(component?.surface);
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
    if (components.length > MAX_COMPONENTS) {
      throw invalid("sense translation decomposition exceeds three components", { index, language, componentCount: components.length });
    }
    if (composition === "compound" && (components.length < 2 || components.length > MAX_COMPONENTS)) {
      throw invalid("compound translations require two or three components", { index, language, componentCount: components.length });
    }
    if (composition === "uncertain" && components.length !== 0 && (components.length < 2 || components.length > MAX_COMPONENTS)) {
      throw invalid("uncertain translation decomposition must be empty or contain two or three parts", { index, language });
    }
    seen.add(language);
    const nonLexicalParts = components.some((component) => component.role !== "lexical");
    const hasBoundMorphemeMarkers = composition === "compound"
      && components.some((component) => /^[\p{Pd}]|[\p{Pd}]$/u.test(component.surface));
    const evidenceMissing = composition === "compound" && compositionEvidence.length === 0;
    const rejectComposition = composition === "compound" && (nonLexicalParts || hasBoundMorphemeMarkers || evidenceMissing);
    translations.push({
      language,
      surface,
      composition: rejectComposition ? "uncertain" : composition,
      components: composition === "simple" || rejectComposition ? [] : components,
      compositionEvidence: rejectComposition
        ? hasBoundMorphemeMarkers
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

export function parseWordNetSenseTranslationCache(source) {
  if (typeof source !== "string") throw invalid("sense translation cache must be Pyash text");
  const sentences = buildProgram(source).sentences;
  const header = sentences.find((sentence) => sentence?.mood === "def"
    && sentence?.be === "map"
    && sentence?.su?.name === ENGLISH_WORDNET_SENSE_TRANSLATION_CACHE_NAME);
  if (!header) throw invalid("sense translation cache has no canonical map header");
  const metadata = {};
  const records = [];
  const ids = new Set();
  for (const [index, sentence] of sentences.entries()) {
    if (sentence?.mood !== "ya" || typeof sentence.su?.text !== "string") continue;
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
      || !Array.isArray(record.translations)
      || ids.has(record.id)) {
      throw invalid("sense translation cache row has an invalid or duplicated identity", { index, id: sentence.su.text });
    }
    ids.add(record.id);
    records.push(record);
  }
  records.sort((left, right) => left.senseId.localeCompare(right.senseId));
  return {
    format: ENGLISH_WORDNET_SENSE_COMPOUNDS_FORMAT,
    metadata,
    records,
    bySense: new Map(records.map((record) => [record.senseId, record]))
  };
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
    lines.push(`su text ${JSON.stringify(id)} ob text ${JSON.stringify(JSON.stringify(record))} ya`);
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

function sourceDecompositionChoices(translations, kwonCandidatesByGloss, maximumChoices = MAX_COMPONENT_CHOICES) {
  if (!Array.isArray(translations)) return [];
  const decompositions = [];
  for (const translation of translations) {
    if (normalized(translation?.composition) !== "compound"
      || !text(translation?.language)
      || !text(translation?.surface)
      || !Array.isArray(translation?.components)
      || translation.components.length < 2
      || translation.components.length > MAX_COMPONENTS) continue;
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
    if (parts.some((part) => !part.surface || part.role !== "lexical"
      || !part.glossOptions.some((option) => option.choices.length > 0))) continue;
    decompositions.push({
      language: normalized(translation.language),
      surface: text(translation.surface),
      compositionEvidence: text(translation.compositionEvidence),
      translation,
      parts
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
            minItems: 2,
            maxItems: MAX_COMPONENTS,
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
  maximumChoices = MAX_COMPONENT_CHOICES
} = {}) {
  if (!normalizedSense(sense)) throw invalid("component-choice prompt requires one target sense");
  const decompositions = sourceDecompositionChoices(translations, kwonCandidatesByGloss, maximumChoices);
  if (decompositions.length === 0) return null;
  const sourceOptions = availableChoiceValues(decompositions);
  if (sourceOptions.length < 2) return null;
  const groupsByKey = new Map();
  for (const option of sourceOptions) {
    const key = `${option.language}\u0000${option.translationSurface}\u0000${option.sourceIndex}`;
    const group = groupsByKey.get(key) ?? { source: option.sourcePart, glosses: [], atoms: [], atomMeanings: {} };
    if (!group.glosses.includes(option.sourceGloss)) group.glosses.push(option.sourceGloss);
    if (!group.atoms.includes(option.word)) group.atoms.push(option.word);
    if (!group.atomMeanings[option.word] && option.meaning) group.atomMeanings[option.word] = option.meaning;
    groupsByKey.set(key, group);
  }
  const componentOptions = [...groupsByKey.values()].map(({ source, glosses, atoms, atomMeanings }) => ({
    source,
    gloss: glosses.join(" / "),
    atoms,
    atomMeanings
  }));
  const sections = [
    "Form one Pyash compound for the target meaning.",
    "Pyash has a limited inventory of existing atoms. Use only the listed atom words; do not invent or alter words.",
    "The JSON groups source parts, their English glosses, available Pyash atom words, and each atom's linked meaning. Choose atoms whose meanings jointly express the target. These are component choices, not prebuilt compounds.",
    "A compound must contain at least two different atoms and may contain at most three. Choose one atom from each of two or three different source parts in the same translation. Two atoms from the same source part do not satisfy the minimum. One atom alone is not a compound.",
    "Pyash compounds are head-final: the last atom is the head and names the kind of thing or action; earlier atom(s) modify that head. Identify the semantic head from the TARGET meaning, then output the selected atoms in modifier-to-head order. Do not copy the source language's written order automatically.",
    "Ordering example (illustrative only, not candidate atoms): bird snake means a type of snake, so the Pyash order is [bird, snake]. Snake bird means a type of bird, so the Pyash order is [snake, bird].",
    "If fewer than two fit, return uncertain with an empty atoms array.",
    `TARGET: ${senseLemma(sense)} — ${definitionOnly(sense?.definition ?? sense?.gloss)}`,
    "COMPONENT OPTIONS:",
    JSON.stringify(componentOptions, null, 2),
    'Example: part one offers atom1 and part two offers atom2; return {"verdict":"compound","atoms":["atom1","atom2"]}',
    'If fewer than two different atoms fit: {"verdict":"uncertain","atoms":[]}',
    "Return one compound, not a list of alternatives.",
    "Return only this JSON shape:",
    '{"verdict":"compound|uncertain","atoms":["existing atom word"]}'
  ];
  const prompt = sections.join("\n");
  if (prompt.length > MAX_SENSE_COMPOSITION_PROMPT_CHARS) {
    throw invalid("component-choice prompt exceeds its safe character budget", {
      characters: prompt.length,
      sourceOptionCount: sourceOptions.length
    });
  }
  const input = { prompt, sourceOptions, targetPos: text(sense?.pos) };
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
    return { verdict, selectedComponents: [], rationale: "Available mapped atoms do not provide two distinct components." };
  }
  if (verdict !== "compound") throw invalid("component-choice response verdict is unsupported", { verdict });
  if (atoms.length < 2 || atoms.length > MAX_COMPONENTS) {
    throw invalid("component-choice response must select two or three atom words");
  }
  if (new Set(atoms.map(normalized)).size !== atoms.length) {
    throw invalid("component-choice response repeats an atom word");
  }
  const languages = [...new Set(input.sourceOptions.map((option) => normalized(option.language)).filter(Boolean))];
  const compareOptions = (left, right) => (
    Number(normalized(right.choice?.linkedSense?.pos) === normalized(input.targetPos))
    - Number(normalized(left.choice?.linkedSense?.pos) === normalized(input.targetPos))
    || componentMappingScore(right.choice) - componentMappingScore(left.choice)
    || left.sourceIndex - right.sourceIndex
    || left.sourceGloss.localeCompare(right.sourceGloss)
  );
  let selectedComponents = null;
  for (const language of languages) {
    const optionsByWord = atoms.map((word) => input.sourceOptions
      .filter((option) => normalized(option.language) === language && normalized(option.word) === normalized(word))
      .sort(compareOptions));
    if (optionsByWord.some((options) => options.length === 0)) continue;
    const choose = (index, current, usedSourceIndexes, usedSequences) => {
      if (index === optionsByWord.length) return current;
      for (const option of optionsByWord[index]) {
        const sequence = option.pyashSequence.join("+");
        if (usedSourceIndexes.has(option.sourceIndex) || usedSequences.has(sequence)) continue;
        const selected = choose(index + 1, [...current, option],
          new Set([...usedSourceIndexes, option.sourceIndex]), new Set([...usedSequences, sequence]));
        if (selected) return selected;
      }
      return null;
    };
    selectedComponents = choose(0, [], new Set(), new Set());
    if (selectedComponents) break;
  }
  if (!selectedComponents) {
    const unavailable = atoms.filter((word) => !input.sourceOptions.some((option) => normalized(option.word) === normalized(word)));
    throw invalid(unavailable.length
      ? "component-choice response selected a word that is not an available atom"
      : "component-choice response does not map to distinct parts of one source decomposition", { unavailable });
  }
  selectedComponents = selectedComponents.map((option) => ({
    ...option,
    sourceGloss: normalized(option.sourceGloss),
    componentMeaning: option.meaning
  }));
  const rationale = `Selected existing atoms: ${selectedComponents.map((component) => component.word).join(" + ")}`.slice(0, 180);
  return { verdict, selectedComponents, rationale };
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
      || translation.components.length > MAX_COMPONENTS) continue;
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
  if (!targetSense || !Array.isArray(selectedComponents) || !Array.isArray(translations)) {
    throw invalid("component-choice candidate requires a target, selected atoms, and source translations");
  }
  if (!text(candidateRevision) || headRelationPolicy !== "advisory") {
    throw invalid("component-choice candidate requires a versioned advisory head policy");
  }
  if (selectedComponents.length < 2 || selectedComponents.length > MAX_COMPONENTS) {
    throw invalid("component-choice candidate requires two or three selected atoms");
  }
  const language = normalized(selectedComponents[0]?.language);
  if (!language || selectedComponents.some((component) => normalized(component?.language) !== language)) {
    throw invalid("component-choice candidate must use one source language");
  }
  const translation = translations.find((row) => normalized(row?.language) === language
    && normalized(row?.composition) === "compound");
  if (!translation) throw invalid("component-choice candidate has no matching source decomposition", { language });
  const sourceComponents = translation.components ?? [];
  const seenIndexes = new Set();
  const selected = selectedComponents.map((component) => {
    const sourceIndex = Number(component?.sourceIndex);
    const source = sourceComponents[sourceIndex];
    const choice = component?.choice;
    const linked = candidateSense(choice);
    const sequence = Array.isArray(choice?.pyashSequence) ? choice.pyashSequence.map(text).filter(Boolean) : [];
    if (!Number.isSafeInteger(sourceIndex) || !source || seenIndexes.has(sourceIndex)
      || text(source?.surface) !== text(component?.sourcePart)
      || !componentGlossAlternatives(source?.gloss).includes(normalized(component?.sourceGloss))
      || normalized(choice?.word) !== normalized(component?.word)
      || !linked || sequence.length !== 1 || !Number.isInteger(choice.componentLayers?.[0])) {
      throw invalid("component-choice candidate contains an ungrounded atom selection", {
        sourcePart: component?.sourcePart,
        word: component?.word
      });
    }
    seenIndexes.add(sourceIndex);
    return {
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
  const targetId = targetSense.source;
  const canonicalTarget = targetSense.lemmas[0];
  const aliases = targetSense.lemmas.slice(1);
  const pyashSequence = selected.map((component) => component.sequence);
  const componentGlosses = selected.map((component) => component.word);
  const headSense = selected.at(-1).linked;
  const relationIndex = buildWordNetHeadRelationIndex(relations);
  const candidateId = `sense-compound-${hash(`${candidateRevision}\u0000${targetId}\u0000${pyashSequence.join("+")}`).slice(0, 24)}`;
  const componentSenseEvidence = selected.map((component) => ({
    component: component.word,
    ...component.linked,
    ...(component.choice.mappingKind ? { mappingKind: component.choice.mappingKind } : {}),
    ...(component.choice.mappingCoverageType ? { mappingCoverageType: component.choice.mappingCoverageType } : {}),
    ...(component.choice.mappingLookupGloss ? { mappingLookupGloss: component.choice.mappingLookupGloss } : {}),
    ...(component.choice.mappingLookupSenseEvidence?.length
      ? { mappingLookupSenseEvidence: component.choice.mappingLookupSenseEvidence }
      : {}),
    ...(component.choice.mappingSuggestedWord ? { mappingSuggestedWord: component.choice.mappingSuggestedWord } : {})
  }));
  const componentLayers = selected.map((component) => component.choice.componentLayers[0]);
  const targetHeadRelation = hasWordNetHeadSenseRelation(targetId, headSense.source, relationIndex);
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
    sourceSurfaces: { [language]: text(translation.surface) },
    sourceMorphemesByLanguage: { [language]: selected.map((component) => component.sourcePart) },
    sourceComponentGlossesByLanguage: { [language]: selected.map((component) => component.sourceGloss) },
    sourceComponentRolesByLanguage: { [language]: selected.map(() => "lexical") },
    sourceCompositionEvidenceByLanguage: { [language]: text(translation.compositionEvidence) },
    sourceTranslationMorphemesByLanguage: { [language]: sourceComponents.map((component) => text(component.surface)) },
    sourceTranslationGlossesByLanguage: { [language]: sourceComponents.map((component) => text(component.gloss)) },
    sourceComponentIndexesByLanguage: { [language]: selected.map((component) => component.sourceIndex) },
    sourceLanguages: [language],
    status: "candidate-closed",
    confidence: "sense-derived-comparison-compound",
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
    verificationComponentSenseIds: componentSenseEvidence.map((evidence) => evidence.source),
    verificationSourceGlosses: selected.map((component) => component.sourceGloss),
    verificationComponentMeanings: selected.map((component) => component.componentMeaning),
    verificationHeadSenseId: headSense.source,
    verificationRationale: rationaleText,
    evidence: `target ${targetId}; ${language} source decomposition; existing atoms ${componentGlosses.join(" + ")}`
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
              maxItems: MAX_COMPONENTS,
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
  onCache
} = {}) {
  if (!Array.isArray(senses) || typeof submit !== "function" || typeof awaitHandle !== "function") {
    throw invalid("sense translation wave requires senses and Housekeeper submit/await functions");
  }
  const cache = new Map(cachedRecords.map((record) => [record.senseId, record]));
  const width = Math.max(1, Math.trunc(Number(parallelism) || 1));
  const attemptsLimit = Math.max(1, Math.trunc(Number(maxAttempts) || 1));
  const failures = [];
  let submittedCount = 0;
  let cacheWrite = Promise.resolve();
  const cacheSnapshot = () => [...cache.values()].sort((left, right) => left.senseId.localeCompare(right.senseId));
  const persistRecord = (record) => {
    if (typeof onCache !== "function") return Promise.resolve();
    cacheWrite = cacheWrite.then(() => onCache(cacheSnapshot(), record));
    return cacheWrite;
  };
  for (let offset = 0; offset < senses.length; offset += width) {
    const wave = senses.slice(offset, offset + width).map((sense, index) => ({
      sense,
      handleId: `wordnet-sense-${hash(`${senseIdOf(sense)}\u0000${offset + index}`).slice(0, 20)}`,
      attempt: 0,
      queued: false,
      repairReason: "",
      lastResponse: ""
    }));
    await Promise.all(wave.map(async (state) => {
      const existing = cache.get(senseIdOf(state.sense));
      const existingTranslations = Array.isArray(existing?.translations) ? existing.translations : [];
      const missingLanguages = languages.filter((language) => !existingTranslations.some((row) => normalized(row.language) === normalized(language)));
      if (missingLanguages.length === 0) return;
      state.missingLanguages = missingLanguages;
      state.translations = existingTranslations;
      state.attempt = 1;
      try {
        const response = await submit({
          sense: state.sense,
          handleId: state.handleId,
          attempt: state.attempt,
          languages: missingLanguages,
          repairReason: ""
        });
        if (text(response?.status ?? response?.ob?.text).toLowerCase() !== "queued") {
          throw invalid("Housekeeper did not queue sense translation", { handleId: state.handleId });
        }
        state.queued = true;
        submittedCount += 1;
      } catch (error) {
        state.error = text(error?.message ?? error).slice(0, 500) || "Housekeeper submit failed";
      }
    }));
    const fatalErrors = [];
    await Promise.all(wave.map(async (state) => {
      if (!state.queued) {
        if (state.error) failures.push({ senseId: senseIdOf(state.sense), error: state.error, attempts: state.attempt });
        return;
      }
      let lastError = "";
      while (state.attempt <= attemptsLimit) {
        let record;
        try {
          const value = await awaitHandle(`${state.handleId}-translate-${state.attempt}`);
          const raw = typeof value === "object" && value !== null && typeof value.text === "string" ? value.text : String(value ?? "");
          state.lastResponse = raw.slice(0, MAX_FAILURE_RESPONSE_CHARS);
          const parsed = parseWordNetSenseTranslationResponse(raw, {
            senseId: senseIdOf(state.sense),
            languages: state.missingLanguages
          });
          const translationsByLanguage = new Map(state.translations.map((row) => [normalized(row.language), row]));
          for (const row of parsed.translations) translationsByLanguage.set(row.language, row);
          state.translations = languages
            .map((language) => translationsByLanguage.get(normalized(language)))
            .filter(Boolean);
          const id = senseTranslationKey({ senseId: senseIdOf(state.sense), wordNetHash, promptRevision, languages });
          record = {
            id,
            senseId: senseIdOf(state.sense),
            wordNetHash,
            promptRevision,
            languages: [...languages],
            status: languages.every((language) => state.translations.some((row) => normalized(row.language) === normalized(language))) ? "complete" : "partial",
            translations: state.translations,
            attempts: state.attempt
          };
        } catch (error) {
          const details = error?.details && typeof error.details === "object"
            ? ` ${JSON.stringify(error.details).slice(0, 300)}`
            : "";
          lastError = `${text(error?.message ?? error)}${details}`.slice(0, 800)
            || "sense translation response failed validation";
          if (state.attempt >= attemptsLimit) break;
          state.attempt += 1;
          try {
            const response = await submit({
              sense: state.sense,
              handleId: state.handleId,
              attempt: state.attempt,
              languages: state.missingLanguages,
              repairReason: lastError
            });
            if (text(response?.status ?? response?.ob?.text).toLowerCase() !== "queued") {
              throw invalid("Housekeeper did not queue repaired sense translation", { handleId: state.handleId });
            }
            submittedCount += 1;
          } catch (submitError) {
            lastError = text(submitError?.message ?? submitError).slice(0, 500) || lastError;
            break;
          }
          continue;
        }
        cache.set(record.senseId, record);
        try {
          await persistRecord(record);
        } catch (error) {
          fatalErrors.push(error);
        }
        state.queued = false;
        return;
      }
      if (state.queued) failures.push({
        senseId: senseIdOf(state.sense),
        error: lastError || "sense translation failed",
        attempts: state.attempt,
        ...(state.lastResponse ? { response: state.lastResponse } : {})
      });
    }));
    if (fatalErrors.length > 0) throw fatalErrors[0];
  }
  return {
    records: cacheSnapshot(),
    failures: failures.sort((left, right) => left.senseId.localeCompare(right.senseId)),
    submittedCount,
    completedCount: senses.filter((sense) => cache.get(senseIdOf(sense))?.status === "complete").length
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
    const queuedHandle = `${id}-translate-${attempt}`;
    recordExchangeJsonArtifact({ identity: queuedHandle, label: "request", producer: "gpu mind request", payload: { handleId: queuedHandle, job: jobSpec } });
    const start = await interpret(parse(
      `su name ${JSON.stringify(queuedHandle)} ob text ${JSON.stringify(JSON.stringify(jobSpec))} vyah start future be gpu mind do`
    ));
    return { status: text(start?.ob?.text), handleId: queuedHandle, response: start };
    },
    async await(handleId) {
    const completed = await interpret(parse(
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
    const started = await interpret(parse(
      `su name ${JSON.stringify(queuedHandle)} ob text ${JSON.stringify(JSON.stringify(jobSpec))} vyah start future be gpu mind do`
    ));
    if (text(started?.ob?.text) !== "queued") {
      throw invalid("Housekeeper did not queue component-choice prompt", { handleId: queuedHandle, response: started });
    }
    const completed = await interpret(parse(
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
