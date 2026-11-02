import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { forget, remember } from "../program/remember/index.mjs";
import { builtInSignatures } from "../program/verbs/index.mjs";
import { registerSignatureHandler, clearSignatureHandlers } from "../program/bridge/signature.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { resolveConfigText } from "../program/configure/env.mjs";
import { createGpuHousekeeperAdapter } from "../program/runtime/gpu/housekeeper_adapter.mjs";
import {
  appendEnglishWordNetAtomSenseLinks,
  buildEnglishWordNetAtomSenseWorklist,
  ENGLISH_WORDNET_ATOM_SENSE_RESPONSE_FORMAT,
  filterEnglishWordNetAtomSenseWorklist,
  hashEnglishWordNetAtomSenseWorklist,
  loadEnglishWordNetAtomSenseConfig,
  runEnglishWordNetAtomSenseSweep
} from "../program/library/translation/english_wordnet_atom_sense_sweep.mjs";
import {
  createDefaultQueuedMindTranslationVocabularySubmitter
} from "../program/library/translation/translation_vocabulary_queue.mjs";
import { loadEnglishWordNetLinkerConfig } from "../program/library/translation/english_wordnet_linker.mjs";
import { awaitTranslationGpuDuty } from "../program/library/translation/translation_to_vliw_job.mjs";
import { loadEnglishLemmaCatalog } from "../program/library/translation/english_lemmas.mjs";
import {
  ENGLISH_WORDNET_BRIDGE_CONFIG_URL,
  parseEnglishWordNetBridgeCatalog
} from "../program/library/translation/english_wordnet_bridges.mjs";
import {
  prepareWordNetFrequencyAllocation,
  runWordNetFrequencyAllocation
} from "./wordnet_frequency_allocate.mjs";
import { loadDefaultConfig } from "./run_pya_helpers.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ARTIFACT_ROOT = path.join(ROOT, "artifacts");

function sha256(value) {
  return createHash("sha256").update(String(value ?? "")).digest("hex");
}

function queueBusyState(queue) {
  const rows = Array.isArray(queue?.jobs) ? queue.jobs : Array.isArray(queue?.items) ? queue.items : [];
  const queued = Number(queue?.queueDepth ?? queue?.depth ?? rows.length);
  const running = Number(queue?.runningCount ?? queue?.activeCount ?? queue?.runningJobs?.length ?? 0);
  return { queued: Number.isFinite(queued) ? queued : rows.length, running: Number.isFinite(running) ? running : 0 };
}

function modelName(row) {
  return String(typeof row === "string" ? row : row?.name ?? row?.model ?? "").trim();
}

async function initializeRuntime() {
  forget();
  clearSignatureHandlers();
  for (const signature of builtInSignatures) registerSignatureHandler(signature);
  await loadDefaultConfig({ cwd: ROOT, interpretFn: interpret, entryPath: ROOT });
}

