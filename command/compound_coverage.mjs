import fs from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import pyashWords from "../program/library/pyashWords.json" with { type: "json" };
import {
  buildDerivedCompoundCoverage,
  appendNovelCompoundSourceTerms,
  loadCuratedCompoundDecompositions,
  renderDerivedCompoundCoveragePya,
  sourceTermsFromDictionaryRows,
  sourceTermsFromEnglish30kRows,
  sourceTermsFromWordNetIndex
} from "../program/library/translation/compound_coverage.mjs";
import { loadEnglish30k } from "../program/library/translation/english30k_coverage.mjs";
import { loadCompoundMorphology } from "../program/library/translation/compound_morphology.mjs";
import { classifyCompoundCoverage } from "../program/library/translation/compound_verification.mjs";
import {
  loadPyacComplexityLayers,
  loadPyacWordLayerIndex
} from "../program/library/translation/pyac_complexity.mjs";

const commandDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(commandDirectory, "..");
const languageSources = [
  ["chinese", "zh"],
  ["french", "fr"],
  ["russian", "ru"],
  ["hindi", "hi"],
  ["interlingua", "ia"]
];

export async function loadCoverage({ maximumCompoundComponents = 3, wordnetIndex = null } = {}) {
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
  const english30k = await loadEnglish30k();
  const curatedDecompositions = await loadCuratedCompoundDecompositions();
  sourceTerms.push(...appendNovelCompoundSourceTerms(
    sourceTerms,
    curatedDecompositions,
    sourceTermsFromEnglish30kRows(english30k.rows)
  ));
  if (wordnetIndex) {
    sourceTerms.push(...appendNovelCompoundSourceTerms(
      sourceTerms,
      curatedDecompositions,
      sourceTermsFromWordNetIndex(wordnetIndex)
    ));
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
    curatedDecompositions,
    morphologyEntries: await loadCompoundMorphology(),
    maximumCompoundComponents,
    layerIndex: { ...layerIndex, englishToPyash }
  });
}

export async function runCompoundCoverage(args = process.argv.slice(2)) {
  const mode = args[0] ?? "summary";
  const { loadDefaultEnglishSentenceResources } = await import("../program/library/translation/english_sentence.mjs");
  const resources = await loadDefaultEnglishSentenceResources();
  const coverage = await loadCoverage({ wordnetIndex: resources.wordnet.index });
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
