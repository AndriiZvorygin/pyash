import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, remember } from "../program/remember/index.mjs";
import { builtInSignatures } from "../program/verbs/index.mjs";
import { registerSignatureHandler, clearSignatureHandlers } from "../program/bridge/signature.mjs";
import { resolveConfigText } from "../program/configure/env.mjs";
import { createGpuHousekeeperAdapter } from "../program/runtime/gpu/housekeeper_adapter.mjs";
import {
  createDefaultQueuedMindEnglishWordNetSenseLinkSubmitter,
  loadEnglishWordNetLinkerConfig
} from "../program/library/translation/english_wordnet_linker.mjs";
import { buildEnglishWordNetSenseLinkInventory } from "../program/library/translation/english_wordnet_linker.mjs";
import {
  activateEnglishWordNetModelSweepLinks,
  ENGLISH_WORDNET_MODEL_SWEEP_PROMPT_VERSION,
  persistEnglishWordNetModelSweepCatalog,
  runEnglishWordNetModelSweep,
  selectEnglishWordNetModelSweepPilotRecords
} from "../program/library/translation/english_wordnet_model_sweep.mjs";
import { ENGLISH_WORDNET_BRIDGE_CONFIG_URL } from "../program/library/translation/english_wordnet_bridges.mjs";
import { runWordNetSenseSweep } from "./wordnet_sense_sweep.mjs";
import { loadDefaultConfig } from "./run_pya_helpers.mjs";
import { awaitTranslationGpuDuty } from "../program/library/translation/translation_to_vliw_job.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ARTIFACT_ROOT = path.join(ROOT, "artifacts");

function sha256(value) {
  return createHash("sha256").update(String(value ?? "")).digest("hex");
}

function safeName(value) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "");
}

async function initializeRuntime() {
  forget();
  clearSignatureHandlers();
  for (const signature of builtInSignatures) registerSignatureHandler(signature);
  await loadDefaultConfig({ cwd: ROOT, interpretFn: interpret, entryPath: ROOT });
}

function queueBusyState(queue) {
  const rows = Array.isArray(queue?.jobs) ? queue.jobs : Array.isArray(queue?.items) ? queue.items : [];
  const queued = Number(queue?.queueDepth ?? queue?.depth ?? rows.length);
  const running = Number(queue?.runningCount ?? queue?.activeCount ?? queue?.runningJobs?.length ?? 0);
  return { queued: Number.isFinite(queued) ? queued : rows.length, running: Number.isFinite(running) ? running : 0 };
}

