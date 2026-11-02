import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import pyashWords from "../program/library/pyashWords.json" with { type: "json" };
import {
  buildEnglishLemmaIndex,
  loadEnglishLemmaCatalog,
  renderEnglishLemmaCatalogPya
} from "../program/library/translation/english_lemmas.mjs";
import { loadEnglishGrammarCatalog } from "../program/library/translation/english_grammar.mjs";
import { loadPyacWordLayerIndex } from "../program/library/translation/pyac_complexity.mjs";
import {
  buildEnglishAtomLemmaAssignments,
  buildEnglishAtomLemmaCatalogAdditions,
  loadEnglishAtomLemmaScanConfig,
  renderEnglishAtomLemmaAssignmentsPya
} from "../program/library/translation/english_atom_lemma_scan.mjs";
import { ENGLISH30K_DEFAULT_PATH } from "../program/library/translation/english30k_coverage.mjs";
import {
  prepareWordNetFrequencyAllocation,
  runWordNetFrequencyAllocation
} from "./wordnet_frequency_allocate.mjs";

const LEMMA_CATALOG_URL = new URL("../program/library/translation/english_lemmas.pya", import.meta.url);
const ASSIGNMENTS_URL = new URL("../program/library/translation/english_atom_lemma_assignments.pya", import.meta.url);
const COMPLEXITY_DIRECTORY = dirname(ENGLISH30K_DEFAULT_PATH);

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function atomicWrite(filename, contents) {
  const path = fileURLToPath(filename);
  await fs.mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await fs.rm(temporary, { force: true });
  await fs.writeFile(temporary, contents, "utf8");
  await fs.rename(temporary, path);
}

function countAssignments(rows) {
  return rows.flatMap((row) => row.assignments).reduce((counts, assignment) => {
    counts[assignment.kind] = (counts[assignment.kind] ?? 0) + 1;
    if (assignment.method === "surface-lemma") counts.selfLemmas = (counts.selfLemmas ?? 0) + 1;
    if (assignment.method === "ambiguous-self-lemma") counts.ambiguousSelfLemmas = (counts.ambiguousSelfLemmas ?? 0) + 1;
    if (assignment.method === "wordnet-regular-inflection") counts.regularLemmaLinks = (counts.regularLemmaLinks ?? 0) + 1;
    return counts;
  }, {});
}

export async function prepareEnglishAtomLemmaScan() {
  await loadEnglishAtomLemmaScanConfig();
  const [prepared, catalog, grammar, layerIndex] = await Promise.all([
    prepareWordNetFrequencyAllocation(),
    loadEnglishLemmaCatalog(),
    loadEnglishGrammarCatalog(),
    loadPyacWordLayerIndex({ directory: COMPLEXITY_DIRECTORY })
  ]);
  const targetRows = prepared.atomCoverage.filter((row) => row.status === "no-direct-wordnet-candidate");
  if (targetRows.length === 0) throw new Error("atom lemma scan found no unlinked atom identities");

  const assignments = buildEnglishAtomLemmaAssignments({
    atomCoverage: targetRows,
    atomicEntries: pyashWords,
    lemmaEntries: catalog.entries,
    grammarEntries: grammar.entries,
    wordnetIndex: prepared.wordnetIndex,
    rankForEnglish: prepared.rankForEnglish,
    layerByWord: layerIndex.byWord
  });
  if (assignments.length !== targetRows.length
    || assignments.some((row) => row.assignments.length !== row.labels.length
      || row.assignments.some((assignment) => !["lemma", "grammar-word", "duplicate"].includes(assignment.kind)))) {
    throw new Error("atom lemma scan failed to classify every source label");
  }

  const additions = buildEnglishAtomLemmaCatalogAdditions(assignments, catalog.entries, pyashWords, grammar.entries);
  const updatedCatalog = { ...catalog, entries: [...catalog.entries, ...additions] };
  buildEnglishLemmaIndex({ atomicEntries: pyashWords, catalogEntries: updatedCatalog.entries });
  if (!catalog.source || !catalog.sourceHash || !Number.isSafeInteger(catalog.cutoff)) {
    throw new Error("atom lemma scan requires complete English30k lemma catalog provenance");
  }
  const newLemmaCatalog = renderEnglishLemmaCatalogPya({
    source: {
      path: catalog.source,
      sourceHash: catalog.sourceHash,
      cutoff: catalog.cutoff,
      duplicatePolicy: catalog.duplicatePolicy
    },
    entries: updatedCatalog.entries
  });
  const assignmentSource = `${prepared.runId}\u0000${prepared.sourceHash}\u0000${prepared.coverageHash}\u0000${JSON.stringify(assignments)}`;
  const scanHash = hash(assignmentSource);
  const runId = `english-atom-lemma-scan-${scanHash.slice(0, 24)}`;
  const report = renderEnglishAtomLemmaAssignmentsPya(assignments, {
    runId,
    sourceHash: scanHash
  });
  return {
    prepared,
    assignments,
    additions,
    updatedCatalog,
    newLemmaCatalog,
    report,
    runId,
    scanHash,
    targetRows
  };
}

export async function runEnglishAtomLemmaScan() {
  const plan = await prepareEnglishAtomLemmaScan();
  const { assignments, additions, newLemmaCatalog, report, runId } = plan;
  const originalLemmaCatalog = await fs.readFile(LEMMA_CATALOG_URL, "utf8");
  await atomicWrite(LEMMA_CATALOG_URL, newLemmaCatalog);
  let allocation;
  try {
    allocation = await runWordNetFrequencyAllocation({ apply: true });
  } catch (error) {
    await atomicWrite(LEMMA_CATALOG_URL, originalLemmaCatalog);
    throw error;
  }
  await atomicWrite(ASSIGNMENTS_URL, report);

  return {
    runId,
    assignmentPath: fileURLToPath(ASSIGNMENTS_URL),
    lemmaCatalogPath: fileURLToPath(LEMMA_CATALOG_URL),
    scannedAtomCount: assignments.length,
    scannedLabelCount: assignments.reduce((count, row) => count + row.assignments.length, 0),
    assignmentCounts: countAssignments(assignments),
    addedLemmaMappings: additions.length,
    allocationRunId: allocation.runId,
    allocationManifestPath: allocation.manifestPath,
    atomsWithSenseLinks: allocation.atomsWithSenseLinks,
    newFrequencyLinks: allocation.newFrequencyLinks,
    residualSenses: allocation.residualSenses
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runEnglishAtomLemmaScan().then((result) => {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }).catch((error) => {
    process.stderr.write(`${error?.message ?? String(error)}\n`);
    process.exitCode = 1;
  });
}
