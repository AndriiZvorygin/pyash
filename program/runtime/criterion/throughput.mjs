import fs from "node:fs/promises";
import path from "node:path";

import { collectMachineMetadata } from "./machine.mjs";
import { aggregateSampleResults, ollamaTiming, sha256, stableJson, tokenize } from "./metrics.mjs";
import { writeRunArtifacts } from "./report.mjs";

export const THROUGHPUT_BENCHMARK_VERSION = "warm-throughput-v1";
export const THROUGHPUT_PROFILE = Object.freeze({
  name: "summary_direct",
  contextLength: 32768,
  temperature: 0.2,
  top_p: 0.8,
  top_k: 20,
  think: false,
  num_predict: 256,
  keep_alive: 1800
});

export const THROUGHPUT_PROMPTS = Object.freeze([
  { id: "speed-001", prompt: "Write a numbered list of 80 distinct, concrete observations about designing reliable software. Each item is one complete sentence of 8 to 14 words. Continue directly with the list, without a preface or conclusion." },
  { id: "speed-002", prompt: "Write a numbered list of 80 distinct, concrete observations about maintaining public transportation. Each item is one complete sentence of 8 to 14 words. Continue directly with the list, without a preface or conclusion." },
  { id: "speed-003", prompt: "Write a numbered list of 80 distinct, concrete observations about planning resilient neighbourhoods. Each item is one complete sentence of 8 to 14 words. Continue directly with the list, without a preface or conclusion." },
  { id: "speed-004", prompt: "Write a numbered list of 80 distinct, concrete observations about scientific field research. Each item is one complete sentence of 8 to 14 words. Continue directly with the list, without a preface or conclusion." },
  { id: "speed-005", prompt: "Write a numbered list of 80 distinct, concrete observations about operating a small business. Each item is one complete sentence of 8 to 14 words. Continue directly with the list, without a preface or conclusion." }
]);

export const THROUGHPUT_PROMPT_SET_HASH = sha256(stableJson(THROUGHPUT_PROMPTS.map(({ id, prompt }) => ({ id, promptHash: sha256(prompt) }))));

export async function inspectThroughputTargetQueue({ housekeeperUrl, hostId, fetchImpl = globalThis.fetch } = {}) {
  const baseUrl = String(housekeeperUrl ?? "").replace(/\/+$/u, "");
  if (!baseUrl || !hostId) throw new Error("throughput preflight requires the Housekeeper URL and target host id");
  let snapshotResponse;
  try {
    snapshotResponse = await fetchImpl(`${baseUrl}/snapshot`, { signal: AbortSignal.timeout(3000) });
  } catch (error) {
    throw new Error(`could not verify target-host Housekeeper snapshot before throughput run: ${error.message}`);
  }
  if (!snapshotResponse.ok) throw new Error(`could not verify target-host Housekeeper snapshot before throughput run: HTTP ${snapshotResponse.status}`);
  const snapshot = await snapshotResponse.json();
  if (snapshot?.hostId !== hostId) throw new Error(`Housekeeper snapshot host mismatch: expected ${hostId}, received ${snapshot?.hostId ?? "unknown"}`);
  const slotJobs = (snapshot.executionSlots ?? []).flatMap(slot => (slot.jobs ?? [])
    .filter(job => ["queued", "running"].includes(String(job?.status ?? "").toLowerCase()))
    .map(job => ({
      id: job.remoteJobId ?? job.handleId ?? "unknown",
      deviceId: slot.deviceId ?? "",
      status: String(job.status).toLowerCase()
    })));

  let queueResponse;
  try {
    queueResponse = await fetchImpl(`${baseUrl}/queue`, { signal: AbortSignal.timeout(3000) });
  } catch (error) {
    throw new Error(`could not verify Housekeeper queue before throughput run: ${error.message}`);
  }
  if (!queueResponse.ok) throw new Error(`could not verify Housekeeper queue before throughput run: HTTP ${queueResponse.status}`);
  const queue = await queueResponse.json();
  if (!Array.isArray(queue?.jobs)) throw new Error("Housekeeper queue response did not include a jobs list; refusing an unverified speed run");
  const active = queue.jobs.filter(job => ["queued", "running"].includes(String(job?.status ?? "").toLowerCase()));
  const targetJobs = active.filter(job => {
    const executionHost = job.executionHostId ?? job.route?.executionHostId;
    return executionHost === hostId || (!executionHost && job.forwarded !== true);
  });
  const targetJobIds = [...new Set([
    ...slotJobs.map(job => job.id),
    ...targetJobs.map(job => job.remoteJobId ?? job.handleId ?? "unknown")
  ])];
  return {
    hostId,
    checkedAt: new Date().toISOString(),
    localExecutionSlotBusy: snapshot.executionSlotBusy === true || slotJobs.length > 0,
    targetActiveJobCount: targetJobIds.length,
    targetActiveJobIds: targetJobIds,
    queueDepth: queue.queueDepth ?? null,
    queuedCount: queue.queuedCount ?? null,
    runningCount: queue.runningCount ?? null,
    softQueueCap: queue.softQueueCap ?? null,
    queueOverSoftCap: queue.queueOverSoftCap ?? null,
    activeJobsObserved: active.length,
    forwardedElsewhere: active.filter(job => {
      const executionHost = job.executionHostId ?? job.route?.executionHostId;
      return (executionHost && executionHost !== hostId) || job.forwarded === true;
    }).length
  };
}

