import fs from "node:fs/promises";
import { createHash } from "node:crypto";

export const HKESTLAT_COMPOUND_ANALYSIS_FORMAT = "hkestlat-compound-analysis-v1";
export const HKESTLAT_DICTIONARY_SOURCE = "hkestlat/mwonkwon.json";
export const HKESTLAT_STEM_SOURCE = "hkestlat/chinese_dictionary_stems.json";

export const WORLD_ENGLISH_BIBLE_MATTHEW_6_9_13 = Object.freeze([
  Object.freeze({
    locator: "Matthew 6:9",
    text: "Our Father in heaven, may your name be kept holy."
  }),
  Object.freeze({
    locator: "Matthew 6:10",
    text: "Let your Kingdom come. Let your will be done, as in heaven, so on earth."
  }),
  Object.freeze({
    locator: "Matthew 6:11",
    text: "Give us today our daily bread."
  }),
  Object.freeze({
    locator: "Matthew 6:12",
    text: "Forgive us our debts, as we also forgive our debtors."
  }),
  Object.freeze({
    locator: "Matthew 6:13",
    text: "Bring us not into temptation, but deliver us from the evil one. For yours is the Kingdom, the power, and the glory forever. Amen."
  })
]);

const LORD_PRAYER_TERMS = Object.freeze([
  ["our", "Matthew 6:9"],
  ["father", "Matthew 6:9"],
  ["heaven", "Matthew 6:9"],
  ["name", "Matthew 6:9"],
  ["holy", "Matthew 6:9"],
  ["kingdom", "Matthew 6:10"],
  ["come", "Matthew 6:10"],
  ["will", "Matthew 6:10"],
  ["earth", "Matthew 6:10"],
  ["today", "Matthew 6:11"],
  ["daily", "Matthew 6:11"],
  ["bread", "Matthew 6:11"],
  ["debts", "Matthew 6:12"],
  ["debtors", "Matthew 6:12"],
  ["temptation", "Matthew 6:13"],
  ["evil", "Matthew 6:13"],
  ["power", "Matthew 6:13"],
  ["glory", "Matthew 6:13"],
  ["forever", "Matthew 6:13"],
  ["amen", "Matthew 6:13"]
].map(([term, locator]) => Object.freeze({ term, locator })));

export class HkestlatCompoundAnalysisError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "HkestlatCompoundAnalysisError";
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new HkestlatCompoundAnalysisError(code, message, details);
}

function text(value) {
  return typeof value === "string"
    ? value.normalize("NFC").replace(/\r\n?/gu, "\n").trim()
    : "";
}

function pyash(value) {
  const valueText = text(value).replace(/[.,;:]+$/u, "");
  return valueText || null;
}

function componentPyash(value) {
  return text(value)
    .split(/\s+/u)
    .map((item) => pyash(item))
    .filter(Boolean);
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, stableValue(value[key])])
    );
  }
  return value;
}

function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

function identity(prefix, value) {
  return `${prefix}-${createHash("sha256").update(stableJson(value)).digest("hex").slice(0, 24)}`;
}

function sourceHash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function requireRows(rows, name) {
  if (!Array.isArray(rows)) {
    fail("invalid-source", `${name} must be an array`);
  }
}

function addToIndex(index, key, value) {
  if (!index.has(key)) index.set(key, []);
  index.get(key).push(value);
}

function uniqueSorted(values) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function compareCandidate(left, right) {
  return stableJson(left).localeCompare(stableJson(right));
}

