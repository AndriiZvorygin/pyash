#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { readPyaTextValues } from "../program/library/pya_config.mjs";
import { readWordNetSenseTranslationCacheFile } from "../program/library/translation/english_wordnet_sense_compounds.mjs";
import {
  WORDNET_WIKIDATA_SAMPLE_LIMIT,
  buildWikidataWordNetQuery,
  buildWordNetWikidataComparison,
  parseWikidataWordNetBindings,
  parseWordNetSenseCompoundWorklist,
  renderWordNetWikidataComparisonPya,
  selectCachedQwenSample,
  wordNet31IdForOpenSynset
} from "../program/library/translation/wordnet_wikidata_comparison.mjs";
import { loadPinnedWordNet31SenseIndex } from "../program/library/translation/sumo_wordnet.mjs";

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WIKIDATA_SPARQL_ENDPOINT = "https://query.wikidata.org/sparql";

function assertActiveRunPath(runId, configuredDirectory, repositoryRoot) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(runId)) {
    throw new Error("active WordNet sweep configuration has an invalid run id");
  }
  const artifactRoot = path.resolve(repositoryRoot, "artifacts");
  const directory = path.resolve(repositoryRoot, configuredDirectory);
  if (directory !== path.join(artifactRoot, runId)) {
    throw new Error("active WordNet sweep artifact directory does not match its run id");
  }
  return directory;
}

async function readStableTranslationCache(cachePath, senseIds, readCache = readWordNetSenseTranslationCacheFile) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const before = await fs.stat(cachePath);
    let cache;
    try {
      cache = await readCache(cachePath, { senseIds });
    } catch (error) {
      const afterFailure = await fs.stat(cachePath);
      if ((before.size !== afterFailure.size || before.ino !== afterFailure.ino) && attempt < 2) continue;
      throw error;
    }
    const after = await fs.stat(cachePath);
    return {
      cache,
      snapshot: {
        bytesAtReadStart: before.size,
        bytesAtReadEnd: after.size,
        changedDuringRead: before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ino !== after.ino
      }
    };
  }
  throw new Error("unable to read a complete append-only translation cache snapshot");
}

async function fetchWikidataBindings(query, fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== "function") throw new Error("runtime does not provide fetch for the Wikidata query");
  const url = new URL(WIKIDATA_SPARQL_ENDPOINT);
  url.searchParams.set("query", query);
  url.searchParams.set("format", "json");
  const response = await fetchImpl(url, {
    headers: {
      accept: "application/sparql-results+json",
      "user-agent": "Pyash WordNet Wikidata comparison (read-only)"
    },
    signal: AbortSignal.timeout(45000)
  });
  if (!response.ok) {
    const body = (await response.text()).slice(0, 500);
    throw Object.assign(new Error(`Wikidata SPARQL returned HTTP ${response.status}: ${body}`), {
      code: "wikidata-sparql-http-error",
      details: { status: response.status }
    });
  }
  try {
    return await response.json();
  } catch (error) {
    throw Object.assign(new Error("Wikidata SPARQL returned invalid JSON", { cause: error }), {
      code: "wikidata-sparql-invalid-json"
    });
  }
}

function timestampForFilename(date) {
  return date.toISOString().replace(/[-:]/gu, "").replace(/\.\d{3}/u, "");
}

export async function runWordNetWikidataComparison({
  repositoryRoot = REPOSITORY_ROOT,
  fetchImpl = globalThis.fetch,
  readCache = readWordNetSenseTranslationCacheFile,
  now = () => new Date(),
  report = console.log
} = {}) {
  const recoveryConfigPath = path.join(
    repositoryRoot,
    "world",
    "house",
    "refinery-watchdog",
    "conduct",
    "wordnet-sweep-recovery.pya"
  );
  const recovery = readPyaTextValues(recoveryConfigPath, [
    "WordNet sweep run id",
    "WordNet sweep artifact directory"
  ]);
  const runId = String(recovery["WordNet sweep run id"] ?? "").trim();
  const artifactDirectory = assertActiveRunPath(
    runId,
    String(recovery["WordNet sweep artifact directory"] ?? "").trim(),
    repositoryRoot
  );
  const worklistPath = path.join(artifactDirectory, "worklist.pya");
  const worklist = parseWordNetSenseCompoundWorklist(await fs.readFile(worklistPath, "utf8"));
  const cachePath = path.join(artifactDirectory, "sense-translations.pya");
  const { cache, snapshot: translationCacheSnapshot } = await readStableTranslationCache(
    cachePath,
    worklist.rows.map((row) => row.senseId),
    readCache
  );
  const sample = selectCachedQwenSample({ worklist, cache });
  if (sample.length === 0) {
    throw new Error("the active worklist has no complete, source-matched cached Qwen translations to compare");
  }

  const wordNet31Index = await loadPinnedWordNet31SenseIndex({ root: repositoryRoot });
  const crosswalkBySense = new Map(sample.map(({ sense }) => [
    sense.senseId,
    wordNet31IdForOpenSynset(sense, wordNet31Index)
  ]));
  const p8814Ids = [...new Set([...crosswalkBySense.values()]
    .filter((crosswalk) => crosswalk.status === "matched")
    .map((crosswalk) => crosswalk.p8814Id))];
  const wikidataQuery = p8814Ids.length > 0 ? buildWikidataWordNetQuery(p8814Ids) : "";
  const payload = p8814Ids.length > 0
    ? await fetchWikidataBindings(wikidataQuery, fetchImpl)
    : { results: { bindings: [] } };
  const entitiesBySynset = parseWikidataWordNetBindings(payload, { expectedSynsetIds: p8814Ids });
  const createdAt = now().toISOString();
  const comparison = buildWordNetWikidataComparison({
    runId,
    worklistHash: worklist.metadata["worklist-hash"],
    sourceHash: worklist.metadata["source-hash"],
    wordNet31IndexHash: wordNet31Index.sourceHash,
    wikidataEndpoint: WIKIDATA_SPARQL_ENDPOINT,
    wikidataQuery,
    translationCacheSnapshot,
    sample,
    crosswalkBySense,
    entitiesBySynset,
    createdAt
  });

  const outputDirectory = path.join(artifactDirectory, "wikidata-comparison");
  await fs.mkdir(outputDirectory, { recursive: true });
  const outputPath = path.join(outputDirectory, `sample-${timestampForFilename(new Date(createdAt))}.pya`);
  await fs.writeFile(outputPath, renderWordNetWikidataComparisonPya(comparison), {
    encoding: "utf8",
    flag: "wx"
  });

  report(JSON.stringify({
    runId,
    worklistRows: worklist.rows.length,
    sampleCount: comparison.summary.worklistSampleCount,
    exactP8814Matches: comparison.summary.exactP8814Matches,
    samplesWithTargetLanguageLabels: comparison.summary.samplesWithTargetLanguageLabels,
    labelsByLanguage: comparison.summary.labelsByLanguage,
    exactSurfaceOverlapsByLanguage: comparison.summary.exactSurfaceOverlapsByLanguage,
    artifact: path.relative(repositoryRoot, outputPath),
    maximumSampleSize: WORDNET_WIKIDATA_SAMPLE_LIMIT
  }, null, 2));
  return { comparison, outputPath, worklistPath, cachePath };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  await runWordNetWikidataComparison();
}
