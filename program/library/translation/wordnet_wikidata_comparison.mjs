import { buildProgram } from "../../program.mjs";

export const WORDNET_WIKIDATA_SAMPLE_LIMIT = 64;
export const WORDNET_WIKIDATA_SAMPLE_FORMAT = "wordnet-wikidata-qwen-sample-v1";
export const WORDNET_WIKIDATA_SAMPLE_NAME = "translation_wordnet_wikidata_comparison";
export const WORDNET_WIKIDATA_LANGUAGES = Object.freeze([
  { name: "chinese", code: "zh" },
  { name: "hindi", code: "hi" },
  { name: "russian", code: "ru" },
  { name: "german", code: "de" },
  { name: "japanese", code: "ja" },
  { name: "korean", code: "ko" },
  { name: "finnish", code: "fi" }
]);

const WORKLIST_NAME = "translation_wordnet_sense_compound_worklist";
const WORKLIST_SENSE_ID = /^[anrsv]:[0-9]{8}-[anrsv]$/u;
const P8814_ID = /^[0-9]{8}-[anrsv]$/u;

function invalid(message, details = {}) {
  return Object.assign(new Error(message), {
    code: "invalid-wordnet-wikidata-comparison",
    details
  });
}

function normalized(value) {
  return typeof value === "string"
    ? value.normalize("NFC").trim().toLowerCase().replace(/[_-]+/gu, " ").replace(/\s+/gu, " ")
    : "";
}

function languageName(languageCode) {
  const base = String(languageCode ?? "").toLowerCase().split("-")[0];
  if (base === "en") return "english";
  return WORDNET_WIKIDATA_LANGUAGES.find(({ code }) => code === base)?.name ?? "";
}

function entityIdFromUri(uri) {
  const match = /^https?:\/\/www\.wikidata\.org\/entity\/([A-Z][0-9]+(?:-[FS][0-9]+)?)$/u.exec(String(uri ?? ""));
  return match?.[1] ?? "";
}

export function parseWordNetSenseCompoundWorklist(source) {
  if (typeof source !== "string") throw invalid("worklist must be Pyash text");
  const sentences = buildProgram(source).sentences;
  const hasHeader = sentences.some((sentence) => (
    sentence?.mood === "def"
    && sentence?.be === "map"
    && sentence?.su?.name === WORKLIST_NAME
  ));
  if (!hasHeader) throw invalid("worklist has no coding-saddle sense-compound map header");

  const metadata = {};
  const rows = [];
  const seen = new Set();
  for (const sentence of sentences) {
    if (sentence?.mood !== "ya" || typeof sentence.su?.text !== "string") continue;
    if (sentence.su.text.startsWith("meta:")) {
      if (typeof sentence.ob?.text === "string") metadata[sentence.su.text.slice(5)] = sentence.ob.text;
      continue;
    }
    if (!WORKLIST_SENSE_ID.test(sentence.su.text) || typeof sentence.ob?.text !== "string") continue;
    let row;
    try {
      row = JSON.parse(sentence.ob.text);
    } catch (error) {
      throw invalid("worklist contains malformed sense JSON", { senseId: sentence.su.text, cause: error.message });
    }
    if (row?.senseId !== sentence.su.text || !P8814_ID.test(row?.synset ?? "")) {
      throw invalid("worklist sense identity does not match its row", { senseId: sentence.su.text });
    }
    if (seen.has(row.senseId)) throw invalid("worklist contains a duplicate sense", { senseId: row.senseId });
    seen.add(row.senseId);
    rows.push(row);
  }
  if (!metadata["source-hash"] || !metadata["worklist-hash"]) {
    throw invalid("worklist is missing its source or worklist hash");
  }
  return { metadata, rows };
}

