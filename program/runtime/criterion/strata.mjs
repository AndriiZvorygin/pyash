import { resolveProfile } from "./ollama.mjs";
import { stripThinking } from "./metrics.mjs";
import { createGpuHousekeeperAdapter } from "../gpu/housekeeper_adapter.mjs";
import { submitManagedGpuJob } from "../gpu/managed-ollama.mjs";

export const DEFAULT_STRATA_BASE_URL = "http://127.0.0.1:8081";

function normalizeBaseUrl(value) {
  return String(value ?? DEFAULT_STRATA_BASE_URL).trim().replace(/\/$/u, "") || DEFAULT_STRATA_BASE_URL;
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function responseError(response, endpoint, payload = {}) {
  const message = payload?.error?.message ?? payload?.error ?? response.statusText ?? "request failed";
  const error = new Error(`Strata request failed: ${response.status} ${String(message).trim()} (${endpoint})`);
  error.status = response.status;
  return error;
}

function requestSignal(parentSignal, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("Strata request timeout")), Math.max(1, Number(timeoutMs) || 180000));
  const abort = () => controller.abort(parentSignal.reason);
  if (parentSignal) {
    if (parentSignal.aborted) abort();
    else parentSignal.addEventListener("abort", abort, { once: true });
  }
  return {
    signal: controller.signal,
    clear() {
      clearTimeout(timer);
      parentSignal?.removeEventListener?.("abort", abort);
    }
  };
}

async function readJsonResponse(response, endpoint) {
  const text = await response.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { raw: text };
  }
  if (!response.ok) throw responseError(response, endpoint, payload);
  return payload;
}

function timingFromResponse(payload, elapsedMs) {
  const usage = payload?.usage ?? {};
  const promptTokens = finiteNumber(usage.prompt_tokens ?? payload?.prompt_tokens ?? payload?.prompt_eval_count);
  const outputTokens = finiteNumber(usage.completion_tokens ?? payload?.completion_tokens ?? payload?.eval_count);
  const promptDurationMs = finiteNumber(payload?.prompt_eval_duration ?? payload?.timings?.prompt_eval_duration);
  const outputDurationMs = finiteNumber(payload?.eval_duration ?? payload?.timings?.eval_duration);
  const perSecond = (tokens, durationMs) => tokens !== null && durationMs > 0 ? tokens / (durationMs / 1000) : null;
  return {
    promptTokens,
    outputTokens,
    promptTokensPerSecond: perSecond(promptTokens, promptDurationMs),
    generationTokensPerSecond: perSecond(outputTokens, outputDurationMs),
    totalElapsedMs: elapsedMs,
    promptEvalDurationMs: promptDurationMs,
    evalDurationMs: outputDurationMs
  };
}

