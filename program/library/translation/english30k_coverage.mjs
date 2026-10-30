import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadAnchorWordForms } from "./anchor_words.mjs";
import {
  buildDerivedCompoundCoverage,
  loadCuratedCompoundDecompositions
} from "./compound_coverage.mjs";
import { loadCompoundMorphology } from "./compound_morphology.mjs";
import {
  buildEnglishLemmaIndex,
  loadEnglishLemmaCatalog
} from "./english_lemmas.mjs";
import {
  buildEnglishDictionaryAliases,
  loadEnglishDictionaryBlacklist
} from "./english_dictionary_aliases.mjs";
import {
  buildEnglishGrammarIndex,
  loadEnglishGrammarCatalog
} from "./english_grammar.mjs";
import {
  loadPyacComplexityLayers,
  loadPyacWordLayerIndex
} from "./pyac_complexity.mjs";
import {
  COMPOSITIONAL_KEYWORDS,
  MOODS,
  ROLE_KEYS,
  TYPE_TOKENS,
  VYAH_ASPECT_ALIASES,
  VYAH_ASPECT_MODIFIERS,
  VYAH_ATTITUDINAL_MODIFIERS,
  VYAH_OUTCOME_MODIFIERS,
  VYAH_TENSE_MODIFIERS
} from "../grammar/keywords.mjs";

export const ENGLISH30K_FORMAT = "english30k-coverage-v1";
export const ENGLISH30K_CUTOFF = 30000;
export const ENGLISH30K_DEFAULT_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../",
  "..",
  "pyachso2n",
  "English30k.txt"
);

const ACCEPTED_COMPOUND_STATUSES = new Set([
  "accepted-curated",
  "accepted-delimited",
  "accepted-deterministic",
  "accepted-llm",
  "repaired-llm"
]);

export const DEFAULT_GRAMMAR_MAPPINGS = new Map(
  [...new Set([
    ...MOODS,
    ...ROLE_KEYS,
    ...TYPE_TOKENS,
    ...COMPOSITIONAL_KEYWORDS,
    ...Object.keys(VYAH_ASPECT_ALIASES),
    ...VYAH_ASPECT_MODIFIERS,
    ...VYAH_TENSE_MODIFIERS,
    ...VYAH_OUTCOME_MODIFIERS,
    ...VYAH_ATTITUDINAL_MODIFIERS
  ])].map((word) => [word, [word]])
);

