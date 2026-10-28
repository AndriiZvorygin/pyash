import { readFileSync } from "node:fs";

import pyashWords from "../pyashWords.json" with { type: "json" };
import { parseCompoundLexicon } from "../../verbs/exchange/translation/compound_lexicon.mjs";

const CURATED_COMPOUND_URL = new URL(
  "../../verbs/exchange/translation/compound_coverage_curated.pya",
  import.meta.url
);
const CURATED_COMPOUND_NAME = "translation_compounds_derived_curated";

function loadCuratedCompounds() {
  return parseCompoundLexicon(readFileSync(CURATED_COMPOUND_URL, "utf8"), {
    name: CURATED_COMPOUND_NAME,
    language: "canonical",
    atomicEntries: pyashWords
  }).filter((entry) => (
    Array.isArray(entry?.pyashSequence) && entry.pyashSequence.length > 1
  ));
}

export const VLIW_COMPOUND_ENTRIES = Object.freeze(loadCuratedCompounds().sort((left, right) => (
  right.pyashSequence.length - left.pyashSequence.length
  || String(left.target ?? left.surface).localeCompare(String(right.target ?? right.surface))
)));

function pyaOf(value) {
  return typeof value === "string" ? value : value?.pya ?? "";
}

export function matchVliwCompound(values, index, entries = VLIW_COMPOUND_ENTRIES) {
  for (const entry of entries) {
    const sequence = entry.pyashSequence;
    if (!Array.isArray(sequence) || sequence.length === 0) continue;
    const candidate = values.slice(index, index + sequence.length);
    if (candidate.length !== sequence.length) continue;
    if (!candidate.every((value, offset) => pyaOf(value) === sequence[offset])) continue;
    return {
      entry,
      length: sequence.length,
      pyashSequence: [...sequence],
      english: entry.gloss ?? entry.target ?? entry.surface ?? sequence.join("")
    };
  }
  return null;
}

export function matchVliwCompoundSurface(value, entries = VLIW_COMPOUND_ENTRIES) {
  const text = String(value ?? "");
  for (const entry of entries) {
    const sequence = entry.pyashSequence;
    const surface = sequence.join("");
    if (!text.startsWith(surface)) continue;
    return {
      entry,
      length: surface.length,
      pyashSequence: [...sequence],
      remainder: text.slice(surface.length),
      english: entry.gloss ?? entry.target ?? entry.surface ?? surface
    };
  }
  return null;
}

export function collapseVliwCompounds(parts, entries = VLIW_COMPOUND_ENTRIES) {
  const collapsed = [];
  for (let index = 0; index < parts.length; index += 1) {
    const match = matchVliwCompound(parts, index, entries);
    if (!match) {
      collapsed.push(parts[index]);
      continue;
    }
    collapsed.push({
      pya: match.pyashSequence.join(" "),
      kind: "root",
      english: match.english
    });
    index += match.length - 1;
  }
  return collapsed;
}