export function selectCachedQwenSample({ worklist, cache, limit = WORDNET_WIKIDATA_SAMPLE_LIMIT } = {}) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > WORDNET_WIKIDATA_SAMPLE_LIMIT) {
    throw invalid(`sample limit must be between 1 and ${WORDNET_WIKIDATA_SAMPLE_LIMIT}`, { limit });
  }
  if (!Array.isArray(worklist?.rows) || !(cache?.bySense instanceof Map)) {
    throw invalid("sample selection requires a parsed worklist and translation cache");
  }
  const sourceHash = String(worklist.metadata?.["source-hash"] ?? "");
  const sample = [];
  for (const sense of worklist.rows) {
    const translation = cache.bySense.get(sense.senseId);
    if (translation?.status !== "complete" || translation.wordNetHash !== sourceHash) continue;
    sample.push({ sense, translation });
    if (sample.length >= limit) break;
  }
  return sample;
}

export function wordNet31IdForOpenSynset(sense, wordNet31Index) {
  const p8814Id = String(sense?.synset ?? "");
  const match = /^([0-9]{8})-([anrsv])$/u.exec(p8814Id);
  if (!match) return { status: "invalid-synset-id", p8814Id: "", matchedLemmas: [] };
  const [, offset, pos] = match;
  const senseKeys = wordNet31Index?.bySynset?.get(`${pos}:${offset}`) ?? [];
  const openLemmas = new Set((Array.isArray(sense?.lemmas) ? sense.lemmas : [sense?.lemma])
    .map(normalized)
    .filter(Boolean));
  const matchedLemmas = [...new Set(senseKeys
    .map((senseKey) => normalized(String(senseKey).split("%")[0]))
    .filter((lemma) => openLemmas.has(lemma)))].sort();
  return matchedLemmas.length > 0
    ? { status: "matched", p8814Id, matchedLemmas }
    : { status: "lemma-mismatch", p8814Id, matchedLemmas: [] };
}

export function buildWikidataWordNetQuery(p8814Ids = []) {
  const ids = [...new Set(p8814Ids.map((value) => String(value ?? "")))];
  if (ids.length === 0 || ids.some((id) => !P8814_ID.test(id))) {
    throw invalid("Wikidata query requires valid WordNet 3.1 synset IDs", { p8814Ids });
  }
  const targetLanguages = ["en", ...WORDNET_WIKIDATA_LANGUAGES.map(({ code }) => code)];
  const languageFilters = targetLanguages.map((language) => `LANGMATCHES(?labelLanguage, ${JSON.stringify(language)})`).join(" || ");
  return [
    "PREFIX wdt: <http://www.wikidata.org/prop/direct/>",
    "PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>",
    "PREFIX schema: <http://schema.org/>",
    "SELECT ?synsetId ?entity ?label ?labelLanguage ?description WHERE {",
    `  VALUES ?synsetId { ${ids.map((id) => JSON.stringify(id)).join(" ")} }`,
    "  ?entity wdt:P8814 ?synsetId .",
    "  OPTIONAL {",
    "    ?entity rdfs:label ?label .",
    "    BIND(LANG(?label) AS ?labelLanguage)",
    `    FILTER(${languageFilters})`,
    "  }",
    "  OPTIONAL {",
    "    ?entity schema:description ?description .",
    '    FILTER(LANG(?description) = "en")',
    "  }",
    "}",
    "ORDER BY ?synsetId ?entity ?labelLanguage ?label"
  ].join("\n");
}

