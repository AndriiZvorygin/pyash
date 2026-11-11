#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
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
  const recoveryPath = `${lockPath}.recovery`;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const handle = await fs.open(lockPath, "wx");
      await handle.writeFile(`${process.pid}\n`, "utf8");
      await handle.close();
      return () => fs.rm(lockPath, { force: true });
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      if (await reclaimStaleRunLock(lockPath, recoveryPath)) continue;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  throw new Error("a WordNet sense compound refinery run is already active");
}

async function reclaimStaleRunLock(lockPath, recoveryPath) {
  let recoveryHandle;
  try {
    recoveryHandle = await fs.open(recoveryPath, "wx");
  } catch (error) {
    if (error?.code === "EEXIST") return false;
    throw error;
  }
  try {
    await recoveryHandle.writeFile(`${process.pid}\n`, "utf8");
    let originalContent;
    let originalStat;
    try {
      [originalContent, originalStat] = await Promise.all([
        fs.readFile(lockPath, "utf8"),
        fs.stat(lockPath)
      ]);
    } catch (error) {
      if (error?.code === "ENOENT") return true;
      throw error;
    }
    const ownerPid = Number(originalContent.trim());
    if (!Number.isSafeInteger(ownerPid) || ownerPid < 1 || processIsAlive(ownerPid)) return false;

    let currentContent;
    let currentStat;
    try {
      [currentContent, currentStat] = await Promise.all([
        fs.readFile(lockPath, "utf8"),
        fs.stat(lockPath)
      ]);
    } catch (error) {
      if (error?.code === "ENOENT") return true;
      throw error;
    }
    if (currentContent !== originalContent
      || currentStat.dev !== originalStat.dev
      || currentStat.ino !== originalStat.ino) return false;
    await fs.rm(lockPath, { force: true });
    return true;
  } finally {
    await recoveryHandle.close();
    await fs.rm(recoveryPath, { force: true });
  }
}

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== "ESRCH";
  }
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
    const sweepState = dependencies.sweepState ?? {};
    return await runWordNetSenseCompoundRefineryChunk({
      dependencies,
      configuration,
      requestedRunId,
      repositoryRoot,
      artifactRoot,
      report,
      allocation,
      sweepState
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
  allocation,
  sweepState = {}
}) {
  const runId = requestedRunId
    ? sanitizeRunId(requestedRunId)
    : wordNetSenseCompoundRunId({ sourceHash: allocation.sourceHash });
  let checkpointPath = "";
  const newspaperPath = path.join(repositoryRoot, "newspaper", `${sanitizeRunId(runId)}.pya`);
  let newspaperWrite = Promise.resolve();
  if (sweepState.newspaperPath !== newspaperPath || !Number.isSafeInteger(sweepState.evokeIndex)) {
    sweepState.newspaperPath = newspaperPath;
    sweepState.evokeIndex = await nextNewspaperEvokeIndex(newspaperPath);
  }
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
      dependencies: { ...dependencies, prepareAllocation: async () => allocation, sweepState },
      onEvoke: (actionSentence) => {
        const sentenceId = `evoke-${sweepState.evokeIndex++}`;
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
  const signatures = [];
  for (const filename of ["worklist.pya", "progress.pya"]) {
    try {
      const metadata = await fs.stat(path.join(artifactDirectory, filename));
      signatures.push(`${filename}:${metadata.size}:${metadata.mtimeMs}`);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      signatures.push(`${filename}:missing`);
    }
  }
  return signatures.join("\n");
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
    // Frequency allocation inputs are fixed for this run. Individual chunks
    // reload live bridge/compound links and progress from their durable files.
    const allocation = await prepareAllocation();
    const runId = requestedRunId
      ? sanitizeRunId(requestedRunId)
      : wordNetSenseCompoundRunId({ sourceHash: allocation.sourceHash });
    const artifactDirectory = path.join(artifactRoot, runId);
    const sweepState = { runId, artifactDirectory };
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
      const previousBatchCompletedAt = sweepState.previousBatchCompletedAt ?? null;
      sweepState.firstProviderSubmissionAt = null;
      lastResult = await runChunk({
        dependencies,
        configuration: chunkSenseIds ? { ...configuration, senseIds: chunkSenseIds } : configuration,
        requestedRunId: runId,
        repositoryRoot,
        artifactRoot,
        report: () => {},
        allocation,
        sweepState
      });
      batchCount += 1;
      const firstProviderSubmissionAt = sweepState.firstProviderSubmissionAt;
      const rolloverToFirstSubmissionMs = previousBatchCompletedAt && firstProviderSubmissionAt
        ? Math.max(0, firstProviderSubmissionAt - previousBatchCompletedAt)
        : null;
      sweepState.previousBatchCompletedAt = Date.now();
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
        rolloverToFirstSubmissionMs,
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
