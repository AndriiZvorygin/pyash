import { createHash } from "node:crypto";
import { mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import pyashWords from "../program/library/pyashWords.json" with { type: "json" };
import {
  ENGLISH_WORDNET_LINKER_CONFIG_URL,
  buildEnglishWordNetSenseLinkRecords,
  parseEnglishWordNetLinkerConfig
} from "../program/library/translation/english_wordnet_linker.mjs";
import {
  classifyEnglishWordNetSenseSweep,
  partitionEnglishWordNetSenseSweep,
  renderEnglishWordNetSweepAutomaticLinksPya,
  renderEnglishWordNetSweepBatchPya,
  renderEnglishWordNetSweepManifestPya
} from "../program/library/translation/english_wordnet_sweep.mjs";
import { lookupEnglish30kCoverage } from "../program/library/translation/english30k_coverage.mjs";
import { loadDefaultEnglishSentenceResources } from "../program/library/translation/english_sentence.mjs";
import { loadCoverage } from "./compound_coverage.mjs";

const COMMAND_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(COMMAND_DIRECTORY, "..");
const ARTIFACT_ROOT = join(REPOSITORY_ROOT, "artifacts");

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function normalized(value) {
  return typeof value === "string" ? value.normalize("NFC").trim().toLowerCase() : "";
}

function sequence(value) {
  return Array.isArray(value)
    ? value.filter((word) => typeof word === "string" && word.trim()).map((word) => word.trim())
    : [];
}

function compoundCoverageIndex(records = []) {
  const byTerm = new Map();
  for (const record of records) {
    const target = normalized(record?.target);
    const pyashSequence = sequence(record?.pyashSequence);
    if (!target || pyashSequence.length < 2 || pyashSequence.length > 3) continue;
    const entry = {
      coverageType: "compound",
      canonicalEnglish: target,
      id: typeof record.id === "string" ? record.id : `compound:${pyashSequence.join("+")}`,
      pyashSequence
    };
    for (const term of [target, ...(Array.isArray(record.aliases) ? record.aliases : [])]) {
      const key = normalized(term);
      if (key && !byTerm.has(key)) byTerm.set(key, entry);
    }
  }
  return byTerm;
}

async function atomicWrite(path, contents) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await rm(temporary, { force: true });
  await writeFile(temporary, contents, "utf8");
  await rename(temporary, path);
}

async function acquireLock(path) {
  await mkdir(dirname(path), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await open(path, "wx");
      await handle.writeFile(`${process.pid}\n`, "utf8");
      await handle.close();
      return async () => rm(path, { force: true });
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const lockText = await readFile(path, "utf8");
      const lockPid = Number(lockText.trim());
      let active = Number.isSafeInteger(lockPid) && lockPid > 0;
      if (active) {
        try {
          process.kill(lockPid, 0);
        } catch (probeError) {
          active = probeError?.code === "EPERM";
        }
      }
      if (active) throw new Error(`WordNet sense sweep is already running as pid ${lockPid}`);
      if (!Number.isSafeInteger(lockPid)) {
        const lockInfo = await stat(path);
        if (Date.now() - lockInfo.mtimeMs < 30000) {
          throw new Error("WordNet sense sweep lock is being initialized; retry shortly");
        }
      }
      await rm(path, { force: true });
    }
  }
  throw new Error("could not acquire WordNet sweep lock");
}

function batchName(index) {
  return `batch-${String(index).padStart(5, "0")}.pya`;
}

async function writeManifest(directory, manifest) {
  await atomicWrite(join(directory, "manifest.pya"), renderEnglishWordNetSweepManifestPya(manifest));
}

