#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";

import pyashWords from "../program/library/pyashWords.json" with { type: "json" };
import {
  filterDeprecatedEnglishAtoms,
  loadEnglishLemmaCatalog
} from "../program/library/translation/english_lemmas.mjs";
import {
  loadPyacComplexityLayers,
  loadPyacWordLayerIndex
} from "../program/library/translation/pyac_complexity.mjs";
import {
  addCuratedCompoundCatalogEntry,
  CURATED_COMPOUND_CATALOG_URL
} from "../program/library/translation/curated_compound_catalog.mjs";

const [surface, gloss, ...components] = process.argv.slice(2);
if (!surface || !gloss || components.length < 2) {
  console.error("Usage: node command/compound_catalog_add.mjs <name> <gloss> <atom> <atom> [atom ...]");
  console.error("Give atom labels in Pyash head-final order; the final atom is the compound head.");
  process.exit(1);
}

const commandDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(commandDirectory, "..");
const lemmaCatalog = await loadEnglishLemmaCatalog();
const atomicEntries = filterDeprecatedEnglishAtoms(pyashWords, lemmaCatalog.entries);
const manifest = await loadPyacComplexityLayers();
const layerIndex = await loadPyacWordLayerIndex({
  manifest,
  directory: path.resolve(repositoryRoot, "..", "pyachso2n")
});
const result = await addCuratedCompoundCatalogEntry({
  catalogUrl: CURATED_COMPOUND_CATALOG_URL,
  surface,
  gloss,
  components,
  atomicEntries,
  layerIndex
});

console.log(`${result.status}: ${result.entry.surface}`);
console.log(`  atoms: ${result.entry.pyashSequence.join(" ")} (${result.entry.componentGlosses.join(" + ")})`);
console.log(`  gloss: ${result.entry.gloss}`);
console.log(`  head: ${result.entry.head}`);