async function atomicWrite(filename, contents) {
  await mkdir(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.${process.pid}.tmp`;
  await rm(temporary, { force: true });
  await writeFile(temporary, contents, "utf8");
  await rename(temporary, filename);
}

function renderActivationPya({ runId, model, sourceHash, selected = [], uncertain = [], noFit = [] }) {
  return [
    "su name translation be map def",
    'su text "format" ob text "english-wordnet-atom-sense-activation-v1" ya',
    `su text "run-id" ob text ${JSON.stringify(runId)} ya`,
    `su text "model" ob text ${JSON.stringify(model)} ya`,
    `su text "source-hash" ob text ${JSON.stringify(sourceHash)} ya`,
    `su text "selected" ob text quoted.text.${JSON.stringify(selected, null, 2)}.text.quoted ya`,
    `su text "uncertain" ob text quoted.text.${JSON.stringify(uncertain, null, 2)}.text.quoted ya`,
    `su text "no-fit" ob text quoted.text.${JSON.stringify(noFit, null, 2)}.text.quoted ya`,
    "prah",
    ""
  ].join("\n");
}

export async function runWordNetAtomSenseSweep({ maxBatches = Number.POSITIVE_INFINITY, atomIds = null } = {}) {
  if (process.env.PYA_MIND_RESPONSE) {
    throw new Error("WordNet atom-sense sweep requires PYA_MIND_RESPONSE to be unset");
  }
  await initializeRuntime();
  const housekeeperUrl = String(
    process.env.PYA_GPU_HOUSEKEEPER_URL
      ?? resolveConfigText("gpu housekeeper url", { rememberFn: remember })
      ?? ""
  ).trim();
  if (!housekeeperUrl) throw new Error("WordNet atom-sense sweep requires the configured GPU Housekeeper URL");

  const [sweepConfig, linkerConfig] = await Promise.all([
    loadEnglishWordNetAtomSenseConfig(),
    loadEnglishWordNetLinkerConfig()
  ]);
  if (sweepConfig.model !== linkerConfig.model) {
    throw new Error(`atom-sense model ${sweepConfig.model} differs from the configured model card ${linkerConfig.model}`);
  }
  const housekeeper = createGpuHousekeeperAdapter({ baseUrl: housekeeperUrl });
  const [queue, availableModels] = await Promise.all([
    housekeeper.getQueue(),
    housekeeper.getOllamaModels()
  ]);
  const queueState = queueBusyState(queue);
  const models = Array.isArray(availableModels) ? availableModels : availableModels?.models ?? [];
  if (!models.map(modelName).includes(sweepConfig.model)) {
    throw new Error(`configured Housekeeper does not advertise model ${sweepConfig.model}`);
  }

  const [prepared, lemmaCatalog] = await Promise.all([
    prepareWordNetFrequencyAllocation(),
    loadEnglishLemmaCatalog()
  ]);
  const catalogPath = fileURLToPath(ENGLISH_WORDNET_BRIDGE_CONFIG_URL);
  const originalCatalog = await readFile(catalogPath, "utf8");
  const originalCatalogHash = sha256(originalCatalog);
  const catalogSources = new Set(parseEnglishWordNetBridgeCatalog(originalCatalog).entries.map((entry) => entry.source));
  const completeWorklist = buildEnglishWordNetAtomSenseWorklist(prepared.atomCoverage, {
    lemmaEntries: lemmaCatalog.entries,
    resolveTarget: prepared.resolveWord,
    reservedSources: catalogSources
  });
  const worklist = atomIds === null
    ? completeWorklist
    : filterEnglishWordNetAtomSenseWorklist(completeWorklist, atomIds);
  const candidateHash = hashEnglishWordNetAtomSenseWorklist(worklist);
  const runIdPrefix = `wordnet-atom-sense-${prepared.coverageHash.slice(0, 12)}-${candidateHash.slice(0, 10)}-${sweepConfig["prompt-revision"]}`;
  const artifactDirectory = path.join(ARTIFACT_ROOT, runIdPrefix);
  const batchConfig = {
    ...sweepConfig,
    "batch-max-chars": Math.min(
      sweepConfig["batch-max-chars"],
      Math.floor(linkerConfig.promptMaxTokens * 2.4)
    ),
    "max-output-tokens": Math.min(sweepConfig["max-output-tokens"], linkerConfig.modelCard.safeOutputTokens)
  };
  const submit = await createDefaultQueuedMindTranslationVocabularySubmitter({
    model: sweepConfig.model,
    responseFormat: ENGLISH_WORDNET_ATOM_SENSE_RESPONSE_FORMAT,
    maxOutputTokens: batchConfig["max-output-tokens"]
  });
  const result = await runEnglishWordNetAtomSenseSweep({
    worklist,
    sourceHash: prepared.sourceHash,
    coverageHash: prepared.coverageHash,
    model: sweepConfig.model,
    artifactDirectory,
    config: batchConfig,
    submit,
    awaitHandle: awaitTranslationGpuDuty,
    runId: runIdPrefix,
    maxBatches,
    onBatch: ({ batchIndex, decisions, skipped }) => {
      const selected = decisions.filter((row) => row.status === "select").length;
      const uncertain = decisions.filter((row) => row.status === "uncertain").length;
      const noFit = decisions.filter((row) => row.status === "no-fit").length;
      process.stderr.write(`[wordnet-atom-sense] batch ${batchIndex} ${skipped ? "checkpointed locally" : "completed"}; selected=${selected}, uncertain=${uncertain}, no-fit=${noFit}\n`);
      if (batchIndex === 1) {
        for (const row of decisions.slice(0, 3)) {
          process.stderr.write(`[wordnet-atom-sense] sample ${JSON.stringify({ labels: row.labels, selectedSense: row.candidate?.definition ?? null, status: row.status, rationale: row.rationale })}\n`);
        }
      }
    },
    onDispatch: ({ firstBatchIndex, lastBatchIndex, count }) => {
      process.stderr.write(`[wordnet-atom-sense] dispatching ${count} batches (${firstBatchIndex}-${lastBatchIndex}) to Housekeeper\n`);
    }
  });
  if (result.status !== "complete") {
    return {
      ...result,
      housekeeperHost: new URL(housekeeperUrl).host,
      queueBefore: queueState,
      activated: 0
    };
  }

  const latestCatalog = await readFile(catalogPath, "utf8");
  if (sha256(latestCatalog) !== originalCatalogHash) {
    throw new Error(`WordNet bridge catalog changed during the sweep; checkpoints remain at ${artifactDirectory}`);
  }
  const selected = result.records.filter((row) => row.status === "select");
  const updated = appendEnglishWordNetAtomSenseLinks({
    catalogSource: latestCatalog,
    decisions: result.records,
    model: sweepConfig.model,
    runId: result.runId,
    resolveTarget: prepared.resolveWord
  });
  const activationPath = path.join(artifactDirectory, "activation.pya");
  const activatedSources = new Set(updated.added);
  await atomicWrite(activationPath, renderActivationPya({
    runId: result.runId,
    model: sweepConfig.model,
    sourceHash: prepared.sourceHash,
    selected: selected.filter(({ source }) => activatedSources.has(source)).map(({ id, source, labels, candidate, rationale }) => ({
      id, source, labels, sense: candidate?.definition ?? "", rationale
    })),
    uncertain: [
      ...result.records.filter((row) => row.status === "uncertain").map(({ id, labels, rationale }) => ({ id, labels, rationale })),
      ...updated.withheld.map((row) => {
        const decision = selected.find((candidate) => candidate.source === row.source);
        return {
          id: decision?.id ?? row.source,
          source: row.source,
          labels: decision?.labels ?? [row.target],
          rationale: `${decision?.rationale ?? "Model selected this sense."} Activation withheld: ${row.reason}; existing linked senses: ${row.conflictingSources.join(", ") || "ambiguous target identity"}.`
        };
      })
    ],
    noFit: result.records.filter((row) => row.status === "no-fit").map(({ id, labels, rationale, excludedCandidates }) => ({
      id, labels, rationale, excludedCandidates
    }))
  }));
  if (updated.added.length) await atomicWrite(catalogPath, updated.catalogSource);
  const allocation = updated.added.length
    ? await runWordNetFrequencyAllocation({ apply: true })
    : null;
  const queueAfter = await housekeeper.getQueue();
  return {
    runId: result.runId,
    artifactDirectory,
    manifestPath: result.manifestPath,
    activationPath,
    model: sweepConfig.model,
    parallelism: result.parallelism,
    housekeeperHost: new URL(housekeeperUrl).host,
    status: result.status,
    recordCount: result.recordCount,
    selected: result.selected,
    uncertain: result.uncertain,
    noFit: result.noFit,
    skipped: result.skippedCount,
    activated: updated.added.length,
    withheld: updated.withheld.length,
    allocation: allocation ? {
      runId: allocation.runId,
      artifactDirectory: allocation.artifactDirectory,
      atomsWithSenseLinks: allocation.atomsWithSenseLinks,
      atomsWithDirectCandidatesUnlinked: allocation.atomsWithDirectCandidatesUnlinked
    } : null,
    queueBefore: queueState,
    queueAfter: queueBusyState(queueAfter)
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runWordNetAtomSenseSweep().then((result) => {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }).catch((error) => {
    process.stderr.write(`${error?.message ?? String(error)}\n`);
    process.exitCode = 1;
  });
}