export async function runStrataChat({
  model,
  prompt,
  profile = "summary_direct",
  contextLength,
  sampling = {},
  baseUrl,
  apiKey = process.env.STRATA_API_KEY || "pyash-local",
  fetchImpl = globalThis.fetch,
  requestTimeoutMs = Number(process.env.PYA_CRITERION_STRATA_TIMEOUT_MS || 180000),
  signal,
  now = () => Date.now()
} = {}) {
  if (typeof fetchImpl !== "function") throw new Error("Strata criterion execution requires fetch");
  if (!model) throw new Error("Strata criterion execution requires a model");
  const settings = resolveProfile(profile, { ...sampling, contextLength });
  const endpoint = `${normalizeBaseUrl(baseUrl)}/v1/chat/completions`;
  const startedAtMs = now();
  const request = requestSignal(signal, requestTimeoutMs);
  try {
    const body = {
      model,
      messages: [{ role: "user", content: String(prompt ?? "") }],
      stream: false,
      ...(settings.temperature === null ? {} : { temperature: settings.temperature }),
      ...(settings.top_p === null ? {} : { top_p: settings.top_p }),
      ...(settings.top_k === null ? {} : { top_k: settings.top_k }),
      ...(sampling.max_tokens || sampling.num_predict ? { max_tokens: Number(sampling.max_tokens ?? sampling.num_predict) } : {})
    };
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${String(apiKey || "pyash-local")}`
      },
      signal: request.signal,
      body: JSON.stringify(body)
    });
    const payload = await readJsonResponse(response, endpoint);
    const message = payload?.choices?.[0]?.message ?? {};
    const rawText = typeof message.content === "string" ? message.content : String(payload?.response ?? "");
    const finishedAtMs = now();
    return {
      text: stripThinking(rawText),
      thinking: message.reasoning_content ?? payload?.thinking ?? "",
      payload,
      timing: timingFromResponse(payload, Math.max(0, finishedAtMs - startedAtMs)),
      request: { endpoint, model },
      effectiveThink: false,
      reasoningMode: settings.reasoningMode,
      startedAt: new Date(startedAtMs).toISOString(),
      finishedAt: new Date(finishedAtMs).toISOString(),
      metadata: { engine: "strata", runtime: "strata", baseUrl: normalizeBaseUrl(baseUrl) }
    };
  } finally {
    request.clear();
  }
}

async function postHousekeeper({ housekeeperUrl, pathname, payload, fetchImpl }) {
  const base = String(housekeeperUrl ?? "").trim().replace(/\/$/u, "");
  if (!base) throw new Error("Strata Criterion execution requires PYA_GPU_HOUSEKEEPER_URL");
  const endpoint = `${base}${pathname}`;
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload ?? {})
  });
  return readJsonResponse(response, endpoint);
}

export function createStrataExecutor({
  baseUrl = process.env.STRATA_HOST ?? DEFAULT_STRATA_BASE_URL,
  housekeeperUrl = process.env.PYA_GPU_HOUSEKEEPER_URL ?? "",
  vramRequiredMb = process.env.PYA_CRITERION_STRATA_VRAM_REQUIRED_MB ?? process.env.PYASH_STRATA_VRAM_REQUIRED_MIB ?? null,
  fetchImpl = globalThis.fetch,
  requestTimeoutMs,
  pollIntervalMs = Number(process.env.PYA_GPU_MANAGER_POLL_MS || 500)
} = {}) {
  const normalizedHousekeeperUrl = String(housekeeperUrl ?? "").trim().replace(/\/+$/u, "");
  const normalizedVram = Number(vramRequiredMb) > 0 ? Math.trunc(Number(vramRequiredMb)) : 20000;
  const metadataHousekeeper = normalizedHousekeeperUrl
    ? createGpuHousekeeperAdapter({ baseUrl: normalizedHousekeeperUrl })
    : null;
  let used = false;
  let closed = false;

  const executor = async ({
    model,
    prompt,
    profile = "summary_direct",
    contextLength,
    sampling = {}
  } = {}) => {
    used = true;
    const settings = resolveProfile(profile, { ...sampling, contextLength });
    const startedAtMs = Date.now();
    const payload = {
      model,
      messages: [{ role: "user", content: String(prompt ?? "") }],
      stream: false,
      ...(settings.temperature === null ? {} : { temperature: settings.temperature }),
      ...(settings.top_p === null ? {} : { top_p: settings.top_p }),
      ...(settings.top_k === null ? {} : { top_k: settings.top_k }),
      ...(sampling.max_tokens || sampling.num_predict
        ? { max_tokens: Number(sampling.max_tokens ?? sampling.num_predict) }
        : {})
    };
    const response = await submitManagedGpuJob({
      runtimeName: "strata",
      profileName: model,
      managerUrl: normalizedHousekeeperUrl,
      providerUrl: baseUrl,
      fetchImpl,
      timeoutMs: Number(requestTimeoutMs || process.env.PYA_GPU_MANAGER_TIMEOUT_MS || 1800000),
      pollIntervalMs,
      vramRequiredMb: normalizedVram,
      jobSpec: {
        kind: "strata-chat",
        payload
      }
    });
    const finishedAtMs = Date.now();
    const message = response?.choices?.[0]?.message ?? {};
    const rawText = typeof message.content === "string"
      ? message.content
      : String(response?.response ?? "");
    return {
      text: stripThinking(rawText),
      thinking: message.reasoning_content ?? response?.thinking ?? "",
      payload: response,
      timing: timingFromResponse(response, Math.max(0, finishedAtMs - startedAtMs)),
      request: { endpoint: `${normalizedHousekeeperUrl}/submit`, model, runtime: "strata" },
      effectiveThink: false,
      reasoningMode: settings.reasoningMode,
      startedAt: new Date(startedAtMs).toISOString(),
      finishedAt: new Date(finishedAtMs).toISOString(),
      metadata: {
        engine: "strata",
        runtime: "strata",
        managedBy: "gpu-housekeeper",
        housekeeperUrl: normalizedHousekeeperUrl,
        resourceRequest: { vramRequiredMb: normalizedVram }
      }
    };
  };

  const metadataProvider = async ({ model }) => {
    try {
      const response = metadataHousekeeper ? await metadataHousekeeper.getStrataModels() : {};
      const listed = Array.isArray(response?.models)
        ? response.models.find(entry => entry?.name === model || entry?.id === model)
        : null;
      return {
        model,
        engine: "strata",
        runtime: "strata",
        managedBy: "gpu-housekeeper",
        housekeeperUrl: normalizedHousekeeperUrl,
        baseUrl: normalizeBaseUrl(baseUrl),
        modelDigest: listed?.digest ?? null,
        quantization: listed?.details?.quantization_level ?? listed?.details?.quantization ?? null,
        contextLength: listed?.details?.context_length ?? null
      };
    } catch (error) {
      return {
        model,
        engine: "strata",
        runtime: "strata",
        managedBy: "gpu-housekeeper",
        housekeeperUrl: normalizedHousekeeperUrl,
        baseUrl: normalizeBaseUrl(baseUrl),
        modelDigest: null,
        quantization: null,
        metadataError: String(error?.message ?? error)
      };
    }
  };

  async function close() {
    if (closed) return { status: "already-closed" };
    closed = true;
    if (!used) return { status: "not-used" };
    try {
      const result = await postHousekeeper({
        housekeeperUrl: normalizedHousekeeperUrl,
        pathname: "/discharge",
        payload: { runtimeName: "strata" },
        fetchImpl
      });
      return { status: result?.success === false ? "failed" : "ok", ...result };
    } catch (error) {
      return { status: "failed", error: String(error?.message ?? error) };
    }
  }

  return { executor, metadataProvider, close };
}