export function parseWikidataWordNetBindings(payload, { expectedSynsetIds = [] } = {}) {
  const bindings = payload?.results?.bindings;
  if (!Array.isArray(bindings)) throw invalid("Wikidata response has no SPARQL bindings");
  const expected = new Set(expectedSynsetIds);
  const grouped = new Map();
  for (const binding of bindings) {
    const synsetId = String(binding?.synsetId?.value ?? "");
    const uri = String(binding?.entity?.value ?? "");
    const entityId = entityIdFromUri(uri);
    if (!expected.has(synsetId) || !entityId) {
      throw invalid("Wikidata response contains an unexpected synset or entity", { synsetId, uri });
    }
    let entities = grouped.get(synsetId);
    if (!entities) grouped.set(synsetId, entities = new Map());
    let entity = entities.get(uri);
    if (!entity) {
      entity = { entityId, uri, labels: new Map(), englishDescriptions: new Set() };
      entities.set(uri, entity);
    }
    const label = String(binding?.label?.value ?? "").normalize("NFC").trim();
    const languageCode = String(binding?.labelLanguage?.value ?? "").toLowerCase();
    const language = languageName(languageCode);
    if (label && language) {
      const labels = entity.labels.get(language) ?? new Map();
      labels.set(`${languageCode}\u0000${label}`, { language, languageCode, value: label });
      entity.labels.set(language, labels);
    }
    const description = String(binding?.description?.value ?? "").normalize("NFC").trim();
    if (description) entity.englishDescriptions.add(description);
  }
  return new Map([...grouped].map(([synsetId, entities]) => [
    synsetId,
    [...entities.values()].map((entity) => ({
      entityId: entity.entityId,
      uri: entity.uri,
      labels: [...entity.labels.values()].flatMap((labels) => [...labels.values()])
        .sort((left, right) => left.language.localeCompare(right.language)
          || left.languageCode.localeCompare(right.languageCode)
          || left.value.localeCompare(right.value)),
      englishDescriptions: [...entity.englishDescriptions].sort()
    })).sort((left, right) => left.entityId.localeCompare(right.entityId))
  ]));
}

function qwenTranslationsByLanguage(translation) {
  const byLanguage = new Map();
  for (const row of translation?.translations ?? []) {
    const language = String(row?.language ?? "").toLowerCase();
    const surface = String(row?.surface ?? "").normalize("NFC").trim();
    if (!language || !surface) continue;
    const values = byLanguage.get(language) ?? [];
    values.push({
      language,
      surface,
      composition: String(row.composition ?? ""),
      components: Array.isArray(row.components) ? row.components : []
    });
    byLanguage.set(language, values);
  }
  return byLanguage;
}

function normalizedSurface(value, language) {
  const surface = String(value ?? "").normalize("NFC").trim();
  return language === "chinese"
    ? surface.replace(/\s+/gu, "")
    : normalized(surface);
}

