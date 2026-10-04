import crypto from "node:crypto";
import path from "node:path";

import { enqueueInputEnvelope } from "../gpu/queue.mjs";
import { runGpuWorkerOnce } from "../gpu/worker.mjs";
import { isTerminalHandleStatus, readGpuHandleStatus, writeGpuHandleStatus } from "../gpu/handle_status.mjs";
import { ollamaTiming, stripThinking } from "./metrics.mjs";

export function resolveOllamaBaseUrl(baseUrl = null, env = process.env) {
  return String(baseUrl ?? env.OLLAMA_BASE_URL ?? env.OLLAMA_HOST ?? "http://localhost:11434").replace(/\/$/u, "");
}

export const DEFAULT_PROFILES = Object.freeze({
  baseline: Object.freeze({ think: false, reasoningMode: "deterministic", temperature: null, top_p: null, top_k: null, contextLength: null }),
  summary_direct: Object.freeze({ think: false, reasoningMode: "direct", temperature: 0.2, top_p: 0.8, top_k: 20, contextLength: 32768 }),
  summary_reasoned: Object.freeze({ think: true, reasoningMode: "reasoned", temperature: 0.6, top_p: 0.95, top_k: 20, contextLength: 32768 }),
  summary_reasoned_hidden: Object.freeze({ think: true, reasoningMode: "reasoned-hidden", temperature: 0.6, top_p: 0.95, top_k: 20, contextLength: 32768 }),
  // Keep the original name readable for existing runs and callers.
  reasoning: Object.freeze({ think: true, reasoningMode: "reasoned", temperature: 0.6, top_p: 0.95, top_k: 20, contextLength: 32768 })
});

export function resolveProfile(name = "summary_direct", overrides = {}) {
  const base = DEFAULT_PROFILES[name] ?? DEFAULT_PROFILES.summary_direct;
  return {
    ...base,
    ...overrides,
    contextLength: overrides.contextLength === null || base.contextLength === null
      ? (overrides.contextLength === null ? null : base.contextLength)
      : Number(overrides.contextLength ?? base.contextLength)
  };
}

function responseError(response, endpoint) {
  const error = new Error(`ollama request failed at ${endpoint}: ${response.status} ${response.statusText ?? ""}`.trim());
  error.status = response.status;
  return error;
}

export function isTransientOllamaError(error) {
  const status = Number(error?.status);
  if ([429, 502, 503, 504].includes(status)) return true;
  const message = String(error?.message ?? error ?? "");
  return /fetch failed|network|timed? ?out|ECONNRESET|ECONNREFUSED|ECONNABORTED|ETIMEDOUT|EPIPE|socket hang up|aborted/iu.test(message);
}

function requestSignal(parentSignal, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error("Ollama request timeout")), Math.max(1, Number(timeoutMs) || 120000));
  const abort = () => controller.abort(parentSignal.reason);
  if (parentSignal) {
    if (parentSignal.aborted) abort();
    else parentSignal.addEventListener("abort", abort, { once: true });
  }
  return {
    signal: controller.signal,
    clear() {
      clearTimeout(timeout);
      parentSignal?.removeEventListener?.("abort", abort);
    }
  };
}

async function fetchJson(url, options, fetchImpl) {
  const response = await fetchImpl(url, options);
  if (!response.ok) throw responseError(response, url);
  return response.json();
}

