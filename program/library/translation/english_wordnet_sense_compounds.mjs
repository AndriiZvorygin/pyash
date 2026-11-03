import { createHash } from "node:crypto";

import { buildProgram } from "../../program.mjs";
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
export const ENGLISH_WORDNET_SENSE_COMPOUNDS_PROMPT_REVISION = "sense-translation-composition-v1";
export const ENGLISH_WORDNET_SENSE_COMPOUNDS_MAX_OUTPUT_TOKENS = 1024;
export const ENGLISH_WORDNET_SENSE_COMPOUNDS_PARALLELISM = 8;

const COMPOSITION_KINDS = new Set(["compound", "simple", "uncertain"]);
const MAX_RESPONSE_CHARS = 24000;
const MAX_FAILURE_RESPONSE_CHARS = 2000;
const MAX_SURFACE_CHARS = 300;
const MAX_COMPONENT_CHARS = 180;
const MAX_COMPONENTS = 3;

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
  return text(value).toLowerCase().replace(/[_-]+/gu, " ").replace(/\s+/gu, " ");
}

function definitionOnly(value, maximum = 320) {
  return text(value).split(";")[0].slice(0, maximum);
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

function linkedHypernymHeads(targetSenseId, linkedHeadIds, relationIndex) {
  const target = text(targetSenseId).toLowerCase();
  const targetPos = target.match(/^([nvars]):/u)?.[1] ?? "";
  if (!target || !targetPos || linkedHeadIds.size === 0) return [];
  const queue = [target];
  const visited = new Set([target]);
  const matches = new Set();
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    for (const parent of relationIndex.hypernyms.get(queue[cursor]) ?? []) {
      if (linkedHeadIds.has(parent) && parent.match(/^([nvars]):/u)?.[1] === targetPos) matches.add(parent);
      if (!visited.has(parent)) {
        visited.add(parent);
        queue.push(parent);
      }
    }
  }
  return [...matches].sort();
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
    "For each translation, mark compound only when its ordinary lexical form transparently combines lexical parts.",
    "When compound, list two or three source-language parts in their natural written order and give each part a one-word or hyphenated English lexical gloss.",
    "Do not force a decomposition for a simple or lexicalized form. Use simple with an empty components array, or uncertain when unsure.",
    "Do not invent Pyash words or choose Pyash atoms. No Pyash atom inventory is provided.",
    "Return one JSON object only, with this shape:",
    '{"senseId":"...","translations":[{"language":"...","surface":"...","composition":"compound|simple|uncertain","components":[{"surface":"...","gloss":"..."}]}]}',
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
  relations = [],
  linkedSenseIds = [],
  linkedAtomicSenses = [],
  maximum = Number.POSITIVE_INFINITY
} = {}) {
  if (!Array.isArray(residualSenses) || !Array.isArray(linkedAtomicSenses)) {
    throw invalid("sense compound worklist requires sense and linked atom arrays");
  }
  const relationIndex = buildWordNetHeadRelationIndex(relations);
  const alreadyLinked = new Set(linkedSenseIds.map(text).filter(Boolean));
  const atomHeads = linkedAtomicSenses.filter((sense) => {
    const id = text(sense?.source ?? sense?.senseId);
    return id && text(sense?.targetKind) === "atom"
      && Array.isArray(sense?.pyashSequence) && sense.pyashSequence.length === 1;
  });
  const linkedHeadIds = new Set(atomHeads.map((sense) => text(sense.source ?? sense.senseId)));
  const linkedAtomicTargets = new Set(atomHeads.map((sense) => normalized(sense.target)).filter(Boolean));
  return residualSenses.map((sense) => {
    const source = senseIdOf(sense);
    const pos = text(sense?.pos || source.split(":")[0]);
    const lemmas = [...new Set((sense?.lemmas ?? []).map(normalized).filter(Boolean))];
    const definition = definitionOnly(sense?.gloss ?? sense?.definition);
    if (!source || !pos || lemmas.length === 0 || !definition || alreadyLinked.has(source)
      || lemmas.some((lemma) => linkedAtomicTargets.has(lemma))) return null;
    const compatibleHeads = linkedHypernymHeads(source, linkedHeadIds, relationIndex);
    if (compatibleHeads.length === 0) return null;
    const candidateRanks = (sense?.candidates ?? []).map((candidate) => Number(candidate.rank ?? candidate.english30kRank))
      .filter((rank) => Number.isFinite(rank) && rank > 0);
    const frequencyRank = Number.isFinite(Number(sense.frequencyRank)) && Number(sense.frequencyRank) > 0
      ? Number(sense.frequencyRank)
      : candidateRanks.length ? Math.min(...candidateRanks) : Number.MAX_SAFE_INTEGER;
    const tagCount = (sense?.candidates ?? []).map((candidate) => candidate.tagCount)
      .filter(Number.isSafeInteger);
    return {
      senseId: source,
      pos,
      synset: text(sense?.synset || source.slice(source.indexOf(":") + 1)),
      lemma: lemmas[0],
      lemmas,
      gloss: definition,
      frequencyRank,
      tagCount: tagCount.length ? Math.max(...tagCount) : Number.isSafeInteger(sense?.tagCount) ? sense.tagCount : -1,
      compatibleHeadSenseIds: compatibleHeads
    };
  }).filter(Boolean)
    .sort((left, right) => left.frequencyRank - right.frequencyRank
      || right.tagCount - left.tagCount
      || left.senseId.localeCompare(right.senseId))
    .slice(0, Math.max(0, Number.isFinite(Number(maximum)) ? Math.trunc(Number(maximum)) : Infinity));
}

