import fs from "node:fs/promises";
import { createHash } from "node:crypto";

import { buildProgram } from "../../program.mjs";

export const ENGLISH_LEMMA_FORMAT = "english-lemma-v1";
export const ENGLISH_LEMMA_NAME = "translation_english30k_lemmas";

const ACCEPTED_STATUSES = new Set(["accepted-deterministic", "accepted-curated", "accepted-llm", "repaired-llm"]);
const DEPRECATED_DUPLICATE_STATUS = "deprecated-duplicate";
const MAPPING_KINDS = new Set(["irregular", "inflectional", "derivational", "anchor", "duplicate"]);
const MORPHOLOGY_KINDS = new Set([
  "finite-past",
  "finite-present",
  "progressive",
  "participle",
  "perfective",
  "completive"
]);
const MORPHOLOGY_CERTAINTIES = new Set(["deterministic", "contextual"]);
const LEMMA_PARTS_OF_SPEECH = new Set(["a", "n", "r", "s", "v"]);

function invalid(message, details = {}) {
  const error = new Error(message);
  error.code = "invalid-english-lemma";
  error.details = details;
  return error;
}

export function normalizeEnglishLemmaWord(value) {
  return typeof value === "string"
    ? value.normalize("NFC").trim().toLowerCase().replace(/[ _-]+/gu, " ")
    : "";
}

export function englishLemmaCandidateId(record) {
  const identity = [
    normalizeEnglishLemmaWord(record?.surface),
    normalizeEnglishLemmaWord(record?.lemma),
    Array.isArray(record?.pyashSequence) ? record.pyashSequence.join(" ") : "",
    String(record?.partOfSpeech ?? "").trim().toLowerCase()
  ].join("\u0000");
  return `english-lemma-${createHash("sha256").update(identity).digest("hex").slice(0, 24)}`;
}

export function englishLemmaLookupVariants(value) {
  const normalized = normalizeEnglishLemmaWord(value);
  if (!normalized) return [];
  const variants = new Set([
    normalized,
    normalized.replace(/ /gu, "_"),
    normalized.replace(/ /gu, "-")
  ]);
  return [...variants];
}

function parseJsonPayload(sentence, index) {
  if (typeof sentence?.ob?.text !== "string") {
    throw invalid("English lemma row requires a JSON text payload", { index });
  }
  try {
    return JSON.parse(sentence.ob.text);
  } catch (error) {
    throw invalid("English lemma row JSON payload is malformed", { index, cause: error.message });
  }
}

function normalizeEntry(payload, surface, index) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw invalid("English lemma row payload must be an object", { index });
  }
  const normalizedSurface = normalizeEnglishLemmaWord(payload.surface ?? surface);
  const normalizedKey = normalizeEnglishLemmaWord(surface);
  if (!normalizedSurface || normalizedSurface !== normalizedKey) {
    throw invalid("English lemma row surface must match its Pyash key", { index, surface });
  }
  const lemma = normalizeEnglishLemmaWord(payload.lemma);
  if (!lemma) throw invalid("English lemma row requires a lemma", { index, surface });
  if (!MAPPING_KINDS.has(payload.kind)) {
    throw invalid("English lemma row kind is unsupported", { index, surface, kind: payload.kind });
  }
  const status = String(payload.status ?? "accepted-deterministic").trim();
  if (!status) throw invalid("English lemma row status is empty", { index, surface });
  const duplicateOf = normalizeEnglishLemmaWord(payload.duplicateOf ?? "");
  if (payload.kind === "duplicate" && (status !== DEPRECATED_DUPLICATE_STATUS || !duplicateOf)) {
    throw invalid("duplicate lemma row requires deprecated status and duplicateOf", { index, surface });
  }
  if (status === DEPRECATED_DUPLICATE_STATUS && payload.kind !== "duplicate") {
    throw invalid("deprecated duplicate status requires duplicate mapping kind", { index, surface });
  }
  if (typeof payload.evidence !== "string" || !payload.evidence.trim()) {
    throw invalid("English lemma row requires evidence", { index, surface });
  }
  if (payload.rule !== undefined && (typeof payload.rule !== "string" || !payload.rule.trim())) {
    throw invalid("English lemma row rule must be text", { index, surface });
  }
  const morphology = normalizeMorphology(payload.morphology, normalizedSurface, index);
  const rawPartOfSpeech = String(payload.partOfSpeech ?? "").trim().toLowerCase();
  if (rawPartOfSpeech && !LEMMA_PARTS_OF_SPEECH.has(rawPartOfSpeech)) {
    throw invalid("English lemma part of speech is unsupported", { index, surface, partOfSpeech: rawPartOfSpeech });
  }
  const partOfSpeech = rawPartOfSpeech;
  const pyashSequence = payload.pyashSequence === undefined
    ? []
    : normalizePyashSequence(payload.pyashSequence, normalizedSurface, index);
  const grammaticalNumber = payload.grammaticalNumber === undefined
    ? ""
    : String(payload.grammaticalNumber).trim().toLowerCase();
  if (grammaticalNumber && !["singular", "plural"].includes(grammaticalNumber)) {
    throw invalid("English lemma grammatical number is unsupported", { index, surface, grammaticalNumber });
  }
  return {
    surface: normalizedSurface,
    lemma,
    canonicalEnglish: normalizeEnglishLemmaWord(payload.canonicalEnglish ?? ""),
    kind: payload.kind,
    status,
    ...(partOfSpeech ? { partOfSpeech } : {}),
    ...(duplicateOf ? { duplicateOf } : {}),
    rule: payload.rule?.trim() ?? "",
    evidence: payload.evidence.trim(),
    ...(pyashSequence.length > 0 ? { pyashSequence } : {}),
    ...(morphology ? { morphology } : {}),
    ...(grammaticalNumber ? { grammaticalNumber } : {}),
    ...(Number.isInteger(payload.rank) ? { rank: payload.rank } : {})
  };
}

