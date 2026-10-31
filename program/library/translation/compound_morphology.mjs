import fs from "node:fs/promises";

import { buildProgram } from "../../program.mjs";

export const COMPOUND_MORPHOLOGY_NAME = "translation_compound_morphology";
export const COMPOUND_MORPHOLOGY_KINDS = Object.freeze([
  "derivational-ending",
  "grammatical-ending"
]);

function invalid(message, details = {}) {
  const error = new Error(message);
  error.code = "invalid-compound-morphology";
  error.details = details;
  return error;
}

function normalizeSurface(value) {
  return typeof value === "string" ? value.normalize("NFC").trim().toLowerCase() : "";
}

function normalizeEntry(payload, surface, index) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw invalid("compound morphology row payload must be an object", { index });
  }
  const normalizedSurface = normalizeSurface(payload.surface ?? surface);
  if (!normalizedSurface || normalizedSurface !== normalizeSurface(surface)) {
    throw invalid("compound morphology row surface must match its Pyash key", { index, surface });
  }
  if (!COMPOUND_MORPHOLOGY_KINDS.includes(payload.kind)) {
    throw invalid("compound morphology row kind is unsupported", { index, surface });
  }
  if (typeof payload.evidence !== "string" || !payload.evidence.trim()) {
    throw invalid("compound morphology row requires evidence", { index, surface });
  }
  return {
    surface: normalizedSurface,
    kind: payload.kind,
    evidence: payload.evidence.trim()
  };
}

export function parseCompoundMorphology(source, {
  name = COMPOUND_MORPHOLOGY_NAME
} = {}) {
  if (typeof source !== "string") throw invalid("compound morphology source must be text");
  const sentences = buildProgram(source).sentences;
  const header = sentences.find((sentence) => (
    sentence?.mood === "def" &&
    sentence?.be === "map" &&
    sentence?.su?.name === name
  ));
  if (!header) throw invalid("compound morphology has no canonical map header");
  const entries = [];
  const seen = new Set();
  for (const [index, sentence] of sentences.entries()) {
    if (sentence?.mood !== "ya" || typeof sentence.su?.text !== "string") continue;
    if (typeof sentence.ob?.text !== "string") {
      throw invalid("compound morphology row requires a JSON text payload", { index });
    }
    let payload;
    try {
      payload = JSON.parse(sentence.ob.text);
    } catch (error) {
      throw invalid("compound morphology row JSON payload is malformed", { index, cause: error.message });
    }
    const entry = normalizeEntry(payload, sentence.su.text, index);
    const identity = `${entry.surface}\u0000${entry.kind}`;
    if (seen.has(identity)) throw invalid("compound morphology row is duplicated", { index, surface: entry.surface });
    seen.add(identity);
    entries.push(entry);
  }
  if (!entries.length) throw invalid("compound morphology has no rows");
  return entries;
}

export async function loadCompoundMorphology({
  url = new URL("./compound_morphology.pya", import.meta.url),
  name = COMPOUND_MORPHOLOGY_NAME
} = {}) {
  if (!(url instanceof URL) && typeof url !== "string") {
    throw invalid("compound morphology requires a source URL");
  }
  return parseCompoundMorphology(await fs.readFile(url, "utf8"), { name });
}

function addIndexEntry(index, entry) {
  const rows = index.get(entry.surface) ?? [];
  if (!rows.some((row) => row.kind === entry.kind && row.evidence === entry.evidence)) rows.push(entry);
  index.set(entry.surface, rows);
}

export function buildCompoundMorphologyIndex({
  atomicEntries = [],
  morphologyEntries = []
} = {}) {
  if (!Array.isArray(atomicEntries)) throw invalid("compound morphology vocabulary must be an array");
  if (!Array.isArray(morphologyEntries)) throw invalid("compound morphology entries must be an array");
  const index = new Map();
  for (const [indexNumber, entry] of morphologyEntries.entries()) {
    addIndexEntry(index, normalizeEntry(entry, entry?.surface, indexNumber));
  }
  for (const [indexNumber, entry] of atomicEntries.entries()) {
    const raw = normalizeSurface(entry?.en);
    if (!raw.startsWith("_") || raw.length < 2) continue;
    addIndexEntry(index, {
      surface: raw.slice(1),
      kind: "derivational-ending",
      evidence: `explicit Pyash affix marker in vocabulary row ${indexNumber}`
    });
  }
  return new Map([...index.entries()].map(([surface, rows]) => [
    surface,
    rows.slice().sort((left, right) => right.surface.length - left.surface.length || left.kind.localeCompare(right.kind))
  ]));
}

export function analyzeCompoundMorphology({
  target,
  componentGlosses,
  morphologyIndex = new Map(),
  atomicEntries = []
} = {}) {
  const normalizedTarget = normalizeSurface(target);
  const components = Array.isArray(componentGlosses) ? componentGlosses.map(normalizeSurface) : [];
  const atomic = new Set(atomicEntries
    .map((entry) => normalizeSurface(entry?.en))
    .filter(Boolean));
  const componentRoles = components.map((component) => {
    const markers = morphologyIndex.get(component) ?? [];
    if (!markers.length) return "lexeme";
    return atomic.has(component) ? "lexeme-or-ending" : markers[0].kind;
  });
  const finalComponent = components.at(-1) ?? "";
  const morphologySignals = [];
  for (const [ending, markers] of morphologyIndex.entries()) {
    if (!ending || normalizedTarget.length <= ending.length || !normalizedTarget.endsWith(ending)) continue;
    if (finalComponent !== ending && !finalComponent.endsWith(ending)) continue;
    const boundary = finalComponent === ending ? "component" : "inside-component";
    for (const marker of markers) {
      morphologySignals.push({
        ending,
        kind: marker.kind,
        component: finalComponent,
        boundary,
        evidence: marker.evidence
      });
    }
  }
  morphologySignals.sort((left, right) => (
    right.ending.length - left.ending.length ||
    left.kind.localeCompare(right.kind) ||
    left.evidence.localeCompare(right.evidence)
  ));
  return {
    componentRoles,
    morphologyStatus: morphologySignals.length ? "ending-overlap-review" : "lexical-compound",
    morphologySignals
  };
}