async function atomicWrite(filename, contents) {
  await mkdir(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.${process.pid}.tmp`;
  await rm(temporary, { force: true });
  await writeFile(temporary, contents, "utf8");
  await rename(temporary, filename);
}

function renderActivationPya({ runId, model, sourceHash, mode, catalogUpdated, activated = [], wouldActivate = [], skipped = [] } = {}) {
  return [
    "su name translation_english_wordnet_model_sweep_activation be map def",
    'su text "format" ob text "english-wordnet-model-sweep-activation-v1" ya',
    `su text "run-id" ob text ${JSON.stringify(runId)} ya`,
    `su text "model" ob text ${JSON.stringify(model)} ya`,
    `su text "mode" ob text ${JSON.stringify(mode)} ya`,
    `su text "source-hash" ob text ${JSON.stringify(sourceHash)} ya`,
    `su text "catalog-updated" ob text ${JSON.stringify(catalogUpdated ? "true" : "false")} ya`,
    `su text "activated-senses" ob text quoted.text.${JSON.stringify(activated, null, 2)}.text.quoted ya`,
    `su text "would-activate-senses" ob text quoted.text.${JSON.stringify(wouldActivate, null, 2)}.text.quoted ya`,
    `su text "skipped" ob text quoted.text.${JSON.stringify(skipped, null, 2)}.text.quoted ya`,
    "prah",
    ""
  ].join("\n");
}

export async function runWordNetSenseLinkSweep() {
  if (process.env.PYA_MIND_RESPONSE) {
    throw new Error("WordNet model sweep requires PYA_MIND_RESPONSE to be unset");
  }
  await initializeRuntime();
  const housekeeperUrl = String(
    process.env.PYA_GPU_HOUSEKEEPER_URL
      ?? resolveConfigText("gpu housekeeper url", { rememberFn: remember })
      ?? ""
  ).trim();
  if (!housekeeperUrl) throw new Error("WordNet model sweep requires the configured GPU Housekeeper URL");

  const [config, sweep] = await Promise.all([
    loadEnglishWordNetLinkerConfig(),
    runWordNetSenseSweep({ includeRecords: true })
  ]);
  const housekeeper = createGpuHousekeeperAdapter({ baseUrl: housekeeperUrl });
  const [queue, availableModels] = await Promise.all([
    housekeeper.getQueue(),
    housekeeper.getOllamaModels()
  ]);
  const queueState = queueBusyState(queue);
  if (queueState.queued > 0 || queueState.running > 0) {
    throw new Error(`WordNet model sweep requires an idle Housekeeper queue; queued=${queueState.queued}, running=${queueState.running}`);
  }
  const modelRows = Array.isArray(availableModels) ? availableModels : availableModels?.models ?? [];
  const modelAvailable = modelRows.some((row) => (
    String(typeof row === "string" ? row : row?.name ?? row?.model ?? "").trim() === config.model
  ));
  if (!modelAvailable) throw new Error(`configured Housekeeper does not advertise model ${config.model}`);

  const eligible = sweep.records.filter((record) => record.category === "needs-sense-choice");
  if (!["pilot", "full"].includes(config.modelSweepMode)) {
    throw new Error(`unsupported WordNet model sweep mode ${config.modelSweepMode}`);
  }
  const pilotRecords = selectEnglishWordNetModelSweepPilotRecords(eligible, config.modelSweepPilotLimit, {
    rankForEnglish: sweep.rankForEnglish,
    maxMultipleChoice: config.modelSweepPilotMultipleChoiceLimit
  });
  const pilotIds = new Set(pilotRecords.map((record) => record.id));
  const pending = config.modelSweepMode === "pilot"
    ? pilotRecords
    : [
      ...pilotRecords,
      ...eligible.filter((record) => (
        record.candidates?.some((candidate) => candidate?.selectable === true)
          && !pilotIds.has(record.id)
      ))
    ];
  const inventory = buildEnglishWordNetSenseLinkInventory({
    records: pending,
    baseInventory: { entries: [], grammar: [] }
  });
  const runId = `${sweep.runId}-model-${safeName(config.model)}-${ENGLISH_WORDNET_MODEL_SWEEP_PROMPT_VERSION}`;
  const artifactDirectory = path.join(sweep.directory, `model-${safeName(config.model)}-${ENGLISH_WORDNET_MODEL_SWEEP_PROMPT_VERSION}`);
  const submit = await createDefaultQueuedMindEnglishWordNetSenseLinkSubmitter({ model: config.model });
  const catalogPath = fileURLToPath(ENGLISH_WORDNET_BRIDGE_CONFIG_URL);
  const catalogSource = await readFile(catalogPath, "utf8");
  const expectedCatalogHash = sha256(catalogSource);

  const result = await runEnglishWordNetModelSweep({
    records: pending,
    inventory,
    sourceHash: sweep.sourceHash,
    coverageHash: sweep.coverageHash,
    runId,
    model: config.model,
    artifactDirectory,
    maxDutySenses: config.maxDutySenses,
    maxChars: config.promptMaxChars,
    maxTokens: config.promptMaxTokens,
    maxOutputTokens: config.maxOutputTokens,
    rankForEnglish: sweep.rankForEnglish,
    submit,
    awaitHandle: awaitTranslationGpuDuty,
    onBatch: ({ batchIndex, batchCount, reused, records }) => {
      if (batchIndex === 1 || batchIndex % 10 === 0 || batchIndex === batchCount) {
        const count = records.reduce((total, record) => total + Number(record.status === "accepted-llm"), 0);
        process.stderr.write(`[wordnet-link-sweep] ${batchIndex}/${batchCount} ${reused ? "reused" : "completed"}; accepted=${count}\n`);
      }
    }
  });

  const activation = config.modelSweepMode === "pilot"
    ? activateEnglishWordNetModelSweepLinks({
      catalogSource,
      records: result.records,
      runId,
      sourceHash: sweep.sourceHash,
      model: config.model,
      resolveTarget: sweep.resolveWord
    })
    : await persistEnglishWordNetModelSweepCatalog({
      catalogPath,
      catalogSource,
      expectedCatalogHash,
      records: result.records,
      runId,
      sourceHash: sweep.sourceHash,
      model: config.model,
      resolveTarget: sweep.resolveWord
    });
  await atomicWrite(path.join(artifactDirectory, "activation.pya"), renderActivationPya({
    runId,
    model: config.model,
    mode: config.modelSweepMode,
    catalogUpdated: config.modelSweepMode === "full",
    sourceHash: sweep.sourceHash,
    activated: config.modelSweepMode === "full" ? activation.activated : [],
    wouldActivate: activation.activated,
    skipped: activation.skipped
  }));
  return {
    runId,
    artifactDirectory,
    manifest: result.manifest,
    model: config.model,
    mode: config.modelSweepMode,
    housekeeperHost: new URL(housekeeperUrl).host,
    eligibleSenseCount: eligible.length,
    sourceSenseCount: result.recordCount,
    modelDecisions: result.counts,
    activated: config.modelSweepMode === "full" ? activation.activated.length : 0,
    wouldActivate: activation.activated.length,
    skipped: activation.skipped.length,
    activeCatalogEntries: activation.totalCatalogEntries
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runWordNetSenseLinkSweep().then((result) => {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }).catch((error) => {
    process.stderr.write(`${error?.message ?? String(error)}\n`);
    process.exitCode = 1;
  });
}