export function buildKwonLinkedAtomicChoices({
  suggestions = [],
  activeAtomEntries = [],
  layerByWord = new Map(),
  deprecatedSurfaces = []
} = {}) {
  if (!Array.isArray(suggestions) || !Array.isArray(activeAtomEntries)) {
    throw invalid("Kwon atom mapping requires suggestion and active atom arrays");
  }
  const deprecated = new Set(deprecatedSurfaces.map(normalized).filter(Boolean));
  const activeByWord = new Map();
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
    for (const label of [entry.target, ...(entry.lemmas ?? [])]) {
      const key = normalized(label);
      if (!key || deprecated.has(key)) continue;
      activeByWord.set(key, [...(activeByWord.get(key) ?? []), row]);
    }
  }
  const result = new Map();
  for (const suggestion of suggestions) {
    const input = normalized(suggestion?.input);
    if (!input) continue;
    const choices = [];
    for (const mapping of suggestion?.mappings ?? []) {
      if (mapping?.coverageType !== "atomic" || /duplicate|deprecated|grammar/iu.test(text(mapping.status))) continue;
      const sequence = mapping.pyacSequence ?? mapping.pyashSequence;
      if (!Array.isArray(sequence) || sequence.length !== 1) continue;
      for (const active of activeByWord.get(normalized(mapping.word)) ?? []) {
        if (active.pyashSequence[0] !== sequence[0]) continue;
        choices.push(active);
      }
    }
    const unique = new Map(choices.map((choice) => [`${choice.linkedSense.source}\u0000${choice.pyashSequence.join("+")}`, choice]));
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
      if (!partSurface || partSurface.length > MAX_COMPONENT_CHARS || !gloss || gloss.length > MAX_COMPONENT_CHARS) {
        throw invalid("sense translation component is empty or too long", { index, language, componentIndex });
      }
      return { surface: partSurface, gloss };
    });
    if (composition === "compound" && (components.length < 2 || components.length > MAX_COMPONENTS)) {
      throw invalid("compound translations require two or three components", { index, language, componentCount: components.length });
    }
    if (composition === "simple" && components.length !== 0) {
      throw invalid("simple translations must not contain a decomposition", { index, language });
    }
    if (composition === "uncertain" && components.length !== 0 && (components.length < 2 || components.length > MAX_COMPONENTS)) {
      throw invalid("uncertain translation decomposition must be empty or contain two or three parts", { index, language });
    }
    seen.add(language);
    translations.push({ language, surface, composition, components });
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
  maxCandidates = 8
} = {}) {
  const targetSense = normalizedSense(sense);
  if (!targetSense || !Array.isArray(translations)) throw invalid("sense compound generation requires a target sense and translations");
  const relationIndex = buildWordNetHeadRelationIndex(relations);
  const grouped = new Map();
  const canonicalTarget = targetSense.lemmas[0];
  const aliases = targetSense.lemmas.slice(1);
  for (const translation of translations) {
    if (normalized(translation?.composition) !== "compound"
      || !text(translation?.language)
      || !Array.isArray(translation?.components)
      || translation.components.length < 2
      || translation.components.length > MAX_COMPONENTS) continue;
    const sourceComponents = translation.components.map((component) => ({
      surface: text(component?.surface),
      gloss: text(component?.gloss)
    }));
    if (sourceComponents.some((component) => !component.surface || !component.gloss)) continue;
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
        if (!hasWordNetHeadSenseRelation(targetSense.source, headSense.source, relationIndex)) continue;
        const order = [...selection.keys()].filter((index) => index !== headIndex).concat(headIndex);
        const ordered = order.map((index) => selection[index]);
        const orderedPyash = ordered.map((candidate) => text(candidate.pyashSequence[0]));
        if (new Set(orderedPyash).size !== orderedPyash.length) continue;
        const sequenceKey = orderedPyash.join("+");
        const components = ordered.map((candidate) => normalized(candidate.word));
        if (components.some((component) => !component)) continue;
        const candidateId = `sense-compound-${hash(`${targetSense.source}\u0000${sequenceKey}`).slice(0, 24)}`;
        const candidate = grouped.get(sequenceKey) ?? {
          id: candidateId,
          candidateId,
          target: canonicalTarget,
          aliases,
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
          sourceLanguages: [],
          status: "candidate-closed",
          confidence: "sense-derived-comparison-compound",
          provenance: "WordNet sense translation and linked atom composition",
          frequencyRank: targetSense.frequencyRank,
          frequencyTagCount: targetSense.frequencyTagCount,
          targetSenseEvidence: [{
            ...senseRecordForTarget(targetSense),
            compatibleHeadSenseIds: [headSense.source]
          }],
          componentSenseEvidence: ordered.map((option, index) => ({
            component: components[index],
            ...candidateSense(option)
          })),
          evidence: `target ${targetSense.source}; comparison-language decomposition; linked atoms ${components.join(" + ")}`
        };
        candidate.sourceSurfaces[translation.language] = text(translation.surface);
        candidate.sourceMorphemesByLanguage[translation.language] = sourceComponents.map((component) => component.surface);
        candidate.sourceLanguages = [...new Set([...candidate.sourceLanguages, text(translation.language)])].sort();
        grouped.set(sequenceKey, candidate);
      }
    });
  }
  return [...grouped.values()]
    .sort((left, right) => right.sourceLanguages.length - left.sourceLanguages.length
      || left.maxLayer - right.maxLayer
      || left.frequencyRank - right.frequencyRank
      || left.pyashSequence.join("+").localeCompare(right.pyashSequence.join("+")))
    .slice(0, Math.max(1, Math.trunc(Number(maxCandidates) || 1)));
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
          required: ["language", "surface", "composition", "components"],
          additionalProperties: false,
          properties: {
            language: { type: "string", enum: allowed },
            surface: { type: "string", minLength: 1, maxLength: MAX_SURFACE_CHARS },
            composition: { type: "string", enum: [...COMPOSITION_KINDS] },
            components: {
              type: "array",
              maxItems: MAX_COMPONENTS,
              items: {
                type: "object",
                required: ["surface", "gloss"],
                additionalProperties: false,
                properties: {
                  surface: { type: "string", minLength: 1, maxLength: MAX_COMPONENT_CHARS },
                  gloss: { type: "string", minLength: 1, maxLength: MAX_COMPONENT_CHARS }
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
        if (state.error) failures.push({ senseId: senseIdOf(state.sense), error: state.error });
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
    const start = await interpret(parse(
      `su name ${JSON.stringify(`${id}-translate-${attempt}`)} ob text ${JSON.stringify(JSON.stringify(jobSpec))} vyah start future be gpu mind do`
    ));
    return { status: text(start?.ob?.text), handleId: `${id}-translate-${attempt}`, response: start };
    },
    async await(handleId) {
    const completed = await interpret(parse(
      `accordingto text ${JSON.stringify(text(handleId))} during num ${Math.max(1000, Math.trunc(Number(timeoutMs) || 1800000))} vyah await be gpu do`
    ));
    if (text(completed?.ob?.text) !== "success") throw invalid("Housekeeper sense translation did not complete", { handleId, response: completed });
    return { text: text(completed?.result?.text), handleId: text(handleId), model, metadata: completed?.result?.metadata ?? null };
    }
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
