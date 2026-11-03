#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { prepareWordNetFrequencyAllocation } from "./wordnet_frequency_allocate.mjs";
import { encodeCheckpointText, sanitizeRunId } from "./run_pya_helpers.mjs";
import { sentenceToPyash } from "../program/beautiful.mjs";
import { runWordNetSenseCompoundRefinery, wordNetSenseCompoundRunId } from "../program/library/translation/wordnet_sense_compound_refinery.mjs";

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ARTIFACT_ROOT = path.join(REPOSITORY_ROOT, "artifacts");

async function acquireRunLock() {
  await fs.mkdir(ARTIFACT_ROOT, { recursive: true });
  const lockPath = path.join(ARTIFACT_ROOT, ".wordnet-sense-compound-refinery.lock");
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

async function appendCheckpoint({ runId, sentence }) {
  if (!runId || sentence?.be !== "checkpoint" || sentence?.mood !== "ya") return null;
  const directory = path.join(REPOSITORY_ROOT, "newspaper");
  const filename = path.join(directory, `${sanitizeRunId(runId)}.pya`);
  await fs.mkdir(directory, { recursive: true });
  const safe = { ...sentence };
  for (const role of ["fromtext", "totext"]) {
    if (typeof safe[role]?.text !== "string") continue;
    safe[role] = { ...safe[role], text: encodeCheckpointText(safe[role].text) };
  }
  await fs.appendFile(filename, `${sentenceToPyash(safe)}\n`, "utf8");
  return filename;
}

export async function runWordNetSenseCompoundRefineryCommand({
  dependencies = {},
  configuration = {},
  runId: requestedRunId = "",
  report = console.log
} = {}) {
  if (process.env.PYA_MIND_RESPONSE) {
    throw new Error("WordNet sense compound refinery requires PYA_MIND_RESPONSE to be unset");
  }
  const releaseLock = await acquireRunLock();
  try {
    const allocation = await (dependencies.prepareAllocation ?? prepareWordNetFrequencyAllocation)();
    const runId = requestedRunId
      ? sanitizeRunId(requestedRunId)
      : wordNetSenseCompoundRunId({ sourceHash: allocation.sourceHash });
    let checkpointPath = "";
    let checkpointWrite = Promise.resolve();
    let result;
    try {
      result = await runWordNetSenseCompoundRefinery({
        runId,
        configuration,
        dependencies: { ...dependencies, prepareAllocation: async () => allocation },
        onCheckpoint: (sentence) => {
          checkpointWrite = checkpointWrite.then(async () => {
            checkpointPath = await appendCheckpoint({ runId, sentence }) || checkpointPath;
          });
        }
      });
    } finally {
      await checkpointWrite;
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
    await runWordNetSenseCompoundRefineryCommand();
  } catch (error) {
    process.stderr.write(`${error?.message ?? String(error)}\n`);
    process.exitCode = 1;
  }
}