function invalid(message, details = {}) {
  const error = new Error(message);
  error.code = "invalid-english30k-coverage";
  error.details = details;
  return error;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function normalizeEnglish30kWord(value) {
  return typeof value === "string"
    ? value.normalize("NFC").trim().toLowerCase().replace(/\s+/gu, " ")
    : "";
}

export function english30kLookupVariants(value) {
  const normalized = normalizeEnglish30kWord(value);
  if (!normalized) return [];
  const variants = new Set([normalized]);
  variants.add(normalized.replace(/[ -]+/gu, "_"));
  variants.add(normalized.replace(/_/gu, "-"));
  return [...variants].filter(Boolean);
}

function parseRankedLine(line, lineNumber) {
  const match = String(line).trim().match(/^(\d+)\s+(.+?)\s+([0-9]+(?:\.[0-9]+)?)$/u);
  if (!match) {
    if (!String(line).trim()) return null;
    throw invalid("English30k line is malformed", { lineNumber, line });
  }
  const rank = Number(match[1]);
  const word = match[2].trim();
  const score = Number(match[3]);
  if (!Number.isSafeInteger(rank) || rank < 1 || !word || !Number.isFinite(score)) {
    throw invalid("English30k row has invalid rank, word, or score", { lineNumber, line });
  }
  return { rank, word, normalizedWord: normalizeEnglish30kWord(word), score };
}

export function parseEnglish30kText(text, { cutoff = ENGLISH30K_CUTOFF } = {}) {
  if (typeof text !== "string") throw invalid("English30k source must be text");
  if (!Number.isSafeInteger(cutoff) || cutoff < 1) throw invalid("English30k cutoff must be a positive integer");
  const allRows = text.split(/\r?\n/u)
    .map((line, index) => parseRankedLine(line, index + 1))
    .filter(Boolean);
  const rows = allRows
    .filter((row) => row.rank <= cutoff)
    .sort((left, right) => left.rank - right.rank || left.normalizedWord.localeCompare(right.normalizedWord));
  const seenRanks = new Set();
  const seenWords = new Set();
  for (const row of rows) {
    if (seenRanks.has(row.rank)) throw invalid("English30k rank is duplicated", { rank: row.rank });
    if (seenWords.has(row.normalizedWord)) throw invalid("English30k word is duplicated in cutoff", { word: row.word });
    seenRanks.add(row.rank);
    seenWords.add(row.normalizedWord);
  }
  const missingRanks = [];
  for (let rank = 1; rank <= cutoff; rank += 1) {
    if (!seenRanks.has(rank)) missingRanks.push(rank);
  }
  return {
    format: ENGLISH30K_FORMAT,
    cutoff,
    rows,
    missingRanks,
    sourceHash: sha256(text),
    sourceRows: allRows.length
  };
}

export async function loadEnglish30k({ path = ENGLISH30K_DEFAULT_PATH, cutoff = ENGLISH30K_CUTOFF } = {}) {
  const text = await fs.readFile(path, "utf8");
  return {
    ...parseEnglish30kText(text, { cutoff }),
    path: resolve(path)
  };
}

function mapLookupEntries(entries, valueOf) {
  const result = new Map();
  for (const entry of entries ?? []) {
    const value = valueOf(entry);
    if (!value) continue;
    for (const variant of english30kLookupVariants(value)) {
      if (!result.has(variant)) result.set(variant, entry);
    }
  }
  return result;
}

function variantsForAtomic(value, atomicLookup) {
  return english30kLookupVariants(value)
    .map((variant) => atomicLookup.get(variant))
    .find(Boolean) ?? null;
}

function makeIdentity(row) {
  return `english30k-${String(row.rank).padStart(5, "0")}-${sha256(row.normalizedWord).slice(0, 16)}`;
}

function acceptedCompound(record) {
  const target = normalizeEnglish30kWord(record?.target ?? record?.surface);
  const aliases = Array.isArray(record?.aliases)
    ? record.aliases.map(normalizeEnglish30kWord).filter((alias) => alias && alias !== target)
    : [];
  const status = record?.verificationStatus ?? record?.status;
  const pyashSequence = Array.isArray(record?.pyashSequence)
    ? record.pyashSequence.filter((word) => typeof word === "string" && word.trim())
    : [];
  if (!target || pyashSequence.length < 2 || !ACCEPTED_COMPOUND_STATUSES.has(status)) return null;
  return {
    target,
    aliases,
    status,
    pyashSequence,
    componentGlosses: Array.isArray(record?.componentGlosses) ? [...record.componentGlosses] : [],
    maxLayer: record?.maxLayer,
    provenance: record?.provenance ?? "accepted-compound-coverage"
  };
}

function buildCompoundLookup(records) {
  const lookup = new Map();
  for (const record of records ?? []) {
    const accepted = acceptedCompound(record);
    if (!accepted) continue;
    for (const term of [accepted.target, ...accepted.aliases]) {
      for (const variant of english30kLookupVariants(term)) {
        if (!lookup.has(variant)) lookup.set(variant, accepted);
      }
    }
  }
  return lookup;
}

function normalizeMapping(mapping) {
  if (typeof mapping === "string" && mapping.trim()) return [mapping.trim()];
  if (Array.isArray(mapping)) {
    const words = mapping.filter((word) => typeof word === "string" && word.trim()).map((word) => word.trim());
    return words.length ? words : null;
  }
  return null;
}

export function buildEnglish30kCoverage({
  source,
  atomicEntries = [],
  aliases = new Map(),
  dictionaryAliases = new Map(),
  grammarMappings = DEFAULT_GRAMMAR_MAPPINGS,
  grammarOverrides = new Map(),
  compoundRecords = [],
  lemmaEntries = [],
  lemmaIndex = null
} = {}) {
  if (!source?.rows || !Array.isArray(source.rows)) throw invalid("English30k coverage requires parsed source rows");
  const resolvedLemmaIndex = lemmaIndex ?? buildEnglishLemmaIndex({
    atomicEntries,
    aliases,
    catalogEntries: lemmaEntries
  });
  const atomicLookup = mapLookupEntries(atomicEntries, (entry) => entry?.en);
  const aliasLookup = aliases instanceof Map ? new Map(
    [...aliases.entries()].flatMap(([surface, anchor]) => (
      english30kLookupVariants(surface).map((variant) => [variant, anchor])
    ))
  ) : new Map();
  const dictionaryAliasLookup = dictionaryAliases instanceof Map ? new Map(
    [...dictionaryAliases.entries()].flatMap(([surface, anchor]) => (
      english30kLookupVariants(surface).map((variant) => [variant, anchor])
    ))
  ) : new Map();
  const grammarLookup = grammarMappings instanceof Map ? new Map(
    [...grammarMappings.entries()].flatMap(([surface, mapping]) => (
      english30kLookupVariants(surface).map((variant) => [variant, normalizeMapping(mapping)])
    ))
  ) : new Map();
  const grammarOverrideLookup = grammarOverrides instanceof Map ? new Map(
    [...grammarOverrides.entries()].flatMap(([surface, mapping]) => (
      english30kLookupVariants(surface).map((variant) => [variant, normalizeMapping(mapping)])
    ))
  ) : new Map();
  const compounds = buildCompoundLookup(compoundRecords);
  const withLemma = (record) => {
    const resolved = resolvedLemmaIndex.resolve(rowWord(record));
    if (!resolved) return record;
    return {
      ...record,
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
  };
  const rowWord = (record) => record?.word ?? record?.normalizedWord ?? "";
  const records = source.rows.map((row) => {
    const variants = english30kLookupVariants(row.normalizedWord);
    const grammarOverride = variants.map((variant) => grammarOverrideLookup.get(variant)).find(Boolean);
    if (grammarOverride) {
      return withLemma({
        id: makeIdentity(row),
        ...row,
        coverageType: "grammar",
        status: "covered-grammar",
        pyashSequence: grammarOverride
      });
    }
    const exact = variants.map((variant) => atomicLookup.get(variant)).find(Boolean);
    if (exact) {
      return withLemma({
        id: makeIdentity(row),
        ...row,
        coverageType: "atomic",
        status: "covered-atomic",
        canonicalEnglish: exact.en,
        pyashSequence: [exact.pya],
        hnuc: exact.hnuc
      });
    }
    const resolved = resolvedLemmaIndex.resolve(rowWord(row));
    if (resolved && resolved.status !== "accepted-deterministic") {
      return withLemma({
        id: makeIdentity(row),
        ...row,
        coverageType: "lemma",
        status: "covered-lemma",
        canonicalEnglish: resolved.canonicalEnglish,
        pyashSequence: [...resolved.pyashSequence],
        hnuc: resolved.hnuc
      });
    }
    const alias = variants.map((variant) => aliasLookup.get(variant)).find(Boolean);
    if (alias) {
      const anchor = variantsForAtomic(alias, atomicLookup);
      if (anchor) {
        return withLemma({
          id: makeIdentity(row),
          ...row,
          coverageType: "alias",
          status: "covered-alias",
          canonicalEnglish: anchor.en,
          aliasOf: alias,
          pyashSequence: [anchor.pya],
          hnuc: anchor.hnuc
        });
      }
    }
    const grammar = variants.map((variant) => grammarLookup.get(variant)).find(Boolean);
    if (grammar) {
      return withLemma({
        id: makeIdentity(row),
        ...row,
        coverageType: "grammar",
        status: "covered-grammar",
        pyashSequence: grammar
      });
    }
    const compound = variants.map((variant) => compounds.get(variant)).find(Boolean);
    if (compound) {
      const compoundRecord = {
        id: makeIdentity(row),
        ...row,
        coverageType: "compound",
        status: "covered-compound",
        compoundStatus: compound.status,
        componentGlosses: compound.componentGlosses,
        pyashSequence: compound.pyashSequence,
        maxLayer: compound.maxLayer,
        provenance: compound.provenance
      };
      return {
        ...compoundRecord,
        lemma: normalizeEnglish30kWord(row.word),
        lemmaKind: "compound",
        lemmaStatus: compound.status,
        lemmaRule: "",
        lemmaEvidence: compound.provenance,
        lemmaPyashSequence: [...compound.pyashSequence]
      };
    }
    const dictionaryAlias = variants.map((variant) => dictionaryAliasLookup.get(variant)).find(Boolean);
    if (dictionaryAlias) {
      const anchor = variantsForAtomic(dictionaryAlias, atomicLookup);
      if (anchor) {
        return withLemma({
          id: makeIdentity(row),
          ...row,
          coverageType: "dictionary-alias",
          status: "covered-dictionary-alias",
          canonicalEnglish: anchor.en,
          aliasOf: dictionaryAlias,
          pyashSequence: [anchor.pya],
          hnuc: anchor.hnuc
        });
      }
    }
    const unresolved = {
      id: makeIdentity(row),
      ...row,
      coverageType: "unresolved",
      status: "unresolved"
    };
    if (!resolved) return unresolved;
    return {
      ...unresolved,
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
      ...(resolved.grammaticalNumber ? { grammaticalNumber: resolved.grammaticalNumber } : {}),
    };
  });
  const counts = Object.fromEntries(
    ["atomic", "alias", "grammar", "compound", "dictionary-alias", "lemma", "unresolved"].map((type) => [
      type,
      records.filter((record) => record.coverageType === type).length
    ])
  );
  const byVariant = new Map();
  for (const record of records) {
    for (const variant of english30kLookupVariants(record.word)) {
      if (!byVariant.has(variant)) byVariant.set(variant, record);
    }
  }
  return {
    format: ENGLISH30K_FORMAT,
    source,
    records,
    counts,
    covered: records.filter((record) => record.coverageType !== "unresolved"),
    unresolved: records.filter((record) => record.coverageType === "unresolved"),
    byVariant,
    coveragePercent: records.length ? (records.length - counts.unresolved) / records.length : 0
  };
}

export function lookupEnglish30kCoverage(recordsOrCoverage, word) {
  const variants = english30kLookupVariants(word);
  if (recordsOrCoverage?.byVariant instanceof Map) {
    return variants.map((variant) => recordsOrCoverage.byVariant.get(variant)).find(Boolean) ?? null;
  }
  return (recordsOrCoverage ?? []).find((record) => variants.includes(record.normalizedWord)
    || variants.includes(normalizeEnglish30kWord(record.word))) ?? null;
}

export function summarizeEnglish30kCoverage(coverage) {
  const uniqueCanonicalLemmas = new Set(
    coverage.records
      .map((record) => record.lemma)
      .filter((lemma) => typeof lemma === "string" && lemma)
  ).size;
  return {
    format: coverage.format,
    source: coverage.source.path,
    sourceHash: coverage.source.sourceHash,
    cutoff: coverage.source.cutoff,
    sourceRows: coverage.source.sourceRows,
    targetRows: coverage.records.length,
    missingRanks: coverage.source.missingRanks,
    ...coverage.counts,
    uniqueCanonicalLemmas,
    covered: coverage.covered.length,
    coveragePercent: Number((coverage.coveragePercent * 100).toFixed(3))
  };
}

export function renderEnglish30kCoveragePya(coverage, {
  name = "translation_english30k_coverage"
} = {}) {
  if (!coverage?.source || !Array.isArray(coverage.records)) {
    throw invalid("English30k coverage renderer requires coverage");
  }
  const lines = [
    `su name ${name} be map def`,
    `su text "format" ob text ${JSON.stringify(ENGLISH30K_FORMAT)} ya`,
    `su text "source" ob text ${JSON.stringify(coverage.source.path)} ya`,
    `su text "source-hash" ob text ${JSON.stringify(coverage.source.sourceHash)} ya`,
    `su text "cutoff" ob num ${coverage.source.cutoff} ya`,
    ...coverage.source.missingRanks.map((rank) => `su text "missing-rank:${rank}" ob num ${rank} ya`),
    ...coverage.records.map((record) => (
      `su text ${JSON.stringify(record.id)} ob text ${JSON.stringify(JSON.stringify(record))} ya`
    )),
    "prah"
  ];
  return `${lines.join("\n")}\n`;
}

export async function loadDefaultEnglish30kCoverage({
  path = ENGLISH30K_DEFAULT_PATH,
  atomicEntries = [],
  compoundRecords = null,
  grammarMappings = DEFAULT_GRAMMAR_MAPPINGS,
  lemmaEntries = null,
  dictionaryAliases = null,
  grammarCatalog = null
} = {}) {
  const source = await loadEnglish30k({ path });
  const { formsToAnchor } = await loadAnchorWordForms();
  const catalog = lemmaEntries === null ? await loadEnglishLemmaCatalog() : null;
  const resolvedLemmaEntries = lemmaEntries ?? catalog?.entries ?? [];
  const dictionary = dictionaryAliases === null ? await loadEnglishDictionaryBlacklist() : null;
  const resolvedDictionaryAliases = dictionaryAliases
    ?? buildEnglishDictionaryAliases({ dictionary, atomicEntries }).aliases;
  const grammarCatalogResolved = grammarCatalog === null ? await loadEnglishGrammarCatalog() : grammarCatalog;
  const grammarIndex = buildEnglishGrammarIndex({ catalogEntries: grammarCatalogResolved?.entries ?? [] });
  const resolvedCompoundRecords = compoundRecords ?? (await loadCuratedCompoundDecompositions()).map((entry) => ({
    target: entry.target,
    aliases: entry.aliases,
    componentGlosses: entry.componentGlosses,
    pyashSequence: entry.pyashSequence,
    status: "accepted-curated",
    provenance: "compound_coverage_curated.pya"
  }));
  const resolvedGrammarMappings = new Map(grammarMappings instanceof Map ? grammarMappings : []);
  for (const [surface, mapping] of grammarIndex.mappings) {
    resolvedGrammarMappings.set(surface, mapping);
  }
  if (catalog?.sourceHash && catalog.sourceHash !== source.sourceHash) {
    throw invalid("English lemma source hash does not match English30k source", {
      expected: source.sourceHash,
      actual: catalog.sourceHash
    });
  }
  return buildEnglish30kCoverage({
    source,
    atomicEntries,
    aliases: formsToAnchor,
    dictionaryAliases: resolvedDictionaryAliases,
    grammarMappings: resolvedGrammarMappings,
    grammarOverrides: grammarIndex.mappings,
    compoundRecords: resolvedCompoundRecords,
    lemmaEntries: resolvedLemmaEntries
  });
}

export async function buildEnglish30kCompoundCoverage({
  source,
  atomicEntries = [],
  directory,
  curatedDecompositions,
  morphologyEntries
} = {}) {
  if (!source?.rows || !Array.isArray(source.rows)) throw invalid("English30k compound coverage requires parsed source rows");
  const manifest = await loadPyacComplexityLayers();
  const layerIndex = await loadPyacWordLayerIndex({
    manifest,
    directory: directory ?? resolve(source.path ?? ENGLISH30K_DEFAULT_PATH, "..")
  });
  const englishToPyash = new Map();
  for (const entry of atomicEntries) {
    if (entry?.en && entry?.pya && !englishToPyash.has(entry.en.toLowerCase())) {
      englishToPyash.set(entry.en.toLowerCase(), entry.pya);
    }
  }
  const sourceTerms = source.rows.map((row) => ({
    target: row.word,
    sourceSurfaces: { english30k: row.word },
    sourceMorphemesByLanguage: {
      english30k: row.word.split(/[-_\s]+/u).filter(Boolean)
    },
    provenance: source.path ?? "English30k.txt",
    evidence: `rank ${row.rank}; frequency score ${row.score}`
  }));
  return buildDerivedCompoundCoverage({
    atomicEntries,
    sourceTerms,
    curatedDecompositions: curatedDecompositions ?? await loadCuratedCompoundDecompositions(),
    morphologyEntries: morphologyEntries ?? await loadCompoundMorphology(),
    layerIndex: { ...layerIndex, englishToPyash }
  });
}
