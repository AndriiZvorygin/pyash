#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

import { prepareWordNetFrequencyAllocation } from "./wordnet_frequency_allocate.mjs";
import { encodeCheckpointText, sanitizeRunId } from "./run_pya_helpers.mjs";
import { sentenceToPyash } from "../program/beautiful.mjs";
import {
  clearExchangeRecorder,
  setExchangeRecorder,
  setExchangeRunId,
  setExchangeSentenceId,
  setExchangeStrict
} from "../program/bridge/exchange.mjs";
import { runWordNetSenseCompoundRefinery, wordNetSenseCompoundRunId } from "../program/library/translation/wordnet_sense_compound_refinery.mjs";

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ARTIFACT_ROOT = path.join(REPOSITORY_ROOT, "artifacts");

async function acquireRunLock(artifactRoot = ARTIFACT_ROOT) {
  await fs.mkdir(artifactRoot, { recursive: true });
  const lockPath = path.join(artifactRoot, ".wordnet-sense-compound-refinery.lock");
  let handle;
  try {
    handle = await fs.open(lockPath, "wx");
  } catch (error) {
    if (error?.code === "EEXIST") throw new Error("a WordNet sense compound refinery run is already active");
    throw error;
  }
  await handle.writeFile(`${process.pid}\n`, "utf8");
  await handle.close();
  return () => fs.rm(lockPath, { force: true });
}

