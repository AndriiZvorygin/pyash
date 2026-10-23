import { createHash } from "node:crypto";

import { loadCompoundLexicon } from "./compound_lexicon.mjs";
import { choosePyacCompoundCandidate } from "./pyac_complexity.mjs";

export const DERIVED_COMPOUND_LEXICON_NAME = "translation_compounds_derived";
export const DERIVED_COMPOUND_CURATED_NAME = "translation_compounds_derived_curated";
export const DERIVED_COMPOUND_STATUSES = Object.freeze([
  "accepted-delimited",
  "accepted-curated",
  "candidate-closed"
]);

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

function invalid(message, details = {}) {
  const error = new Error(message);
  error.code = "invalid-compound-coverage";
  error.details = details;
  return error;
}

function normalizeTerm(value) {
  return typeof value === "string" ? value.normalize("NFC").trim().toLowerCase() : "";
}

function normalizeSourceSurfaces(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, surface]) => typeof surface === "string" && surface.trim())
      .map(([language, surface]) => [language, surface.normalize("NFC").trim()])
      .sort(([left], [right]) => left.localeCompare(right))
  );
}

function normalizeSourceMorphemesByLanguage(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, parts]) => Array.isArray(parts) && parts.length > 0)
      .map(([language, parts]) => [
        language,
        parts.map((part) => String(part).normalize("NFC").trim()).filter(Boolean)
      ])
      .filter(([, parts]) => parts.length > 0)
      .sort(([left], [right]) => left.localeCompare(right))
  );
}

function atomicMap(entries) {
  if (!Array.isArray(entries)) throw invalid("atomic vocabulary must be an array");
  const result = new Map();
  for (const [index, entry] of entries.entries()) {
    const english = normalizeTerm(entry?.en);
    const pyash = typeof entry?.pya === "string" ? entry.pya.trim() : "";
    if (!english) continue;
    if (!pyash) throw invalid("atomic vocabulary rows require en and pya", { index });
    if (!result.has(english)) result.set(english, pyash);
  }
  return result;
}

export function sourceTermsFromDictionaryRows({ language, surfaceField = language, rows, provenance } = {}) {
  if (typeof language !== "string" || !language) throw invalid("dictionary source requires a language");
  if (typeof surfaceField !== "string" || !surfaceField) throw invalid("dictionary source requires a surface field", { language });
  if (!Array.isArray(rows)) throw invalid("dictionary source rows must be an array", { language });
  return rows
    .map((row) => {
      const surface = typeof row?.[surfaceField] === "string" ? row[surfaceField].normalize("NFC").trim() : "";
      return {
        target: row?.en,
        sourceSurfaces: { [language]: surface },
        sourceMorphemesByLanguage: { [language]: surface.split(/[-_\s]+/u).filter(Boolean) },
        provenance
      };
    })
    .filter((row) => normalizeTerm(row.target) && typeof row.sourceSurfaces[language] === "string" && row.sourceSurfaces[language].trim());
}

export async function loadCuratedCompoundDecompositions({
  url = new URL("./compound_coverage_curated.pya", import.meta.url)
} = {}) {
  const entries = await loadCompoundLexicon({
    url,
    name: DERIVED_COMPOUND_CURATED_NAME,
    language: "canonical"
  });
  return entries.map((entry) => ({
    target: entry.target,
    sourceMorphemes: entry.sourceMorphemes ?? entry.morphemes,
    componentGlosses: entry.componentGlosses ?? entry.morphemes,
    evidence: entry.evidence,
    confidence: entry.confidence
  }));
}

export function segmentDelimitedCompound(term, atoms) {
  const value = normalizeTerm(term);
  if (!/[-_ ]/u.test(value)) return [];
  const parts = value.split(/[-_ ]+/u).filter(Boolean);
  if (parts.length < 2 || parts.some((part) => !atoms.has(part))) return [];
  return [parts];
}

export function segmentClosedCompound(term, atoms, { minimumPartLength = 3, maximumParts = 4 } = {}) {
  const value = normalizeTerm(term);
  if (!/^[a-z0-9]+$/u.test(value)) return [];
  const memo = new Map();
  function segmentFrom(offset) {
    if (offset === value.length) return [[]];
    if (memo.has(offset)) return memo.get(offset);
    const results = [];
    for (let end = offset + minimumPartLength; end <= value.length; end += 1) {
      const part = value.slice(offset, end);
      if (!atoms.has(part)) continue;
      for (const suffix of segmentFrom(end)) {
        const candidate = [part, ...suffix];
        if (candidate.length <= maximumParts) results.push(candidate);
      }
    }
    memo.set(offset, results);
    return results;
  }
  return segmentFrom(0).filter((parts) => parts.length >= 2);
}