function normalizePyashSequence(payload, surface, index) {
  if (!Array.isArray(payload)) throw invalid("English lemma Pyash sequence must be a vector", { index, surface });
  const sequence = payload.filter((word) => typeof word === "string" && word.trim()).map((word) => word.trim());
  if (sequence.length === 0) throw invalid("English lemma Pyash sequence must contain a word", { index, surface });
  return sequence;
}

function normalizeMorphology(payload, surface, index) {
  if (payload === undefined) return null;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw invalid("English lemma morphology must be an object", { index, surface });
  }
  if (!MORPHOLOGY_KINDS.has(payload.kind)) {
    throw invalid("English lemma morphology kind is unsupported", { index, surface, kind: payload.kind });
  }
  const markerNames = Array.isArray(payload.markerNames)
    ? payload.markerNames.filter((word) => typeof word === "string" && word.trim()).map((word) => word.trim())
    : [];
  const markerSequence = Array.isArray(payload.markerSequence)
    ? payload.markerSequence.filter((word) => typeof word === "string" && word.trim()).map((word) => word.trim())
    : [];
  if (markerNames.length === 0 || markerNames.length !== markerSequence.length) {
    throw invalid("English lemma morphology requires paired marker names and sequence", { index, surface });
  }
  const certainty = String(payload.certainty ?? "deterministic").trim().toLowerCase();
  if (!MORPHOLOGY_CERTAINTIES.has(certainty)) {
    throw invalid("English lemma morphology certainty is unsupported", { index, surface, certainty });
  }
  if (typeof payload.evidence !== "string" || !payload.evidence.trim()) {
    throw invalid("English lemma morphology requires evidence", { index, surface });
  }
  return {
    kind: payload.kind,
    markerNames,
    markerSequence,
    certainty,
    evidence: payload.evidence.trim()
  };
}

export function parseEnglishLemmaCatalog(source, {
  name = ENGLISH_LEMMA_NAME
} = {}) {
  if (typeof source !== "string") throw invalid("English lemma source must be text");
  const sentences = buildProgram(source).sentences;
  const header = sentences.find((sentence) => (
    sentence?.mood === "def" &&
    sentence?.be === "map" &&
    sentence?.su?.name === name
  ));
  if (!header) throw invalid("English lemma source has no canonical map header");
  const metadata = {};
  for (const sentence of sentences) {
    if (sentence?.mood !== "ya" || typeof sentence.su?.text !== "string") continue;
    if (["format", "source", "source-hash", "duplicate-policy"].includes(sentence.su.text) && typeof sentence.ob?.text === "string") {
      metadata[sentence.su.text] = sentence.ob.text;
    }
    if (sentence.su.text === "cutoff" && Number.isInteger(sentence.ob?.num)) metadata.cutoff = sentence.ob.num;
  }
  if (metadata.format !== ENGLISH_LEMMA_FORMAT) {
    throw invalid("English lemma source has an unsupported format", { format: metadata.format });
  }
  const entries = [];
  const seen = new Set();
  for (const [index, sentence] of sentences.entries()) {
    if (sentence?.mood !== "ya" || typeof sentence.su?.text !== "string") continue;
    if (["format", "source", "source-hash", "duplicate-policy", "cutoff"].includes(sentence.su.text)) continue;
    const entry = normalizeEntry(parseJsonPayload(sentence, index), sentence.su.text, index);
    const identity = `${entry.surface}\u0000${entry.partOfSpeech ?? ""}`;
    if (seen.has(identity)) {
      throw invalid("English lemma surface and part of speech are duplicated", {
        index,
        surface: entry.surface,
        partOfSpeech: entry.partOfSpeech ?? ""
      });
    }
    seen.add(identity);
    entries.push(entry);
  }
  return {
    format: ENGLISH_LEMMA_FORMAT,
    name,
    source: metadata.source ?? "",
    sourceHash: metadata["source-hash"] ?? "",
    duplicatePolicy: metadata["duplicate-policy"] ?? "",
    cutoff: metadata.cutoff ?? null,
    entries
  };
}

