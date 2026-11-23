#!/usr/bin/env node

import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { encodeCheckpointText, sanitizeRunId } from "./run_pya_helpers.mjs";
import { sentenceToPyash } from "../program/beautiful.mjs";
import {
  clearExchangeRecorder,
  setExchangeRecorder,
  setExchangeRunId,
  setExchangeSentenceId,
  setExchangeStrict
} from "../program/bridge/exchange.mjs";
import { runSumoConceptRefinery } from "../program/library/translation/sumo_concept_refinery.mjs";

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ARTIFACT_ROOT = path.join(REPOSITORY_ROOT, "artifacts");

async function acquireRunLock(artifactRoot = ARTIFACT_ROOT) {
  await fs.mkdir(artifactRoot, { recursive: true });
  const lockPath = path.join(artifactRoot, ".sumo-concept-refinery.lock");
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
  throw new Error("a SUMO concept refinery run is already active");
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

export function processStateFromProcStat(source) {
  const close = String(source ?? "").lastIndexOf(")");
  if (close < 0) return "";
  return String(source).slice(close + 1).trim().split(/\s+/u)[0] || "";
}

export function processStateIsAlive(state) {
  return state !== "Z" && state !== "X";
}

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    try {
      const state = processStateFromProcStat(requireProcStat(pid));
      if (!processStateIsAlive(state)) return false;
    } catch {}
    return true;
  } catch (error) {
    return error?.code !== "ESRCH";
  }
}

function requireProcStat(pid) {
  return fsSync.readFileSync(`/proc/${pid}/stat`, "utf8");
}

async function progressArtifactSignature(artifactDirectory) {
  const signatures = [];
  for (const filename of ["concept-worklist.pya", "concept-candidates.pya", "concept-decisions.pya"]) {
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

export async function runSumoConceptRefinerySweepCommand({
  dependencies = {},
  configuration = {},
  runId: requestedRunId = "",
  repositoryRoot = REPOSITORY_ROOT,
  artifactRoot = path.join(repositoryRoot, "artifacts"),
  report = console.log,
  maximumBatches = 10000
} = {}) {
  if (process.env.PYA_MIND_RESPONSE) {
    throw new Error("SUMO concept refinery requires PYA_MIND_RESPONSE to be unset");
  }
  if (!Number.isSafeInteger(maximumBatches) || maximumBatches < 1) {
    throw new Error("SUMO concept refinery sweep requires a positive batch limit");
  }
  const releaseLock = await acquireRunLock(artifactRoot);
  try {
    const requestedConceptIds = Array.isArray(configuration.conceptIds)
      ? [...new Set(configuration.conceptIds.map((value) => String(value ?? "").trim()).filter(Boolean))]
      : null;
    const requestedBatchSize = Math.min(64, Math.max(1, Math.trunc(Number(configuration.maximumConcepts) || 64)));
    let requestedOffset = 0;
    let batchCount = 0;
    let lastResult = null;
    const sweepState = {};

    while (batchCount < maximumBatches) {
      const before = await (dependencies.progressSignature ?? progressArtifactSignature)(
        lastResult?.artifactDirectory ?? path.join(artifactRoot, requestedRunId || "pending")
      );
      const chunkConceptIds = requestedConceptIds
        ? requestedConceptIds.slice(requestedOffset, requestedOffset + requestedBatchSize)
        : null;
      if (requestedConceptIds && chunkConceptIds.length === 0) {
        return { ...lastResult, batchCount, remainingConceptCount: 0, sweepComplete: true };
      }
      lastResult = await runSumoConceptRefinery({
        dependencies,
        configuration: chunkConceptIds ? { ...configuration, conceptIds: chunkConceptIds } : configuration,
        runId: requestedRunId,
        repositoryRoot,
        artifactRoot,
        report: () => {},
        onCheckpoint: () => {},
        onStage: () => {},
        initialize: dependencies.initialize ?? true
      });
      batchCount += 1;
      report(JSON.stringify({
        event: "sumo-concept-batch-complete",
        batchCount,
        runId: lastResult.runId,
        selectedConceptCount: lastResult.selectedConceptCount,
        remainingConceptCount: requestedConceptIds
          ? requestedConceptIds.length - requestedOffset - lastResult.selectedConceptCount
          : lastResult.remainingConceptCount,
        artifactDirectory: lastResult.artifactDirectory
      }));
      if (requestedConceptIds) {
        if (lastResult.selectedConceptCount !== chunkConceptIds.length) {
          throw new Error(
            `SUMO concept retry selected ${lastResult.selectedConceptCount} of ${chunkConceptIds.length} requested concepts`
          );
        }
        requestedOffset += chunkConceptIds.length;
        if (requestedOffset >= requestedConceptIds.length) {
          return { ...lastResult, batchCount, remainingConceptCount: 0, sweepComplete: true };
        }
      }
      if (!requestedConceptIds && lastResult.remainingConceptCount === 0) {
        return { ...lastResult, batchCount, sweepComplete: true };
      }
      if (!requestedConceptIds && lastResult.selectedConceptCount === 0) {
        throw new Error(
          `SUMO concept sweep has ${lastResult.remainingConceptCount} concepts remaining but selected no work`
        );
      }
      const after = await (dependencies.progressSignature ?? progressArtifactSignature)(lastResult.artifactDirectory);
      if (before === after) {
        throw new Error(
          `SUMO concept sweep made no durable progress; ${lastResult.remainingConceptCount} concepts remain in ${lastResult.artifactDirectory}`
        );
      }
    }
    const remaining = requestedConceptIds
      ? requestedConceptIds.length - requestedOffset
      : lastResult?.remainingConceptCount ?? "unknown";
    throw new Error(`SUMO concept sweep reached its ${maximumBatches}-batch safety limit with ${remaining} concepts remaining`);
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
    await runSumoConceptRefinerySweepCommand();
  } catch (error) {
    process.stderr.write(`${error?.message ?? String(error)}\n`);
    process.exitCode = 1;
  }
}
