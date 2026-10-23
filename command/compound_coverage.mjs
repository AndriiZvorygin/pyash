import fs from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import pyashWords from "../program/library/pyashWords.json" with { type: "json" };
import {
  buildDerivedCompoundCoverage,
  loadCuratedCompoundDecompositions,
  renderDerivedCompoundCoveragePya,
  sourceTermsFromDictionaryRows
} from "../program/verbs/exchange/translation/compound_coverage.mjs";
import {
  loadPyacComplexityLayers,
  loadPyacWordLayerIndex
} from "../program/verbs/exchange/translation/pyac_complexity.mjs";

const commandDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(commandDirectory, "..");
const languageSources = [
  ["chinese", "zh"],
  ["french", "fr"],
  ["russian", "ru"],
  ["hindi", "hi"],
  ["interlingua", "ia"]
];

async function loadCoverage() {
  const sourceTerms = [];
  for (const [language, field] of languageSources) {
    const filename = `dictionary_${field}.json`;
    const rows = JSON.parse(await fs.readFile(resolve(repositoryRoot, "caterer/pyac/lyac", filename), "utf8"));
    sourceTerms.push(...sourceTermsFromDictionaryRows({
      language,
      surfaceField: field,
      rows,
      provenance: `caterer/pyac/lyac/${filename}`
    }));
  }
  const manifest = await loadPyacComplexityLayers();
  const layerIndex = await loadPyacWordLayerIndex({
    manifest,
    directory: resolve(repositoryRoot, "..", "pyachso2n")
  });
  const englishToPyash = new Map();
  for (const entry of pyashWords) {
    if (entry?.en && entry?.pya && !englishToPyash.has(entry.en.toLowerCase())) {
      englishToPyash.set(entry.en.toLowerCase(), entry.pya);
    }
  }
  return buildDerivedCompoundCoverage({
    atomicEntries: pyashWords,
    sourceTerms,
    curatedDecompositions: await loadCuratedCompoundDecompositions(),
    layerIndex: { ...layerIndex, englishToPyash }
  });
}

const mode = process.argv[2] ?? "summary";
const coverage = await loadCoverage();
if (mode === "pya") {
  process.stdout.write(renderDerivedCompoundCoveragePya(coverage.records));
} else if (mode === "summary") {
  process.stdout.write(`${JSON.stringify({
    atomicTargets: coverage.existingAtomic.length,
    derivedRecords: coverage.records.length,
    accepted: coverage.accepted.length,
    candidates: coverage.candidates.length,
    rejected: coverage.rejected.length
  }, null, 2)}\n`);
} else {
  throw new Error(`unknown compound coverage mode: ${mode}`);
}
