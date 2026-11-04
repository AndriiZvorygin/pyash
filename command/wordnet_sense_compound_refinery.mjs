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
    const runId = requestedRunId
      ? sanitizeRunId(requestedRunId)
      : wordNetSenseCompoundRunId({ sourceHash: allocation.sourceHash });
    let checkpointPath = "";
    const newspaperPath = path.join(repositoryRoot, "newspaper", `${sanitizeRunId(runId)}.pya`);
    let newspaperWrite = Promise.resolve();
    let evokeIndex = 0;
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