export async function loadEnglishLemmaCatalog({
  url = new URL("./english_lemmas.pya", import.meta.url),
  name = ENGLISH_LEMMA_NAME
} = {}) {
  return parseEnglishLemmaCatalog(await fs.readFile(url, "utf8"), { name });
}

function addCandidate(candidates, value, rule) {
  const normalized = normalizeEnglishLemmaWord(value);
  if (!normalized || normalized.length < 2) return;
  const existing = candidates.get(normalized);
  if (!existing || rule.localeCompare(existing) < 0) candidates.set(normalized, rule);
}

export function inflectionCandidates(surface) {
  const word = normalizeEnglishLemmaWord(surface);
  if (!/^[a-z]+$/u.test(word)) return [];
  const candidates = new Map();
  const addStemRules = (ending, rule) => {
    if (!word.endsWith(ending) || word.length <= ending.length + 1) return;
    const stem = word.slice(0, -ending.length);
    const shortRoot = new Set(["be", "do", "go"]);
    if (stem.length >= 3 || shortRoot.has(stem)) addCandidate(candidates, stem, rule);
    if (stem.length >= 3) addCandidate(candidates, `${stem}e`, `${rule}-silent-e`);
    if (stem.endsWith("i")) addCandidate(candidates, `${stem.slice(0, -1)}y`, `${rule}-y`);
    if (stem.length > 2 && stem.at(-1) === stem.at(-2)) addCandidate(candidates, stem.slice(0, -1), `${rule}-doubled`);
  };

  if (word.endsWith("ies")) addCandidate(candidates, `${word.slice(0, -3)}y`, "plural-or-third-person-ies");
  if (word.endsWith("ves")) {
    addCandidate(candidates, `${word.slice(0, -3)}f`, "plural-ves-f");
    addCandidate(candidates, `${word.slice(0, -3)}fe`, "plural-ves-fe");
  }
  addStemRules("es", "plural-or-third-person-es");
  addStemRules("s", "plural-or-third-person-s");
  addStemRules("ied", "past-ied");
  addStemRules("ed", "past-ed");
  if (word.endsWith("ying") && word.length > 4) addCandidate(candidates, `${word.slice(0, -4)}ie`, "present-participle-ying");
  addStemRules("ing", "present-participle-ing");
  addStemRules("est", "superlative-est");
  addStemRules("er", "comparative-er");
  return [...candidates.entries()].map(([lemma, rule]) => ({ lemma, rule }));
}

function buildAtomicLookup(atomicEntries) {
  const lookup = new Map();
  for (const entry of atomicEntries ?? []) {
    const rawEnglish = typeof entry?.en === "string" ? entry.en.trim() : "";
    if (!rawEnglish || rawEnglish.startsWith("_") || rawEnglish.endsWith("_")) continue;
    const english = normalizeEnglishLemmaWord(entry?.en);
    const pya = typeof entry?.pya === "string" ? entry.pya.trim() : "";
    if (!english || !pya) continue;
    const row = {
      surface: english,
      lemma: english,
      canonicalEnglish: english,
      pyashSequence: [pya],
      hnuc: entry.hnuc,
      kind: "identity",
      status: "accepted-deterministic",
      evidence: "existing Pyash atomic vocabulary"
    };
    for (const variant of englishLemmaLookupVariants(english)) if (!lookup.has(variant)) lookup.set(variant, row);
  }
  return lookup;
}