function buildDictionaryIndex(rows) {
  const bySurface = new Map();
  const byPyash = new Map();
  const byEnglish = new Map();

  rows.forEach((row, index) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      fail("invalid-dictionary-row", "hkestlat dictionary rows must be objects", { index });
    }
    const surface = text(row.zh);
    if (!surface) return;
    const candidate = {
      english: text(row.en),
      pyash: pyash(row.pya),
      surface
    };
    addToIndex(bySurface, surface, candidate);
    if (candidate.pyash) addToIndex(byPyash, candidate.pyash, candidate);
    if (candidate.english) addToIndex(byEnglish, candidate.english.toLowerCase(), candidate);
  });

  for (const index of [bySurface, byPyash, byEnglish]) {
    for (const [key, values] of index) {
      const unique = new Map(values.map((value) => [stableJson(value), value]));
      index.set(key, [...unique.values()].sort(compareCandidate));
    }
  }
  return { bySurface, byPyash, byEnglish };
}

function dictionaryCandidate(candidate) {
  return {
    english: candidate.english || null,
    pyash: candidate.pyash,
    surface: candidate.surface
  };
}

function componentEvidence(parts, dictionaryIndex) {
  return parts.map((part) => {
    const candidates = dictionaryIndex.byPyash.get(part) ?? [];
    return {
      pyash: part,
      surfaces: uniqueSorted(candidates.map((candidate) => candidate.surface)),
      english: uniqueSorted(candidates.map((candidate) => candidate.english).filter(Boolean))
    };
  });
}

function normalizeStem(row, index) {
  if (!Array.isArray(row) || row.length < 5) {
    fail("invalid-stem-row", "hkestlat stem rows require five fields", { index });
  }
  const rawSurface = typeof row[1] === "string"
    ? row[1].normalize("NFC").replace(/\r\n?/gu, "\n")
    : "";
  const surface = text(rawSurface);
  if (!surface) fail("invalid-stem-row", "hkestlat stem rows require a surface", { index });
  const declaredLength = Number(row[2]);
  if (!Number.isInteger(declaredLength) || declaredLength < 1) {
    fail("invalid-stem-row", "hkestlat stem rows require a positive length", { index, surface });
  }
  return {
    sourceTargetPyash: pyash(row[0]),
    surface,
    declaredLength,
    sourceLength: [...rawSurface].length,
    observedLength: [...surface].length,
    gloss: text(row[3]),
    componentPyash: componentPyash(row[4])
  };
}

function statusFor({ directTargets, sourceTargetPyash, lengthMatches, componentPyash }) {
  if (!lengthMatches) return "source-shape-mismatch";
  if (directTargets.length > 1) return "ambiguous-target";
  if (directTargets.length === 0 && sourceTargetPyash) return "source-target-only";
  if (directTargets.length === 0) return "missing-target";
  if (sourceTargetPyash && sourceTargetPyash !== directTargets[0]) return "source-target-mismatch";
  if (componentPyash.length >= 2) return "mapped-compound";
  return "mapped";
}

function normalizeSourceHashes(sourceHashes) {
  if (!sourceHashes || typeof sourceHashes !== "object" || Array.isArray(sourceHashes)) return {};
  return Object.fromEntries(
    Object.entries(sourceHashes)
      .filter(([, value]) => typeof value === "string" && value)
      .sort(([left], [right]) => left.localeCompare(right))
  );
}