function makeRunId(now, model) {
  const stamp = now().toISOString().replace(/[-:.TZ]/gu, "").slice(0, 14);
  const modelHash = sha256(model).slice(0, 8);
  return `throughput-${stamp}-${modelHash}`;
}

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function toMeasuredRow({ runId, model, modelInfo, sample, response, startedAt, now }) {
  const payload = response?.payload ?? {};
  const timing = response?.timing ?? ollamaTiming(payload, startedAt, now().toISOString());
  return {
    runId,
    benchmark: "model-throughput",
    model,
    engine: "ollama",
    modelDigest: modelInfo?.modelDigest ?? null,
    quantization: modelInfo?.quantization ?? null,
    profile: THROUGHPUT_PROFILE.name,
    promptVariant: THROUGHPUT_BENCHMARK_VERSION,
    promptTemplateHash: THROUGHPUT_PROMPT_SET_HASH,
    contextLength: THROUGHPUT_PROFILE.contextLength,
    effectiveThink: false,
    reasoningMode: "direct",
    sampleId: sample.id,
    inputHash: sha256(sample.prompt),
    promptHash: sha256(sample.prompt),
    promptText: sample.prompt,
    inputTokens: tokenize(sample.prompt).length,
    startedAt,
    finishedAt: response?.finishedAt ?? now().toISOString(),
    status: "ok",
    output: String(response?.text ?? ""),
    outputHash: sha256(response?.text ?? ""),
    timingRaw: {
      prompt_eval_count: payload.prompt_eval_count ?? null,
      prompt_eval_duration: payload.prompt_eval_duration ?? null,
      eval_count: payload.eval_count ?? null,
      eval_duration: payload.eval_duration ?? null,
      total_duration: payload.total_duration ?? null
    },
    metrics: {
      ...timing,
      outputTokens: finite(payload.eval_count) ?? timing.outputTokens ?? null,
      generationTokensPerSecond: timing.generationTokensPerSecond ?? null
    },
    metadata: { benchmarkVersion: THROUGHPUT_BENCHMARK_VERSION, warmup: false },
    provenance: {
      benchmark: "model-throughput",
      promptSetHash: THROUGHPUT_PROMPT_SET_HASH,
      sampleId: sample.id,
      promptHash: sha256(sample.prompt)
    },
    scores: {},
    pass: null
  };
}