function addExplicitRows(lookup, lookupByPartOfSpeech, entries, atomicLookup, aliases) {
  for (const entry of entries ?? []) {
    const isDeprecatedDuplicate = entry.kind === "duplicate" && entry.status === DEPRECATED_DUPLICATE_STATUS;
    if (!ACCEPTED_STATUSES.has(entry.status) && !isDeprecatedDuplicate) continue;
    const canonical = atomicLookup.get(englishLemmaLookupVariants(entry.canonicalEnglish || entry.duplicateOf || entry.lemma)[0])
      ?? atomicLookup.get(englishLemmaLookupVariants(entry.surface)[0]);
    if (!canonical) continue;
    if (isDeprecatedDuplicate) {
      const duplicate = atomicLookup.get(englishLemmaLookupVariants(entry.surface)[0]);
      if (!duplicate) throw invalid("deprecated duplicate does not name an existing Pyash atom", { surface: entry.surface });
      if (duplicate.pyashSequence.join("\u0000") === canonical.pyashSequence.join("\u0000")) {
        throw invalid("deprecated duplicate must point to a different Pyash atom", { surface: entry.surface, duplicateOf: entry.duplicateOf });
      }
    }
    const row = {
      ...canonical,
      surface: entry.surface,
      lemma: entry.lemma,
      canonicalEnglish: canonical.canonicalEnglish,
      kind: entry.kind,
      status: entry.status,
      ...(entry.duplicateOf ? { duplicateOf: entry.duplicateOf } : {}),
      rule: entry.rule,
      evidence: entry.evidence,
      ...(entry.pyashSequence ? { pyashSequence: [...entry.pyashSequence] } : {}),
      ...(entry.morphology ? {
        morphology: {
          ...entry.morphology,
          markerNames: [...entry.morphology.markerNames],
          markerSequence: [...entry.morphology.markerSequence]
        }
      } : {}),
      ...(entry.grammaticalNumber ? { grammaticalNumber: entry.grammaticalNumber } : {}),
      ...(entry.partOfSpeech ? { partOfSpeech: entry.partOfSpeech } : {}),
      ...(entry.rank === undefined ? {} : { rank: entry.rank })
    };
    const destination = entry.partOfSpeech
      ? lookupByPartOfSpeech.get(entry.partOfSpeech) ?? new Map()
      : lookup;
    if (entry.partOfSpeech && !lookupByPartOfSpeech.has(entry.partOfSpeech)) {
      lookupByPartOfSpeech.set(entry.partOfSpeech, destination);
    }
    for (const variant of englishLemmaLookupVariants(entry.surface)) destination.set(variant, row);
  }
  for (const [surface, anchor] of aliases instanceof Map ? aliases.entries() : []) {
    const canonical = atomicLookup.get(englishLemmaLookupVariants(anchor)[0]);
    if (!canonical) continue;
    const row = {
      ...canonical,
      kind: "anchor",
      evidence: `existing anchor mapping to ${anchor}`
    };
    for (const variant of englishLemmaLookupVariants(surface)) if (!lookup.has(variant)) lookup.set(variant, row);
  }
}