export async function runOllamaChat({
  model,
  prompt,
  profile = "summary_direct",
  contextLength,
  sampling = {},
  baseUrl,
  fetchImpl = globalThis.fetch,
  now = () => Date.now(),
  signal,
  requestTimeoutMs = Number(process.env.PYA_CRITERION_OLLAMA_TIMEOUT_MS || 180000),
  maxRetries = Number(process.env.PYA_CRITERION_OLLAMA_RETRIES || 2),
  retryBaseMs = Number(process.env.PYA_CRITERION_OLLAMA_RETRY_BASE_MS || 750)
} = {}) {
  if (typeof fetchImpl !== "function") throw new Error("Ollama benchmark requires fetch");
  if (!model) throw new Error("Ollama benchmark requires a model");
  const settings = resolveProfile(profile, { ...sampling, contextLength });
  const endpoint = `${resolveOllamaBaseUrl(baseUrl)}/api/chat`;
  const attempts = [];
  const retryLimit = Math.max(0, Math.trunc(Number(maxRetries) || 0));
  for (let attempt = 0; attempt <= retryLimit; attempt += 1) {
    const startedAt = new Date(now()).toISOString();
    const request = requestSignal(signal, requestTimeoutMs);
    try {
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: request.signal,
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: String(prompt ?? "") }],
          stream: false,
          think: settings.think,
          ...(settings.format === undefined ? {} : { format: settings.format }),
          options: {
            temperature: settings.temperature,
            top_p: settings.top_p,
            top_k: settings.top_k,
            num_ctx: settings.contextLength,
            ...(settings.repeat_penalty === undefined ? {} : { repeat_penalty: settings.repeat_penalty }),
            ...(settings.num_predict === undefined ? {} : { num_predict: settings.num_predict })
          }
        })
      });
      if (!response.ok) throw responseError(response, "/api/chat");
      const payload = await response.json();
      if (payload.error) throw new Error(`ollama request error: ${payload.error}`);
      const finishedAt = new Date(now()).toISOString();
      const rawText = payload.message?.content ?? payload.response ?? "";
      attempts.push({ attempt: attempt + 1, status: response.status, error: null });
      return {
        text: stripThinking(rawText),
        thinking: payload.message?.thinking ?? payload.thinking ?? "",
        payload,
        timing: { ...ollamaTiming(payload, startedAt, finishedAt), requestAttempts: attempt + 1, transportRetries: attempt },
        request: { endpoint, model, attempts, retries: attempt },
        effectiveThink: settings.think,
        reasoningMode: settings.reasoningMode,
        startedAt,
        finishedAt
      };
    } catch (error) {
      attempts.push({ attempt: attempt + 1, status: Number(error?.status) || null, error: String(error?.message ?? error) });
      if (!isTransientOllamaError(error) || attempt >= retryLimit) {
        error.request = { endpoint, model, attempts, retries: attempt };
        throw error;
      }
      await new Promise(resolve => setTimeout(resolve, Math.max(0, Number(retryBaseMs) || 0) * (2 ** attempt)));
    } finally {
      request.clear();
    }
  }
  throw new Error("Ollama request exhausted without a terminal result");
}

function queuedHandleId({ runId, model, operation, requestId, prompt }) {
  return `criterion-ollama-${crypto.createHash("sha256")
    .update(`${runId}\u0000${model}\u0000${operation}\u0000${requestId || prompt || Date.now()}`)
    .digest("hex")
    .slice(0, 24)}`;
}

function parseQueuedResult(status) {
  if (status?.result && typeof status.result === "object") return status.result;
  try {
    const value = JSON.parse(String(status?.result ?? ""));
    return value && typeof value === "object" ? value : {};
  } catch {
    throw new Error(`queued Ollama result was not JSON: ${String(status?.result ?? "").slice(0, 300)}`);
  }
}

async function waitForQueuedOllama({
  worldRoot,
  handleId,
  housekeeperUrl,
  gpuId,
  workerRunner,
  readStatus,
  timeoutMs,
  pollMs,
  workerTag
}) {
  const deadline = Date.now() + timeoutMs;
  const workerMaxPolls = Math.max(1200, Math.ceil(timeoutMs / 250) + 1);
  while (Date.now() <= deadline) {
    const status = await readStatus(worldRoot, handleId);
    if (status && isTerminalHandleStatus(status.status)) {
      if (status.status === "success") return parseQueuedResult(status);
      throw new Error(status.error || status.message || "queued Ollama job failed");
    }
    await workerRunner({
      worldRoot,
      housekeeperUrl,
      workerTag,
      owner: workerTag,
      gpuId,
      lane: "durable",
      pollIntervalMs: 250,
      maxPolls: workerMaxPolls,
      leaseTtlMs: timeoutMs + 60000
    });
    await new Promise(resolve => setTimeout(resolve, Math.max(1, Number(pollMs) || 100)));
  }
  throw new Error(`queued Ollama job timed out waiting for ${handleId}`);
}