async function nextNewspaperEvokeIndex(newspaperPath) {
  let source;
  try {
    source = await fs.readFile(newspaperPath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return 0;
    throw error;
  }
  let nextIndex = 0;
  for (const match of source.matchAll(/(?:^|\s)su name evoke-(\d+)(?=\s)/gu)) {
    nextIndex = Math.max(nextIndex, Number(match[1]) + 1);
  }
  return nextIndex;
}

export async function runWordNetSenseCompoundRefineryCommand({
  dependencies = {},
  configuration = {},
  runId: requestedRunId = "",
  repositoryRoot = REPOSITORY_ROOT,
  artifactRoot = path.join(repositoryRoot, "artifacts"),
  report = console.log
} = {}) {
  if (process.env.PYA_MIND_RESPONSE) {
    throw new Error("WordNet sense compound refinery requires PYA_MIND_RESPONSE to be unset");
  }
  const releaseLock = await acquireRunLock(artifactRoot);
  try {
    const allocation = await (dependencies.prepareAllocation ?? prepareWordNetFrequencyAllocation)();
    return await runWordNetSenseCompoundRefineryChunk({
      dependencies,
      configuration,
      requestedRunId,
      repositoryRoot,
      artifactRoot,
      report,
      allocation
    });
  } finally {
    await releaseLock();
  }
}

async function runWordNetSenseCompoundRefineryChunk({
  dependencies,
  configuration,
  requestedRunId,
  repositoryRoot,
  artifactRoot,
  report,
  allocation
}) {
  const runId = requestedRunId
    ? sanitizeRunId(requestedRunId)
    : wordNetSenseCompoundRunId({ sourceHash: allocation.sourceHash });
  let checkpointPath = "";
  const newspaperPath = path.join(repositoryRoot, "newspaper", `${sanitizeRunId(runId)}.pya`);
  let newspaperWrite = Promise.resolve();
  let evokeIndex = await nextNewspaperEvokeIndex(newspaperPath);
  const appendNewspaper = (sentence) => {
    if (!sentence) return;
    const safe = { ...sentence };
    if (safe.be === "checkpoint") {
      for (const role of ["fromtext", "totext"]) {
        if (typeof safe[role]?.text === "string") {
          safe[role] = { ...safe[role], text: encodeCheckpointText(safe[role].text) };
        }
      }
    }
    newspaperWrite = newspaperWrite.then(async () => {
      await fs.mkdir(path.dirname(newspaperPath), { recursive: true });
      await fs.appendFile(newspaperPath, `${sentenceToPyash(safe)}\n`, "utf8");
    });
  };
  setExchangeRecorder({ runRoot: repositoryRoot, record: appendNewspaper });
  setExchangeRunId(runId);
  setExchangeStrict(true);
  let result;
  try {
    result = await (dependencies.runRefinery ?? runWordNetSenseCompoundRefinery)({
      artifactRoot,
      runId,
      configuration,
      dependencies: { ...dependencies, prepareAllocation: async () => allocation },
      onEvoke: (actionSentence) => {
        const sentenceId = `evoke-${evokeIndex++}`;
        setExchangeSentenceId(sentenceId);
        appendNewspaper({
          mood: "ya",
          exists: true,
          be: "evoke",
          su: { name: sentenceId },
          ob: { la: actionSentence }
        });
      },
      onCheckpoint: (sentence) => {
        appendNewspaper(sentence);
        checkpointPath = path.join(repositoryRoot, "newspaper", `${sanitizeRunId(runId)}.pya`);
      },
      onStage: appendNewspaper
    });
  } finally {
    try {
      await newspaperWrite;
    } finally {
      clearExchangeRecorder();
    }
  }
  const summary = {
    runId,
    artifactDirectory: result.artifactDirectory,
    checkpointPath,
    selectedSenseCount: result.selectedSenseCount,
    remainingSenseCount: result.remainingSenseCount,
    candidateCount: result.candidateCount,
    ...result.result
  };
  report(JSON.stringify(summary, null, 2));
  return { ...result, result: summary, checkpointPath };
}

async function progressArtifactSignature(artifactDirectory) {
  const hash = createHash("sha256");
  for (const filename of ["worklist.pya", "progress.pya"]) {
    hash.update(filename);
    try {
      hash.update(await fs.readFile(path.join(artifactDirectory, filename)));
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  return hash.digest("hex");
}

export async function runWordNetSenseCompoundRefinerySweepCommand({
  dependencies = {},
  configuration = {},
  runId: requestedRunId = "",
  repositoryRoot = REPOSITORY_ROOT,
  artifactRoot = path.join(repositoryRoot, "artifacts"),
  report = console.log,
  maximumBatches = 10000
} = {}) {
  if (process.env.PYA_MIND_RESPONSE) {
    throw new Error("WordNet sense compound refinery requires PYA_MIND_RESPONSE to be unset");
  }
  if (!Number.isSafeInteger(maximumBatches) || maximumBatches < 1) {
    throw new Error("WordNet sense compound sweep requires a positive batch limit");
  }
  const releaseLock = await acquireRunLock(artifactRoot);
  try {
    const prepareAllocation = dependencies.prepareAllocation ?? prepareWordNetFrequencyAllocation;
    let allocation = await prepareAllocation();
    const runId = requestedRunId
      ? sanitizeRunId(requestedRunId)
      : wordNetSenseCompoundRunId({ sourceHash: allocation.sourceHash });
    const artifactDirectory = path.join(artifactRoot, runId);
    let batchCount = 0;
    let lastResult = null;
    const requestedSenseIds = Array.isArray(configuration.senseIds)
      ? [...new Set(configuration.senseIds.map((senseId) => String(senseId ?? "").trim()).filter(Boolean))]
      : null;
    const requestedBatchSize = Math.min(64, Math.max(1, Math.trunc(Number(configuration.maximumSenses) || 64)));
    let requestedOffset = 0;

    while (batchCount < maximumBatches) {
      const before = await (dependencies.progressSignature ?? progressArtifactSignature)(artifactDirectory);
      const runChunk = dependencies.runChunk ?? runWordNetSenseCompoundRefineryChunk;
      const chunkSenseIds = requestedSenseIds
        ? requestedSenseIds.slice(requestedOffset, requestedOffset + requestedBatchSize)
        : null;
      if (requestedSenseIds && chunkSenseIds.length === 0) {
        return { ...lastResult, batchCount, remainingSenseCount: 0, sweepComplete: true };
      }
      lastResult = await runChunk({
        dependencies,
        configuration: chunkSenseIds ? { ...configuration, senseIds: chunkSenseIds } : configuration,
        requestedRunId: runId,
        repositoryRoot,
        artifactRoot,
        report: () => {},
        allocation
      });
      batchCount += 1;
      report(JSON.stringify({
        event: "wordnet-sense-compound-batch-complete",
        batchCount,
        runId,
        selectedSenseCount: lastResult.selectedSenseCount,
        remainingSenseCount: requestedSenseIds
          ? requestedSenseIds.length - requestedOffset - lastResult.selectedSenseCount
          : lastResult.remainingSenseCount,
        candidateCount: lastResult.candidateCount,
        promotedSenseCount: Number(lastResult.result?.["promoted-sense-count"] ?? 0),
        translationFailureCount: lastResult.translationFailureCount,
        artifactDirectory,
        checkpointPath: lastResult.checkpointPath
      }));

      if (requestedSenseIds) {
        if (lastResult.selectedSenseCount !== chunkSenseIds.length) {
          throw new Error(`WordNet sense compound retry selected ${lastResult.selectedSenseCount} of ${chunkSenseIds.length} requested senses`);
        }
        requestedOffset += chunkSenseIds.length;
        if (requestedOffset >= requestedSenseIds.length) {
          return { ...lastResult, batchCount, remainingSenseCount: 0, sweepComplete: true };
        }
      }

      if (!requestedSenseIds && lastResult.remainingSenseCount === 0) {
        return { ...lastResult, batchCount, sweepComplete: true };
      }
      if (!requestedSenseIds && lastResult.selectedSenseCount === 0) {
        throw new Error(`WordNet sense compound sweep has ${lastResult.remainingSenseCount} senses remaining but selected no work`);
      }

      const after = await (dependencies.progressSignature ?? progressArtifactSignature)(artifactDirectory);
      if (before === after) {
        throw new Error(`WordNet sense compound sweep made no durable progress; ${lastResult.remainingSenseCount} senses remain in ${artifactDirectory}`);
      }
      allocation = await prepareAllocation();
    }

    const remaining = requestedSenseIds
      ? requestedSenseIds.length - requestedOffset
      : lastResult?.remainingSenseCount ?? "unknown";
    throw new Error(`WordNet sense compound sweep reached its ${maximumBatches}-batch safety limit with ${remaining} senses remaining`);
  } finally {
    await releaseLock();
  }
}

function isMainModule() {
  if (!process.argv[1]) return false;
  return path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isMainModule()) {
  try {
    await runWordNetSenseCompoundRefinerySweepCommand();
  } catch (error) {
    process.stderr.write(`${error?.message ?? String(error)}\n`);
    process.exitCode = 1;
  }
}