export function buildEnglishLemmaIndex({
  atomicEntries = [],
  aliases = new Map(),
  catalogEntries = []
} = {}) {
  const atomicLookup = buildAtomicLookup(atomicEntries);
  const lookup = new Map(atomicLookup);
  const lookupByPartOfSpeech = new Map();
  addExplicitRows(lookup, lookupByPartOfSpeech, catalogEntries, atomicLookup, aliases);
  const sequenceLookup = new Map();
  const allRows = [...lookup.values(), ...[...lookupByPartOfSpeech.values()].flatMap((rows) => [...rows.values()])];
  for (const row of allRows) {
    if (!Array.isArray(row?.pyashSequence) || row.pyashSequence.length === 0) continue;
    const key = row.pyashSequence.join("\u0000");
    const candidates = sequenceLookup.get(key) ?? [];
    if (!candidates.some((candidate) => candidate.surface === row.surface)) {
      candidates.push(row);
      sequenceLookup.set(key, candidates);
    }
  }
  const sequenceKindRank = new Map([
    ["anchor", 0],
    ["irregular", 1],
    ["identity", 2],
    ["derivational", 3],
    ["inflectional", 4]
  ]);
  const preferredSurfaceForSequence = (sequence) => {
    if (!Array.isArray(sequence) || sequence.length === 0) return "";
    const candidates = sequenceLookup.get(sequence.join("\u0000")) ?? [];
    return [...candidates]
      .sort((left, right) => (
        Number(Boolean(left.partOfSpeech)) - Number(Boolean(right.partOfSpeech))
        || (sequenceKindRank.get(left.kind) ?? 9) - (sequenceKindRank.get(right.kind) ?? 9)
        || String(left.surface).localeCompare(String(right.surface))
      ))
      .at(0)?.surface ?? "";
  };
  const lookupForPartOfSpeech = (surface, partOfSpeech, { scopedOnly = false } = {}) => {
    const variants = englishLemmaLookupVariants(surface);
    const normalizedPartOfSpeech = String(partOfSpeech ?? "").trim().toLowerCase();
    const scoped = normalizedPartOfSpeech ? lookupByPartOfSpeech.get(normalizedPartOfSpeech) : null;
    const specific = variants.map((variant) => scoped?.get(variant)).find(Boolean) ?? null;
    if (specific || scopedOnly) return specific;
    return variants.map((variant) => lookup.get(variant)).find(Boolean) ?? null;
  };
  const lookupRoot = (lemma, partOfSpeech = "") => {
    const variants = englishLemmaLookupVariants(lemma);
    return lookupForPartOfSpeech(lemma, partOfSpeech);
  };
  const targetByLemma = new Map();
  for (const row of allRows) {
    const lemma = normalizeEnglishLemmaWord(row?.lemma);
    const target = normalizeEnglishLemmaWord(row?.canonicalEnglish);
    if (!lemma || !target) continue;
    const key = `${row.partOfSpeech ?? "*"}\u0000${lemma}`;
    const previous = targetByLemma.get(key);
    if (previous && previous !== target) {
      throw invalid("English lemma is assigned to multiple Pyash atoms", {
        lemma,
        partOfSpeech: row.partOfSpeech ?? "",
        targets: [...new Set([previous, target])].sort()
      });
    }
    targetByLemma.set(key, target);
  }
  const resolve = (surface, options = {}) => {
    const rawPartOfSpeech = String(options?.partOfSpeech ?? options?.pos ?? "").trim().toLowerCase();
    const partOfSpeech = rawPartOfSpeech;
    const existing = lookupForPartOfSpeech(surface, partOfSpeech);
    if (existing) return { surface: normalizeEnglishLemmaWord(surface), ...existing };
    const candidates = inflectionCandidates(surface)
      .map(({ lemma, rule }) => ({ lemma, rule, row: lookupRoot(lemma, partOfSpeech) }))
      .filter((candidate) => candidate.row?.pyashSequence?.length)
      .map((candidate) => ({
        surface: normalizeEnglishLemmaWord(surface),
        lemma: candidate.lemma,
        canonicalEnglish: candidate.row.canonicalEnglish,
        pyashSequence: candidate.row.pyashSequence,
        hnuc: candidate.row.hnuc,
        kind: "inflectional",
        status: "accepted-deterministic",
        ...(partOfSpeech ? { partOfSpeech } : {}),
        rule: candidate.rule,
        evidence: `conservative regular inflection of ${candidate.lemma}`
      }));
    const unique = new Map(candidates.map((candidate) => [
      `${candidate.lemma}\u0000${candidate.pyashSequence.join(" ")}`,
      candidate
    ]));
    if (unique.size !== 1) return null;
    return [...unique.values()][0];
  };
  return {
    lookup,
    lookupByPartOfSpeech,
    lookupForPartOfSpeech,
    resolve,
    preferredSurfaceForSequence,
    entries: allRows
  };
}

export function buildEnglishLemmaCandidates({
  sourceRows = [],
  atomicEntries = [],
  aliases = new Map(),
  catalogEntries = []
} = {}) {
  const index = buildEnglishLemmaIndex({ atomicEntries, aliases, catalogEntries });
  const candidates = [];
  for (const source of sourceRows ?? []) {
    if (index.resolve(source.word)) continue;
    const rows = new Map();
    for (const candidate of inflectionCandidates(source.word)) {
      const root = englishLemmaLookupVariants(candidate.lemma)
        .map((variant) => index.lookup.get(variant))
        .find(Boolean);
      if (!root) continue;
      const row = {
        surface: normalizeEnglishLemmaWord(source.word),
        lemma: candidate.lemma,
        canonicalEnglish: root.canonicalEnglish,
        pyashSequence: [...root.pyashSequence],
        kind: "inflectional",
        status: "candidate",
        rule: candidate.rule,
        evidence: `ambiguous regular inflection candidate for ${candidate.lemma}`,
        rank: source.rank,
        score: source.score
      };
      rows.set(`${row.lemma}\u0000${row.pyashSequence.join(" ")}`, row);
    }
    if (rows.size < 2) continue;
    for (const row of rows.values()) candidates.push({ ...row, id: englishLemmaCandidateId(row) });
  }
  return candidates.sort((left, right) => left.rank - right.rank || left.id.localeCompare(right.id));
}