function aggregateThroughput(rows) {
  const successful = rows.filter(row => row.status === "ok");
  const speeds = successful.map(row => row.metrics.generationTokensPerSecond).filter(Number.isFinite);
  const tokenTotal = successful.reduce((sum, row) => sum + (finite(row.timingRaw.eval_count) ?? 0), 0);
  const durationNs = successful.reduce((sum, row) => sum + (finite(row.timingRaw.eval_duration) ?? 0), 0);
  const base = aggregateSampleResults(rows);
  return {
    ...base,
    arithmeticMeanTokensPerSecond: speeds.length ? speeds.reduce((sum, value) => sum + value, 0) / speeds.length : null,
    weightedTokensPerSecond: durationNs > 0 ? tokenTotal / (durationNs / 1e9) : null,
    measuredOutputTokens: tokenTotal,
    measuredGenerationMs: durationNs > 0 ? durationNs / 1e6 : null
  };
}

async function persistCheckpoint(root, runId, rows) {
  const filepath = path.resolve(root, "criterion", "results", `${runId}.jsonl`);
  await fs.mkdir(path.dirname(filepath), { recursive: true });
  await fs.writeFile(filepath, rows.map(row => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : ""), "utf8");
}

export async function runThroughputBenchmark({
  model,
  executor,
  metadataProvider,
  root = process.cwd(),
  runId = null,
  hostId,
  gpuId = "gpu-0",
  machine,
  hostQueueCheck = null,
  now = () => new Date(),
  onEvent = null
} = {}) {
  const selectedModel = String(model ?? "").trim();
  if (!selectedModel) throw new Error("criterion throughput requires exactly one --model");
  if (!hostId) throw new Error("criterion throughput requires a pinned --host-id");
  if (typeof executor !== "function") throw new Error("criterion throughput requires an Ollama executor");

  const id = String(runId ?? makeRunId(now, selectedModel));
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/u.test(id)) throw new Error(`invalid Criterion run id: ${id}`);
  const modelInfo = typeof metadataProvider === "function" ? await metadataProvider({ model: selectedModel }) : { model: selectedModel };
  if (!modelInfo?.modelDigest) throw new Error(`model is not verified as installed in the Housekeeper catalog: ${selectedModel}`);

  const settings = {
    temperature: THROUGHPUT_PROFILE.temperature,
    top_p: THROUGHPUT_PROFILE.top_p,
    top_k: THROUGHPUT_PROFILE.top_k,
    num_predict: THROUGHPUT_PROFILE.num_predict,
    keep_alive: THROUGHPUT_PROFILE.keep_alive,
    think: THROUGHPUT_PROFILE.think
  };
  const invoke = (prompt, numPredict, identity) => executor({
    model: selectedModel,
    prompt,
    profile: THROUGHPUT_PROFILE.name,
    contextLength: THROUGHPUT_PROFILE.contextLength,
    sampling: { ...settings, num_predict: numPredict },
    identity
  });

  const warmupStart = now().toISOString();
  onEvent?.({ event: "warmup-started", kind: "short-ping", runId: id, model: selectedModel });
  const ping = await invoke("Reply with exactly: READY.", 2, `${id}-warmup-ping`);
  onEvent?.({ event: "warmup-completed", kind: "short-ping", runId: id, model: selectedModel });
  onEvent?.({ event: "warmup-started", kind: "first-prompt-replay", runId: id, model: selectedModel });
  const warmupFirstSample = await invoke(THROUGHPUT_PROMPTS[0].prompt, THROUGHPUT_PROFILE.num_predict, `${id}-warmup-sample`);
  onEvent?.({ event: "warmup-completed", kind: "first-prompt-replay", runId: id, model: selectedModel });
  const warmups = [
    { kind: "short-ping", response: ping },
    { kind: "first-prompt-replay", response: warmupFirstSample }
  ].map(({ kind, response }, index) => ({
    index: index + 1,
    kind,
    excluded: true,
    outputTokens: finite(response?.payload?.eval_count),
    generationMs: finite(response?.payload?.eval_duration) === null ? null : Number(response.payload.eval_duration) / 1e6
  }));

  const results = [];
  for (const sample of THROUGHPUT_PROMPTS) {
    const startedAt = now().toISOString();
    try {
      const response = await invoke(sample.prompt, THROUGHPUT_PROFILE.num_predict, `${id}-${sample.id}`);
      results.push(toMeasuredRow({ runId: id, model: selectedModel, modelInfo, sample, response, startedAt, now }));
    } catch (error) {
      results.push({
        runId: id,
        benchmark: "model-throughput",
        model: selectedModel,
        engine: "ollama",
        profile: THROUGHPUT_PROFILE.name,
        promptVariant: THROUGHPUT_BENCHMARK_VERSION,
        contextLength: THROUGHPUT_PROFILE.contextLength,
        sampleId: sample.id,
        promptHash: sha256(sample.prompt),
        promptText: sample.prompt,
        status: "error",
        error: String(error?.message ?? error),
        errorMetadata: error?.request ?? null,
        metrics: {},
        timingRaw: {},
        metadata: { benchmarkVersion: THROUGHPUT_BENCHMARK_VERSION, warmup: false },
        startedAt,
        finishedAt: now().toISOString()
      });
    }
    await persistCheckpoint(root, id, results);
    onEvent?.({ event: "sample-completed", runId: id, model: selectedModel, sampleId: sample.id, status: results.at(-1).status, generationTokensPerSecond: results.at(-1).metrics?.generationTokensPerSecond ?? null });
  }

  const finishedAt = now().toISOString();
  const aggregate = aggregateThroughput(results);
  const run = await writeRunArtifacts({
    runId: id,
    criterion: "model-throughput",
    evaluationMode: "warm-throughput",
    suite: { name: "Warm model generation throughput", version: THROUGHPUT_BENCHMARK_VERSION, sourceUrls: [], licenseUrls: [], key: "model-throughput" },
    status: results.some(row => row.status === "error") ? "partial" : "completed",
    split: "fixed-prompt-set",
    actualSplit: "fixed-prompt-set",
    availableSplits: [],
    datasetRevision: THROUGHPUT_BENCHMARK_VERSION,
    datasetHash: THROUGHPUT_PROMPT_SET_HASH,
    models: [selectedModel],
    engine: "ollama",
    profile: THROUGHPUT_PROFILE.name,
    contextLength: THROUGHPUT_PROFILE.contextLength,
    sampling: settings,
    machine: machine ?? await collectMachineMetadata(),
    mode: "warm-throughput",
    smoke: false,
    runScope: "standard",
    createdAt: warmupStart,
    startedAt: warmupStart,
    finishedAt,
    totalWallClockMs: Math.max(0, new Date(finishedAt).getTime() - new Date(warmupStart).getTime()),
    replayCommand: `node command/criterion.mjs throughput --model ${JSON.stringify(selectedModel)} --host-id ${JSON.stringify(hostId)} --gpu-id ${JSON.stringify(gpuId)} --run-id ${id}`,
    throughput: {
      version: THROUGHPUT_BENCHMARK_VERSION,
      promptSetHash: THROUGHPUT_PROMPT_SET_HASH,
      promptCount: THROUGHPUT_PROMPTS.length,
      prompts: THROUGHPUT_PROMPTS,
      warmups,
      modelRetained: true,
      modelWarmAtMeasurementStart: true,
      hostId,
      gpuId,
      hostQueueCheck,
      measurement: "Ollama eval_count / eval_duration; generation only",
      aggregate
    },
    results,
    aggregates: [{ model: selectedModel, modelMetadata: modelInfo, aggregate }],
    modelMetadata: { [selectedModel]: modelInfo }
  }, { root });
  return run;
}