export function buildWordNetWikidataComparison({
  runId = "",
  worklistHash = "",
  sourceHash = "",
  wordNet31IndexHash = "",
  wikidataEndpoint = "https://query.wikidata.org/sparql",
  wikidataQuery = "",
  translationCacheSnapshot = {},
  sample = [],
  crosswalkBySense = new Map(),
  entitiesBySynset = new Map(),
  createdAt = new Date().toISOString()
} = {}) {
  if (!Array.isArray(sample) || !(crosswalkBySense instanceof Map) || !(entitiesBySynset instanceof Map)) {
    throw invalid("comparison requires sample rows and crosswalk/mapping indexes");
  }
  const labelsByLanguage = Object.fromEntries(WORDNET_WIKIDATA_LANGUAGES.map(({ name }) => [name, 0]));
  const qwenByLanguage = Object.fromEntries(WORDNET_WIKIDATA_LANGUAGES.map(({ name }) => [name, 0]));
  const exactSurfaceOverlapsByLanguage = Object.fromEntries(WORDNET_WIKIDATA_LANGUAGES.map(({ name }) => [name, 0]));
  const comparableByLanguage = Object.fromEntries(WORDNET_WIKIDATA_LANGUAGES.map(({ name }) => [name, 0]));
  let exactP8814Matches = 0;
  let wikidataEntities = 0;
  let samplesWithTargetLanguageLabels = 0;

  const records = sample.map(({ sense, translation }) => {
    const crosswalk = crosswalkBySense.get(sense.senseId)
      ?? { status: "not-checked", p8814Id: "", matchedLemmas: [] };
    const entities = crosswalk.status === "matched"
      ? entitiesBySynset.get(crosswalk.p8814Id) ?? []
      : [];
    if (crosswalk.status === "matched" && entities.length > 0) exactP8814Matches += 1;
    wikidataEntities += entities.length;
    const qwenTranslationsByLang = qwenTranslationsByLanguage(translation);
    const comparison = {};
    let rowHasLabel = false;
    for (const { name } of WORDNET_WIKIDATA_LANGUAGES) {
      const qwenTranslations = qwenTranslationsByLang.get(name) ?? [];
      const wikidataLabels = entities.flatMap((entity) => entity.labels
        .filter((label) => label.language === name)
        .map((label) => ({ entityId: entity.entityId, languageCode: label.languageCode, value: label.value })));
      const qwenSurfaces = new Set(qwenTranslations.map((row) => normalizedSurface(row.surface, name)));
      const exactSurfaceOverlap = qwenTranslations.length > 0 && wikidataLabels.length > 0
        ? wikidataLabels.some((label) => qwenSurfaces.has(normalizedSurface(label.value, name)))
        : null;
      if (qwenTranslations.length > 0) qwenByLanguage[name] += 1;
      if (wikidataLabels.length > 0) {
        labelsByLanguage[name] += 1;
        rowHasLabel = true;
      }
      if (exactSurfaceOverlap !== null) {
        comparableByLanguage[name] += 1;
        if (exactSurfaceOverlap) exactSurfaceOverlapsByLanguage[name] += 1;
      }
      comparison[name] = { qwenTranslations, wikidataLabels, exactSurfaceOverlap };
    }
    if (rowHasLabel) samplesWithTargetLanguageLabels += 1;
    return {
      id: `comparison:${sense.senseId}`,
      senseId: sense.senseId,
      synsetId: sense.synset,
      partOfSpeech: sense.pos,
      lemma: sense.lemma,
      lemmas: Array.isArray(sense.lemmas) ? sense.lemmas : [],
      gloss: sense.gloss,
      frequencyRank: sense.frequencyRank ?? null,
      tagCount: sense.tagCount ?? null,
      qwenStatus: translation?.status ?? "missing",
      crosswalk,
      wikidataEntities: entities,
      comparison
    };
  });

  return {
    format: WORDNET_WIKIDATA_SAMPLE_FORMAT,
    metadata: {
      runId,
      worklistHash,
      sourceHash,
      wordNet31IndexHash,
      createdAt,
      wikidataSource: "Wikidata Query Service; direct P8814 matches and multilingual rdfs:label values",
      wikidataEndpoint,
      wikidataQuery,
      translationCacheSnapshot,
      matchingPolicy: "exact WordNet 3.1 synset identifier via the pinned index; P8814 only",
      languageSet: WORDNET_WIKIDATA_LANGUAGES.map(({ name, code }) => ({ name, code })),
      sampleSelection: "first frequency-ordered active-worklist rows with complete cached Qwen translations",
      sampleLimit: WORDNET_WIKIDATA_SAMPLE_LIMIT
    },
    summary: {
      worklistSampleCount: sample.length,
      exactP8814Matches,
      samplesWithTargetLanguageLabels,
      wikidataEntities,
      labelsByLanguage,
      qwenByLanguage,
      comparableByLanguage,
      exactSurfaceOverlapsByLanguage
    },
    records
  };
}

export function renderWordNetWikidataComparisonPya(report) {
  if (report?.format !== WORDNET_WIKIDATA_SAMPLE_FORMAT || !Array.isArray(report.records)) {
    throw invalid("comparison artifact has an invalid format or record list");
  }
  const lines = [`su name ${WORDNET_WIKIDATA_SAMPLE_NAME} be map def`];
  for (const [key, value] of Object.entries({
    format: report.format,
    metadata: JSON.stringify(report.metadata ?? {}),
    summary: JSON.stringify(report.summary ?? {})
  })) {
    lines.push(`su text ${JSON.stringify(`meta:${key}`)} ob text ${JSON.stringify(value)} ya`);
  }
  const seen = new Set();
  for (const record of report.records) {
    if (!record?.id || seen.has(record.id)) throw invalid("comparison artifact has a missing or duplicate record identity", { id: record?.id });
    seen.add(record.id);
    lines.push(`su text ${JSON.stringify(record.id)} ob text ${JSON.stringify(JSON.stringify(record))} ya`);
  }
  lines.push("prah", "");
  return lines.join("\n");
}