export function renderEnglishLemmaCatalogPya({ source, entries }, {
  name = ENGLISH_LEMMA_NAME
} = {}) {
  if (!source || !Array.isArray(entries)) throw invalid("English lemma renderer requires source and entries");
  const lines = [
    `su name ${name} be map def`,
    `su text "format" ob text ${JSON.stringify(ENGLISH_LEMMA_FORMAT)} ya`,
    `su text "source" ob text ${JSON.stringify(source.path ?? source.source ?? "")} ya`,
    `su text "source-hash" ob text ${JSON.stringify(source.sourceHash ?? "")} ya`,
    `su text "cutoff" ob num ${Number(source.cutoff ?? 0)} ya`,
    ...(source.duplicatePolicy ? [`su text "duplicate-policy" ob text ${JSON.stringify(source.duplicatePolicy)} ya`] : []),
    ...entries
      .filter((entry) => entry?.kind && entry.kind !== "identity")
      .sort((left, right) => normalizeEnglishLemmaWord(left.surface).localeCompare(normalizeEnglishLemmaWord(right.surface)))
      .map((entry) => `su text ${JSON.stringify(entry.surface)} ob text ${JSON.stringify(JSON.stringify({
        surface: entry.surface,
        lemma: entry.lemma,
        ...(entry.canonicalEnglish ? { canonicalEnglish: entry.canonicalEnglish } : {}),
        kind: entry.kind,
        status: entry.status ?? "accepted-deterministic",
        ...(entry.partOfSpeech ? { partOfSpeech: entry.partOfSpeech } : {}),
        ...(entry.duplicateOf ? { duplicateOf: entry.duplicateOf } : {}),
        ...(entry.rule ? { rule: entry.rule } : {}),
        ...(entry.morphology ? { morphology: entry.morphology } : {}),
        ...(entry.pyashSequence ? { pyashSequence: entry.pyashSequence } : {}),
        ...(entry.grammaticalNumber ? { grammaticalNumber: entry.grammaticalNumber } : {}),
        ...(entry.rank === undefined ? {} : { rank: entry.rank }),
        evidence: entry.evidence ?? ""
      }))} ya`),
    "prah"
  ];
  return `${lines.join("\n")}\n`;
}

export function deprecatedEnglishAtomSequences(atomicEntries, catalogEntries = []) {
  if (!Array.isArray(atomicEntries) || !Array.isArray(catalogEntries)) {
    throw invalid("deprecated atom filtering requires atom and lemma arrays");
  }
  const deprecated = new Set(catalogEntries
    .filter((entry) => entry?.kind === "duplicate" && entry?.status === DEPRECATED_DUPLICATE_STATUS)
    .map((entry) => normalizeEnglishLemmaWord(entry.surface))
    .filter(Boolean));
  const bySurface = new Map();
  for (const entry of atomicEntries) {
    const surface = normalizeEnglishLemmaWord(entry?.en);
    const pya = typeof entry?.pya === "string" ? entry.pya.trim() : "";
    if (surface && pya && !bySurface.has(surface)) bySurface.set(surface, pya);
  }
  const sequences = new Set();
  for (const surface of deprecated) {
    const pya = bySurface.get(surface);
    if (!pya) throw invalid("deprecated duplicate does not name an existing Pyash atom", { surface });
    sequences.add(pya);
  }
  return sequences;
}

export function filterDeprecatedEnglishAtoms(atomicEntries, catalogEntries = []) {
  if (!Array.isArray(atomicEntries) || !Array.isArray(catalogEntries)) {
    throw invalid("deprecated atom filtering requires atom and lemma arrays");
  }
  deprecatedEnglishAtomSequences(atomicEntries, catalogEntries);
  const deprecated = new Set(catalogEntries
    .filter((entry) => entry?.kind === "duplicate" && entry?.status === DEPRECATED_DUPLICATE_STATUS)
    .map((entry) => normalizeEnglishLemmaWord(entry.surface))
    .filter(Boolean));
  return atomicEntries.filter((entry) => !deprecated.has(normalizeEnglishLemmaWord(entry?.en)));
}