/**
 * Route non-streaming Criterion Ollama calls through Pyash's durable GPU lane.
 * The remote housekeeper owns runtime admission, residency switching and
 * provider discharge; Criterion only receives the completed Ollama payload.
 */
export function createQueuedOllamaExecutor({
  root = process.cwd(),
  runId = "criterion",
  housekeeperUrl = process.env.PYA_GPU_HOUSEKEEPER_URL ?? "",
  gpuId = process.env.PYA_CRITERION_GPU_ID ?? process.env.PYA_GPU_ID ?? "gpu-0",
  hostId = process.env.PYA_GPU_HOST_ID ?? "",
  timeoutMs = Number(process.env.PYA_CRITERION_OLLAMA_TIMEOUT_MS || 900000),
  pollMs = 100,
  workerRunner = runGpuWorkerOnce,
  readStatus = readGpuHandleStatus,
  writeStatus = writeGpuHandleStatus,
  enqueue = enqueueInputEnvelope,
  vramRequiredMb = null,
  now = () => new Date()
} = {}) {
  const worldRoot = path.resolve(root, "world");
  const normalizedHousekeeperUrl = String(housekeeperUrl ?? "").trim();
  if (!normalizedHousekeeperUrl) throw new Error("queued Ollama execution requires PYA_GPU_HOUSEKEEPER_URL");
  const normalizedGpuId = String(gpuId || "gpu-0").trim() || "gpu-0";
  const normalizedTimeout = Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) > 0 ? Math.trunc(Number(timeoutMs)) : 900000;
  const normalizedVram = Number(vramRequiredMb) > 0 ? Math.trunc(Number(vramRequiredMb)) : null;

  async function submit({ model, prompt = "", profile = "summary_direct", contextLength, sampling = {}, identity = "", operation = "generate", kind = "ollama-chat" }) {
    const settings = resolveProfile(profile, { ...sampling, contextLength });
    const handleId = queuedHandleId({ runId, model, operation, requestId: identity, prompt });
    const queuedAt = now().toISOString();
    const startedAt = Date.now();
    const options = {
      temperature: settings.temperature,
      top_p: settings.top_p,
      top_k: settings.top_k,
      num_ctx: settings.contextLength,
      ...(settings.repeat_penalty === undefined ? {} : { repeat_penalty: settings.repeat_penalty }),
      ...(settings.num_predict === undefined ? {} : { num_predict: settings.num_predict })
    };
    const payload = kind === "ollama-generate"
      ? { model, prompt: String(prompt ?? ""), stream: false, keep_alive: sampling.keep_alive ?? 300, options }
      : {
        model,
        messages: [{ role: "user", content: String(prompt ?? "") }],
        stream: false,
        think: settings.think,
        ...(settings.format === undefined ? {} : { format: settings.format }),
        options
      };
    const requestResource = Number(sampling.vramRequiredMb ?? normalizedVram) > 0
      ? { vramRequiredMb: Math.trunc(Number(sampling.vramRequiredMb ?? normalizedVram)) }
      : null;
    await writeStatus(worldRoot, handleId, {
      status: "queued",
      agentName: "criterion-ollama",
      gpuId: normalizedGpuId,
      intent: "criterion",
      lane: "durable",
      queuedAt,
      startedAt: "",
      finishedAt: "",
      retryCount: 0,
      outcome: "queued",
      message: "queued",
      result: "",
      error: ""
    });
    await enqueue(worldRoot, {
      queuedAt,
      handleId,
      agentName: "criterion-ollama",
      gpuId: normalizedGpuId,
      hostId,
      intent: "criterion",
      lane: "durable",
      payloadSentence: { mood: "do", be: "gpu criterion", ob: { text: `${model}: ${operation}` }, as: { name: "ollama" } },
      serviceName: "ollama",
      residencyName: model,
      residencyRequired: true,
      beginRequired: true,
      dischargeAllowed: true,
      jobSpec: {
        kind,
        ...(requestResource ? { resourceRequest: requestResource } : {}),
        payload
      }
    });
    const response = await waitForQueuedOllama({
      worldRoot,
      handleId,
      housekeeperUrl: normalizedHousekeeperUrl,
      gpuId: normalizedGpuId,
      workerRunner,
      readStatus,
      timeoutMs: normalizedTimeout,
      pollMs,
      workerTag: `criterion-ollama-${process.pid}`
    });
    const finishedAt = now().toISOString();
    const rawText = response.message?.content ?? response.response ?? "";
    return {
      text: stripThinking(rawText),
      thinking: response.message?.thinking ?? response.thinking ?? "",
      payload: response,
      timing: { ...ollamaTiming(response, new Date(startedAt).toISOString(), finishedAt), queueManaged: true },
      request: { endpoint: `${normalizedHousekeeperUrl.replace(/\/$/u, "")}/submit`, model, operation, handleId },
      effectiveThink: settings.think,
      reasoningMode: settings.reasoningMode,
      startedAt: new Date(startedAt).toISOString(),
      finishedAt,
      metadata: {
        engine: "ollama",
        managedBy: "gpu-housekeeper",
        housekeeperUrl: normalizedHousekeeperUrl,
        gpuId: normalizedGpuId,
        resourceRequest: requestResource
      }
    };
  }

  const executor = input => submit({ ...input, kind: "ollama-chat" });
  const dischargeModel = async model => submit({
    model,
    prompt: "",
    profile: "baseline",
    sampling: { keep_alive: 0, num_predict: 1 },
    identity: `discharge-${Date.now()}`,
    operation: "discharge",
    kind: "ollama-generate"
  });
  const dischargeModels = async models => {
    const results = [];
    for (const model of models ?? []) {
      try {
        await dischargeModel(model);
        results.push({ model, status: "ok" });
      } catch (error) {
        results.push({ model, status: "failed", error: String(error?.message ?? error) });
      }
    }
    return { status: results.every(result => result.status === "ok") ? "ok" : "partial", results, verifiedByHousekeeper: true };
  };
  return { executor, dischargeModel, dischargeModels, metadataProvider: async ({ model, baseUrl, fetchImpl }) => readOllamaMetadata({ model, baseUrl, fetchImpl }) };
}

