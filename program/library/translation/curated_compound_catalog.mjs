import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

import { buildProgram } from "../../program.mjs";
import { parseCompoundLexicon } from "./compound_lexicon.mjs";

export const CURATED_COMPOUND_CATALOG_NAME = "translation_compounds_derived_curated";
export const CURATED_COMPOUND_CATALOG_URL = new URL("./compound_coverage_curated.pya", import.meta.url);

function invalid(message, details = {}) {
  const error = new Error(message);
  error.code = "invalid-curated-compound-catalog";
  error.details = details;
  return error;
}

function normalized(value) {
  return typeof value === "string"
    ? value.normalize("NFC").trim().toLowerCase().replace(/\s+/gu, " ")
    : "";
}

function resolveAtom(label, atomicEntries) {
  const key = normalized(label);
  const matches = atomicEntries.filter((entry) => (
    normalized(entry?.en) === key &&
    !String(entry?.en ?? "").trim().endsWith("_") &&
    typeof entry?.pya === "string" && entry.pya.trim()
  ));
  const pyashForms = new Set(matches.map((entry) => entry.pya.trim()));
  if (pyashForms.size === 0) {
    throw invalid(`compound component is not an existing atom: ${label}`, { component: label });
  }
  if (pyashForms.size > 1) {
    throw invalid(`compound component label is ambiguous: ${label}`, { component: label });
  }
  return matches[0];
}

export function buildCuratedCompoundEntry({
  surface,
  gloss,
  components,
  atomicEntries,
  layerIndex,
  evidence,
  provenance = "user-curated compound catalog"
} = {}) {
  const target = normalized(surface);
  const definition = typeof gloss === "string" ? gloss.normalize("NFC").trim() : "";
  if (!target) throw invalid("compound requires a surface name");
  if (!definition) throw invalid("compound requires a gloss");
  if (!Array.isArray(components) || components.length < 2 || components.some((item) => !normalized(item))) {
    throw invalid("compound requires at least two ordered atom labels");
  }
  if (!Array.isArray(atomicEntries)) throw invalid("compound authoring requires the atom catalog");
  if (!(layerIndex?.byWord instanceof Map)) throw invalid("compound authoring requires the Pyac layer index");
  if (atomicEntries.some((atom) => normalized(atom?.en) === target)) {
    throw invalid(`compound name is already an atomic vocabulary item: ${target}`, { surface: target });
  }

  const atoms = components.map((component) => resolveAtom(component, atomicEntries));
  const pyashSequence = atoms.map((atom) => atom.pya.trim());
  const componentLayers = pyashSequence.map((word) => layerIndex.byWord.get(word));
  const missingLayers = pyashSequence.filter((word, index) => !Number.isInteger(componentLayers[index]));
  if (missingLayers.length > 0) {
    throw invalid(`compound atoms are missing from the Pyac complexity catalog: ${missingLayers.join(", ")}`, {
      atoms: missingLayers
    });
  }

  const componentGlosses = atoms.map((atom) => atom.en.trim());
  const orderedComponents = componentGlosses.join(" + ");
  const rowEvidence = typeof evidence === "string" && evidence.trim()
    ? evidence.trim()
    : `User-curated compound from existing atoms in head-final order: ${orderedComponents}.`;
  return {
    surface: target,
    morphemes: [...componentGlosses],
    sourceMorphemes: [...componentGlosses],
    target,
    gloss: definition,
    componentGlosses,
    componentRoles: componentGlosses.map(() => "lexeme"),
    pyashSequence,
    componentLayers,
    maxLayer: Math.max(...componentLayers),
    head: componentGlosses.at(-1),
    evidence: rowEvidence,
    provenance,
    confidence: "curated",
    status: "accepted-curated"
  };
}

function renderRow(entry) {
  return `su text ${JSON.stringify(entry.surface)} ob text ${JSON.stringify(JSON.stringify(entry))} ya`;
}

function catalogRowAtSurface(lines, surface) {
  for (const [index, line] of lines.entries()) {
    let sentence;
    try {
      sentence = buildProgram(line).sentences[0];
    } catch {
      continue;
    }
    if (sentence?.mood !== "ya" || sentence?.su?.text !== surface || typeof sentence?.ob?.text !== "string") continue;
    try {
      const payload = JSON.parse(sentence.ob.text);
      if (normalized(payload?.surface) === surface) return { index, payload };
    } catch {
      continue;
    }
  }
  return null;
}