function mergeSourceTerms(sourceTerms) {
  if (!Array.isArray(sourceTerms)) throw invalid("compound source terms must be an array");
  const merged = new Map();
  for (const [index, source] of sourceTerms.entries()) {
    const target = normalizeTerm(typeof source === "string" ? source : source?.target);
    if (!target) throw invalid("compound source term requires a target", { index });
    const current = merged.get(target) ?? {
      target,
      sourceSurfaces: {},
      sourceMorphemesByLanguage: {},
      provenance: new Set(),
      evidence: new Set()
    };
    Object.assign(current.sourceSurfaces, normalizeSourceSurfaces(source?.sourceSurfaces));
    Object.assign(current.sourceMorphemesByLanguage, normalizeSourceMorphemesByLanguage(source?.sourceMorphemesByLanguage));
    const provenance = typeof source?.provenance === "string" ? source.provenance : "";
    if (provenance) current.provenance.add(provenance);
    const evidence = typeof source?.evidence === "string" ? source.evidence : "";
    if (evidence) current.evidence.add(evidence);
    merged.set(target, current);
  }
  return merged;
}

function curatedMap(curatedDecompositions) {
  if (!Array.isArray(curatedDecompositions)) {
    throw invalid("curated compound decompositions must be an array");
  }
  const result = new Map();
  for (const [index, decomposition] of curatedDecompositions.entries()) {
    const target = normalizeTerm(decomposition?.target);
    const componentGlosses = Array.isArray(decomposition?.componentGlosses)
      ? decomposition.componentGlosses.map(normalizeTerm).filter(Boolean)
      : [];
    if (!target || componentGlosses.length < 2) {
      throw invalid("curated compound requires a target and two components", { index });
    }
    if (result.has(target)) throw invalid("curated compound target is duplicated", { index, target });
    result.set(target, {
      target,
      componentGlosses,
      sourceMorphemes: Array.isArray(decomposition.sourceMorphemes)
        ? decomposition.sourceMorphemes.map((part) => String(part).normalize("NFC").trim()).filter(Boolean)
        : [...componentGlosses],
      evidence: typeof decomposition.evidence === "string" ? decomposition.evidence : "curated semantic decomposition",
      confidence: typeof decomposition.confidence === "string" ? decomposition.confidence : "curated"
    });
  }
  return result;
}

function recordId(record) {
  return `derived-compound-${createHash("sha256").update(stableJson({
    target: record.target,
    sourceMorphemes: record.sourceMorphemes,
    componentGlosses: record.componentGlosses,
    pyashSequence: record.pyashSequence,
    sourceSurfaces: record.sourceSurfaces,
    sourceMorphemesByLanguage: record.sourceMorphemesByLanguage
  })).digest("hex").slice(0, 24)}`;
}

function makeRecord({
  target,
  sourceMorphemes,
  componentGlosses,
  sourceSurfaces,
  sourceMorphemesByLanguage,
  status,
  confidence,
  evidence,
  provenance,
  layerIndex
}) {
  const pyashWords = componentGlosses.map((gloss) => layerIndex?.englishToPyash?.get(gloss) ?? null);
  const selected = pyashWords.every(Boolean)
    ? choosePyacCompoundCandidate([{ pyashSequence: pyashWords }], layerIndex)
    : null;
  if (!selected) return null;
  const record = {
    language: "canonical",
    surface: target,
    target,
    sourceMorphemes: [...sourceMorphemes],
    morphemes: [...sourceMorphemes],
    componentGlosses: [...componentGlosses],
    pyashSequence: [...selected.pyashSequence],
    componentLayers: [...selected.componentLayers],
    maxLayer: selected.maxLayer,
    head: componentGlosses.at(-1),
    modifiers: componentGlosses.slice(0, -1),
    sourceSurfaces: normalizeSourceSurfaces(sourceSurfaces),
    sourceMorphemesByLanguage: normalizeSourceMorphemesByLanguage(sourceMorphemesByLanguage),
    confidence,
    status,
    ...(evidence ? { evidence } : {}),
    ...(provenance ? { provenance } : { provenance: "derived-compound-coverage" })
  };
  return { ...record, id: recordId(record) };
}