export function analyzeHkestlatCompounds({
  dictionaryRows,
  stemRows,
  sourceHashes = {}
} = {}) {
  requireRows(dictionaryRows, "dictionaryRows");
  requireRows(stemRows, "stemRows");
  const dictionaryIndex = buildDictionaryIndex(dictionaryRows);
  const recordsByIdentity = new Map();

  stemRows.forEach((rawRow, index) => {
    const stem = normalizeStem(rawRow, index);
    const candidates = dictionaryIndex.bySurface.get(stem.surface) ?? [];
    const directTargets = uniqueSorted(candidates.map((candidate) => candidate.pyash).filter(Boolean));
    const targetEnglish = uniqueSorted(
      candidates
        .filter((candidate) => candidate.pyash && directTargets.includes(candidate.pyash))
        .map((candidate) => candidate.english)
        .filter(Boolean)
    );
    const record = {
      language: "chinese",
      surface: stem.surface,
      kind: stem.componentPyash.length >= 2 || stem.observedLength >= 2 ? "compound" : "atomic",
      gloss: stem.gloss || null,
      declaredLength: stem.declaredLength,
      sourceLength: stem.sourceLength,
      observedLength: stem.observedLength,
      sourceTargetPyash: stem.sourceTargetPyash,
      targetPyash: directTargets.length === 1 ? directTargets[0] : null,
      targetEnglish,
      componentPyash: stem.componentPyash,
      componentEvidence: componentEvidence(stem.componentPyash, dictionaryIndex),
      dictionaryCandidates: candidates.map(dictionaryCandidate),
      status: statusFor({
        directTargets,
        sourceTargetPyash: stem.sourceTargetPyash,
        lengthMatches: stem.declaredLength === stem.sourceLength,
        componentPyash: stem.componentPyash
      })
    };
    const id = identity("hkestlat-compound", record);
    const existing = recordsByIdentity.get(id);
    if (existing) {
      existing.sourceOccurrences += 1;
    } else {
      recordsByIdentity.set(id, { id, ...record, sourceOccurrences: 1 });
    }
  });

  const records = [...recordsByIdentity.values()]
    .sort((left, right) => left.id.localeCompare(right.id));
  const statusCounts = Object.fromEntries(
    [...new Set(records.map((record) => record.status))]
      .sort((left, right) => left.localeCompare(right))
      .map((status) => [status, records.filter((record) => record.status === status).length])
  );
  const source = {
    dictionary: HKESTLAT_DICTIONARY_SOURCE,
    stems: HKESTLAT_STEM_SOURCE
  };

  return {
    format: HKESTLAT_COMPOUND_ANALYSIS_FORMAT,
    source,
    sourceHashes: normalizeSourceHashes(sourceHashes),
    recordCount: records.length,
    statusCounts,
    records
  };
}

export async function loadHkestlatSources({ dictionaryUrl, stemsUrl } = {}) {
  if (!dictionaryUrl || !stemsUrl) {
    fail("invalid-source", "dictionaryUrl and stemsUrl are required");
  }
  const [dictionaryText, stemsText] = await Promise.all([
    fs.readFile(dictionaryUrl, "utf8"),
    fs.readFile(stemsUrl, "utf8")
  ]);
  let dictionaryRows;
  let stemRows;
  try {
    dictionaryRows = JSON.parse(dictionaryText);
    stemRows = JSON.parse(stemsText);
  } catch (error) {
    fail("invalid-source-json", "hkestlat source JSON is malformed", { cause: error.message });
  }
  return {
    dictionaryRows,
    stemRows,
    sourceHashes: {
      [HKESTLAT_DICTIONARY_SOURCE]: sourceHash(dictionaryText),
      [HKESTLAT_STEM_SOURCE]: sourceHash(stemsText)
    }
  };
}

function prayerTermRecord(term, locator, dictionaryIndex, compoundBySurface, lexiconIndex = null) {
  const candidates = dictionaryIndex.byEnglish.get(term) ?? [];
  const directTargets = uniqueSorted(candidates.map((candidate) => candidate.pyash).filter(Boolean));
  const surfaces = uniqueSorted(candidates.map((candidate) => candidate.surface));
  const relatedCompounds = candidates
    .map((candidate) => compoundBySurface.get(candidate.surface))
    .filter(Boolean)
    .map((record) => record.id)
    .sort((left, right) => left.localeCompare(right));
  const status = directTargets.length === 1
    ? "mapped"
    : directTargets.length > 1
      ? "ambiguous-target"
      : "unresolved";
  const payload = {
    term,
    locator,
    candidates: candidates.map(dictionaryCandidate),
    surfaces,
    directTargets,
    relatedCompounds,
    status
  };
  const lexiconEntry = lexiconIndex?.get(term) ?? null;
  if (lexiconEntry) {
    payload.lexicon = {
      greekLemma: lexiconEntry.greekLemma,
      greekForms: [...lexiconEntry.greekForms],
      aramaicForms: [...lexiconEntry.aramaicForms],
      aramaicTransliterations: [...lexiconEntry.aramaicTransliterations],
      yltSurfaces: [...lexiconEntry.yltSurfaces],
      kjvSurfaces: [...lexiconEntry.kjvSurfaces],
      semanticCandidates: lexiconEntry.semanticCandidates.map((candidate) => ({
        ...candidate,
        pyashSequence: [...candidate.pyashSequence]
      })),
      selectedCandidateId: lexiconEntry.selectedCandidateId
    };
  }
  return {
    id: identity("prayer-term", payload),
    ...payload
  };
}