function validateCatalogSource(source, atomicEntries) {
  const program = buildProgram(source);
  const hasHeader = program.sentences.some((sentence) => (
    sentence?.mood === "def" && sentence?.be === "map" && sentence?.su?.name === CURATED_COMPOUND_CATALOG_NAME
  ));
  if (!hasHeader) throw invalid("curated compound catalog has no canonical map header");
  const rowSentences = program.sentences.filter((sentence) => sentence?.su?.text && sentence?.ob?.text);
  if (rowSentences.length === 0) return [];
  return parseCompoundLexicon(source, {
    name: CURATED_COMPOUND_CATALOG_NAME,
    language: "canonical",
    atomicEntries
  });
}

async function atomicWrite(path, contents) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, contents, "utf8");
    await fs.rename(temporary, path);
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

export function prepareCuratedCompoundCatalogUpdate({
  source,
  atomicEntries,
  layerIndex,
  allowUpdate = true,
  ...definition
} = {}) {
  if (typeof source !== "string") throw invalid("curated compound catalog source must be text");
  const entry = buildCuratedCompoundEntry({ ...definition, atomicEntries, layerIndex });
  const currentEntries = validateCatalogSource(source, atomicEntries);
  const existingSurface = currentEntries.find((candidate) => normalized(candidate.surface) === entry.surface);
  if (existingSurface) {
    if (JSON.stringify(existingSurface.pyashSequence) !== JSON.stringify(entry.pyashSequence)) {
      throw invalid(`compound name already exists with a different atom sequence: ${entry.surface}`, {
        surface: entry.surface,
        existingPyashSequence: existingSurface.pyashSequence,
        pyashSequence: entry.pyashSequence
      });
    }
    if (existingSurface.gloss === entry.gloss
      && existingSurface.status === "accepted-curated"
      && existingSurface.evidence === entry.evidence
      && existingSurface.provenance === entry.provenance) {
      return { status: "already-present", entry: existingSurface, source };
    }
    if (!allowUpdate && existingSurface.gloss === entry.gloss) {
      return { status: "already-present", entry: existingSurface, source };
    }
    if (!allowUpdate) {
      throw invalid(`compound name already exists with a different gloss or atom sequence: ${entry.surface}`, {
        surface: entry.surface,
        existingGloss: existingSurface.gloss,
        existingPyashSequence: existingSurface.pyashSequence
      });
    }

    const lines = source.split(/\r?\n/u);
    const row = catalogRowAtSurface(lines, entry.surface);
    if (!row) throw invalid("curated compound row could not be located for update", { surface: entry.surface });
    const updatedPayload = {
      ...row.payload,
      gloss: entry.gloss,
      evidence: entry.evidence,
      provenance: entry.provenance,
      confidence: "curated",
      status: "accepted-curated"
    };
    lines[row.index] = renderRow(updatedPayload);
    const updatedSource = `${lines.join("\n").replace(/\n*$/u, "\n")}`;
    validateCatalogSource(updatedSource, atomicEntries);
    return { status: "updated", entry: { ...existingSurface, ...updatedPayload }, source: updatedSource };
  }

  const conflictingSequence = currentEntries.find((candidate) => (
    JSON.stringify(candidate.pyashSequence) === JSON.stringify(entry.pyashSequence)
  ));
  if (conflictingSequence) {
    throw invalid(`Pyac compound sequence is already assigned to ${conflictingSequence.surface}`, {
      surface: entry.surface,
      existingSurface: conflictingSequence.surface,
      pyashSequence: entry.pyashSequence
    });
  }

  const lines = source.split(/\r?\n/u);
  const prahIndex = [...lines].map((line, index) => [line, index])
    .reverse()
    .find(([line]) => line.trim() === "prah")?.[1];
  if (prahIndex === undefined) throw invalid("curated compound catalog has no trailing prah");
  lines.splice(prahIndex, 0, renderRow(entry));
  const updatedSource = `${lines.join("\n").replace(/\n*$/u, "\n")}`;
  validateCatalogSource(updatedSource, atomicEntries);
  return { status: "added", entry, source: updatedSource };
}

export async function addCuratedCompoundCatalogEntry({
  catalogUrl = CURATED_COMPOUND_CATALOG_URL,
  atomicEntries,
  layerIndex,
  ...definition
} = {}) {
  const sourcePath = catalogUrl instanceof URL ? fileURLToPath(catalogUrl) : String(catalogUrl);
  const source = await fs.readFile(sourcePath, "utf8");
  const prepared = prepareCuratedCompoundCatalogUpdate({
    source,
    atomicEntries,
    layerIndex,
    ...definition,
    allowUpdate: false
  });
  if (prepared.source !== source) await atomicWrite(sourcePath, prepared.source);
  return { status: prepared.status, entry: prepared.entry };
}