export function buildDerivedCompoundCoverage({
  atomicEntries,
  sourceTerms = [],
  curatedDecompositions = [],
  layerIndex
} = {}) {
  if (!layerIndex?.englishToPyash || !layerIndex?.byWord) {
    throw invalid("compound coverage requires English and Pyash layer indexes");
  }
  const atoms = atomicMap(atomicEntries);
  const sources = mergeSourceTerms(sourceTerms);
  const curated = curatedMap(curatedDecompositions);
  const targets = new Set([...sources.keys(), ...curated.keys()]);
  const records = [];
  const existingAtomic = [];
  const rejected = [];

  for (const target of [...targets].sort()) {
    if (atoms.has(target)) {
      existingAtomic.push({ target, pyashWord: atoms.get(target), status: "existing-atomic" });
      continue;
    }
    const source = sources.get(target) ?? {
      target,
      sourceSurfaces: {},
      sourceMorphemesByLanguage: {},
      provenance: new Set(),
      evidence: new Set()
    };
    const curatedEntry = curated.get(target);
    if (curatedEntry) {
      const record = makeRecord({
        target,
        sourceMorphemes: curatedEntry.sourceMorphemes,
        componentGlosses: curatedEntry.componentGlosses,
        sourceSurfaces: source.sourceSurfaces,
        sourceMorphemesByLanguage: source.sourceMorphemesByLanguage,
        status: "accepted-curated",
        confidence: curatedEntry.confidence,
        evidence: curatedEntry.evidence,
        provenance: [...source.provenance].sort().join("; ") || "compound-coverage-curated.pya",
        layerIndex
      });
      if (record) records.push(record);
      else rejected.push({ target, status: "rejected-missing-component", evidence: curatedEntry.evidence });
      continue;
    }

    const delimited = segmentDelimitedCompound(target, atoms);
    if (delimited.length) {
      const parts = delimited[0];
      const record = makeRecord({
        target,
        sourceMorphemes: parts,
        componentGlosses: parts,
        sourceSurfaces: source.sourceSurfaces,
        sourceMorphemesByLanguage: source.sourceMorphemesByLanguage,
        status: "accepted-delimited",
        confidence: "derived-boundary",
        evidence: "exact source delimiter and existing atomic components",
        provenance: [...source.provenance].sort().join("; ") || "derived-compound-coverage",
        layerIndex
      });
      if (record) records.push(record);
      else rejected.push({ target, status: "rejected-missing-component" });
      continue;
    }

    const closed = segmentClosedCompound(target, atoms);
    if (!closed.length) continue;
    for (const parts of closed) {
      const record = makeRecord({
        target,
        sourceMorphemes: parts,
        componentGlosses: parts,
        sourceSurfaces: source.sourceSurfaces,
        sourceMorphemesByLanguage: source.sourceMorphemesByLanguage,
        status: "candidate-closed",
        confidence: "orthographic-candidate",
        evidence: "closed-word segmentation requires semantic review",
        provenance: [...source.provenance].sort().join("; ") || "derived-compound-coverage",
        layerIndex
      });
      if (record) records.push(record);
    }
  }

  records.sort((left, right) => left.target.localeCompare(right.target) || left.id.localeCompare(right.id));
  return {
    records,
    accepted: records.filter((record) => DERIVED_COMPOUND_STATUSES.slice(0, 2).includes(record.status)),
    candidates: records.filter((record) => record.status === "candidate-closed"),
    existingAtomic,
    rejected
  };
}

export function resolveDerivedCompound(records, { language, surface, target } = {}) {
  if (!Array.isArray(records)) throw invalid("compound resolver requires records");
  const normalizedSurface = normalizeTerm(surface);
  const normalizedTarget = normalizeTerm(target);
  const matches = records.filter((record) => {
    if (!DERIVED_COMPOUND_STATUSES.slice(0, 2).includes(record.status)) return false;
    if (normalizedTarget && record.target !== normalizedTarget) return false;
    if (normalizedSurface) {
      const sourceSurface = language ? record.sourceSurfaces?.[language] : undefined;
      if (normalizeTerm(sourceSurface) !== normalizedSurface && record.target !== normalizedSurface) return false;
    }
    return true;
  });
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) return { status: "ambiguous", candidates: matches };
  return null;
}

export function renderDerivedCompoundCoveragePya(
  records,
  { name = DERIVED_COMPOUND_LEXICON_NAME } = {}
) {
  if (!Array.isArray(records)) throw invalid("compound renderer requires records");
  if (typeof name !== "string" || !name) throw invalid("compound renderer requires a map name");
  const rows = records
    .slice()
    .sort((left, right) => left.target.localeCompare(right.target) || left.id.localeCompare(right.id))
    .map((entry) => {
      const payload = {
        surface: entry.target,
        morphemes: entry.sourceMorphemes,
        sourceMorphemes: entry.sourceMorphemes,
        target: entry.target,
        gloss: entry.target,
        componentGlosses: entry.componentGlosses,
        pyashSequence: entry.pyashSequence,
        componentLayers: entry.componentLayers,
        maxLayer: entry.maxLayer,
        head: entry.head,
        sourceSurfaces: entry.sourceSurfaces,
        sourceMorphemesByLanguage: entry.sourceMorphemesByLanguage,
        evidence: entry.evidence,
        provenance: entry.provenance,
        confidence: entry.confidence,
        status: entry.status
      };
      return `su text ${JSON.stringify(entry.target)} ob text ${JSON.stringify(JSON.stringify(payload))} ya`;
    });
  return [`su name ${name} be map def`, ...rows, "prah", ""].join("\n");
}
