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
import { classifyCompoundCoverage } from "../program/verbs/exchange/translation/compound_verification.mjs";
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

export async function loadCoverage() {
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

export async function runCompoundCoverage(args = process.argv.slice(2)) {
  const mode = args[0] ?? "summary";
  const coverage = await loadCoverage();
  if (mode === "pya") {
    return renderDerivedCompoundCoveragePya(coverage.records);
  }
  if (mode === "uncertain") {
    const classified = classifyCompoundCoverage(coverage.records);
    return renderDerivedCompoundCoveragePya(classified.verificationCandidates);
  }
  if (mode === "summary") {
    const classified = classifyCompoundCoverage(coverage.records);
    return `${JSON.stringify({
      atomicTargets: coverage.existingAtomic.length,
      derivedRecords: coverage.records.length,
      accepted: coverage.accepted.length,
      candidates: coverage.candidates.length,
      deterministic: classified.deterministic.filter((record) => record.verificationStatus === "accepted-deterministic").length,
      llmCandidates: classified.verificationCandidates.length,
      rejected: coverage.rejected.length
    }, null, 2)}\n`;
  }
  throw new Error(`unknown compound coverage mode: ${mode}`);
}

if (import.meta.url === new URL(process.argv[1], "file://").href) {
  runCompoundCoverage().then((output) => {
    process.stdout.write(output);
  }).catch((error) => {
    console.error(error?.message || String(error));
    process.exitCode = 1;
  });
}