export async function runWordNetSenseSweep({ artifactRoot = ARTIFACT_ROOT } = {}) {
  const [resources, compounds, linkerSource] = await Promise.all([
    loadDefaultEnglishSentenceResources(),
    loadCoverage(),
    readFile(ENGLISH_WORDNET_LINKER_CONFIG_URL, "utf8")
  ]);
  const config = parseEnglishWordNetLinkerConfig(linkerSource);
  const compoundIndex = compoundCoverageIndex(compounds.accepted);
  const resolveWord = (word) => compoundIndex.get(normalized(word))
    ?? lookupEnglish30kCoverage(resources.coverage, word);
  const sourceHash = resources.wordnet.sourceHash;
  const coverageIdentity = {
    english30kHash: resources.source.sourceHash,
    englishLookup: [...resources.coverage.byVariant.entries()]
      .map(([term, record]) => [
        term,
        record.id,
        record.coverageType,
        record.status,
        record.canonicalEnglish ?? "",
        sequence(record.pyashSequence),
        record.lemma ?? "",
        record.lemmaStatus ?? ""
      ])
      .sort((left, right) => String(left[0]).localeCompare(String(right[0]))),
    atoms: pyashWords.map((entry) => [normalized(entry?.en), String(entry?.pya ?? "")]),
    acceptedCompounds: compounds.accepted
      .map((entry) => [normalized(entry.target), ...(entry.aliases ?? []).map(normalized), sequence(entry.pyashSequence), entry.status])
      .sort((left, right) => String(left[0]).localeCompare(String(right[0]))),
    bridges: (resources.wordnet.bridges?.entries ?? [])
      .map((entry) => [entry.source, entry.target, entry.targetPartOfSpeech, entry.certainty, entry.equivalenceGroup ?? ""])
      .sort((left, right) => String(left[0]).localeCompare(String(right[0]))),
    edgeMaxDegree: config.edgeMaxDegree
  };
  const coverageHash = sha256(JSON.stringify(coverageIdentity));
  const runId = `wordnet-sense-sweep-${sourceHash.slice(0, 12)}-${coverageHash.slice(0, 12)}-d${config.edgeMaxDegree}`;
  const directory = join(resolve(artifactRoot), runId);
  await mkdir(directory, { recursive: true });
  const releaseLock = await acquireLock(join(directory, ".sweep.lock"));
  const manifestPath = join(directory, "manifest.pya");
  let manifest;

  try {
    process.stderr.write(`[wordnet-sweep] ${runId}: classify senses\n`);
    const sourceRecords = buildEnglishWordNetSenseLinkRecords({
      wordnetIndex: resources.wordnet.index,
      resolveWord,
      limit: Number.MAX_SAFE_INTEGER,
      edgeMaxDegree: config.edgeMaxDegree
    });
    const classified = classifyEnglishWordNetSenseSweep(sourceRecords);
    const batches = partitionEnglishWordNetSenseSweep(classified.records, config.sweepBatchSize);
    manifest = {
      runId,
      sourceHash,
      coverageHash,
      status: "running",
      batchSize: config.sweepBatchSize,
      batchCount: batches.length,
      completedBatchCount: 0,
      recordCount: classified.records.length,
      counts: Object.fromEntries(Object.keys(classified.counts).map((key) => [key, 0]))
    };
    await writeManifest(directory, manifest);

    for (const [index, batch] of batches.entries()) {
      const filename = batchName(index + 1);
      const batchPath = join(directory, "batches", filename);
      const contents = renderEnglishWordNetSweepBatchPya({
        runId,
        batchIndex: index + 1,
        sourceHash,
        coverageHash,
        records: batch
      });
      let matches = false;
      try {
        matches = await readFile(batchPath, "utf8") === contents;
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
      if (!matches) await atomicWrite(batchPath, contents);
      manifest.completedBatchCount = index + 1;
      manifest.counts = Object.fromEntries(Object.keys(classified.counts).map((category) => [
        category,
        batch.reduce((count, record) => count + Number(record.category === category), 0)
          + (manifest.counts[category] ?? 0)
      ]));
      await writeManifest(directory, manifest);
      if ((index + 1) % 10 === 0 || index + 1 === batches.length) {
        process.stderr.write(`[wordnet-sweep] batches ${index + 1}/${batches.length}\n`);
      }
    }

    const automatic = classified.records.filter((record) => record.category === "automatic-link");
    await atomicWrite(join(directory, "automatic-links.pya"), renderEnglishWordNetSweepAutomaticLinksPya({
      runId,
      sourceHash,
      coverageHash,
      records: automatic
    }));
    manifest.status = "complete";
    manifest.counts = classified.counts;
    await writeManifest(directory, manifest);
    return {
      runId,
      directory,
      sourceHash,
      coverageHash,
      status: manifest.status,
      recordCount: manifest.recordCount,
      batchCount: manifest.batchCount,
      counts: manifest.counts,
      automaticLinks: join(directory, "automatic-links.pya"),
      manifest: manifestPath
    };
  } catch (error) {
    if (manifest) {
      manifest.status = "failed";
      manifest.error = String(error?.message ?? error).slice(0, 500);
      await writeManifest(directory, manifest).catch(() => {});
    }
    throw error;
  } finally {
    await releaseLock();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runWordNetSenseSweep().then((result) => {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }).catch((error) => {
    process.stderr.write(`${error?.message ?? String(error)}\n`);
    process.exitCode = 1;
  });
}