export async function readOllamaMetadata({ model, baseUrl, fetchImpl = globalThis.fetch } = {}) {
  const base = resolveOllamaBaseUrl(baseUrl);
  const out = { model, ollamaVersion: null, modelDigest: null, quantization: null };
  try {
    const version = await fetchJson(`${base}/api/version`, {}, fetchImpl);
    out.ollamaVersion = version.version ?? null;
  } catch { /* metadata is diagnostic; benchmark execution remains useful */ }
  try {
    const details = await fetchJson(`${base}/api/show`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: model })
    }, fetchImpl);
    out.modelDigest = details.digest ?? details.modelfile?.match(/digest[:=]\s*([^\s]+)/i)?.[1] ?? null;
    out.quantization = details.details?.quantization_level ?? details.details?.quantization ?? null;
  } catch { /* an unavailable model is reported by the actual sample request */ }
  if (!out.modelDigest) {
    try {
      const tags = await fetchJson(`${base}/api/tags`, {}, fetchImpl);
      const listed = Array.isArray(tags.models) ? tags.models.find(entry => entry.name === model) : null;
      out.modelDigest = listed?.digest ?? null;
    } catch { /* tags are an optional digest fallback */ }
  }
  return out;
}

export async function probeOllama({ baseUrl, model, fetchImpl = globalThis.fetch } = {}) {
  const base = resolveOllamaBaseUrl(baseUrl);
  const tags = await fetchJson(`${base}/api/tags`, {}, fetchImpl);
  const models = Array.isArray(tags.models) ? tags.models : [];
  const found = model ? models.find(row => row.name === model) : null;
  return { baseUrl: base, available: true, model, modelAvailable: Boolean(found), models: models.map(row => row.name) };
}