export function buildLordPrayerAnalysis({
  dictionaryRows,
  stemRows,
  sourceHashes = {},
  clauses = WORLD_ENGLISH_BIBLE_MATTHEW_6_9_13,
  lexicon = null,
  lexiconEntries = []
} = {}) {
  requireRows(dictionaryRows, "dictionaryRows");
  requireRows(stemRows, "stemRows");
  if (!Array.isArray(clauses) || clauses.length === 0) {
    fail("invalid-prayer-source", "Lord's Prayer clauses must be a non-empty array");
  }
  const compoundAnalysis = analyzeHkestlatCompounds({ dictionaryRows, stemRows, sourceHashes });
  const dictionaryIndex = buildDictionaryIndex(dictionaryRows);
  const compoundBySurface = new Map();
  for (const record of compoundAnalysis.records) {
    if (!compoundBySurface.has(record.surface)) compoundBySurface.set(record.surface, record);
  }
  const resolvedLexiconEntries = lexicon?.entries ?? lexiconEntries;
  const lexiconIndex = new Map(
    (Array.isArray(resolvedLexiconEntries) ? resolvedLexiconEntries : [])
      .filter((entry) => entry?.term)
      .map((entry) => [entry.term, entry])
  );
  const normalizedClauses = clauses.map((clause) => ({
    locator: text(clause?.locator),
    text: text(clause?.text)
  }));
  if (normalizedClauses.some((clause) => !clause.locator || !clause.text)) {
    fail("invalid-prayer-source", "Lord's Prayer clauses require locator and text");
  }
  const terms = LORD_PRAYER_TERMS.map(({ term, locator }) => (
    prayerTermRecord(term, locator, dictionaryIndex, compoundBySurface, lexiconIndex)
  ));
  return {
    format: HKESTLAT_COMPOUND_ANALYSIS_FORMAT,
    sourceEdition: "World English Bible",
    sourceReference: "Matthew 6:9-13",
    sourceHashes: normalizeSourceHashes(sourceHashes),
    clauses: normalizedClauses,
    terms,
    compoundAnalysis
  };
}

function pyaMapRow(subject, value) {
  return `su text ${JSON.stringify(subject)} ob text ${JSON.stringify(value)} ya`;
}

export function renderLordPrayerAnalysisPya(analysis) {
  if (!analysis || analysis.format !== HKESTLAT_COMPOUND_ANALYSIS_FORMAT) {
    fail("invalid-analysis", "Lord's Prayer analysis has an unsupported format");
  }
  const lines = [
    "su name translation_compound_analysis_lord_prayer be map def",
    pyaMapRow("source", analysis.sourceEdition),
    pyaMapRow("reference", analysis.sourceReference),
    pyaMapRow("format", analysis.format)
  ];
  for (const [name, hash] of Object.entries(analysis.sourceHashes ?? {}).sort(([left], [right]) => left.localeCompare(right))) {
    lines.push(`su name ${name.replace(/[^a-z0-9_]/giu, "_")} ob text ${JSON.stringify(hash)} ya`);
  }
  for (const clause of analysis.clauses ?? []) {
    lines.push(pyaMapRow(`clause:${clause.locator}`, clause.text));
  }
  for (const term of analysis.terms ?? []) {
    lines.push(pyaMapRow(`term:${term.term}`, stableJson(term)));
  }
  lines.push("prah");
  return `${lines.join("\n")}\n`;
}
