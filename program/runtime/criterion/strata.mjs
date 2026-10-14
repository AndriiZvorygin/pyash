import { resolveProfile } from "./ollama.mjs";
import { stripThinking } from "./metrics.mjs";

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
  apiKey = process.env.STRATA_API_KEY || "pyash-local",
  fetchImpl = globalThis.fetch,
  requestTimeoutMs
} = {}) {
  let preparation = null;
  let prepared = false;

  async function ensureCapacity() {
    if (!preparation) {
      preparation = postHousekeeper({
        housekeeperUrl,
        pathname: "/capacity/prepare",
        payload: {
          runtimeName: "strata",
          jobSpec: {
            resourceRequest: Number(vramRequiredMb) > 0 ? { vramRequiredMb: Math.trunc(Number(vramRequiredMb)) } : {}
          }
        },
        fetchImpl
      }).then(result => {
        if (result?.prepared !== true) throw new Error(result?.error || "GPU Housekeeper did not prepare Strata capacity");
        prepared = true;
        return result;
      });
    }
    return preparation;
  }

  const executor = async input => {
    await ensureCapacity();
    return runStrataChat({ ...input, baseUrl, apiKey, fetchImpl, requestTimeoutMs });
  };

  const metadataProvider = async ({ model }) => ({
    model,
    engine: "strata",
    runtime: "strata",
    baseUrl: normalizeBaseUrl(baseUrl),
    modelDigest: null,
    quantization: null
  });

  async function close() {
    if (!prepared) return { status: "not-prepared" };
    try {
      const result = await postHousekeeper({ housekeeperUrl, pathname: "/discharge", payload: { runtimeName: "strata" }, fetchImpl });
      return { status: result?.success === false ? "failed" : "ok", ...result };
    } finally {
      prepared = false;
      preparation = null;
    }
  }

  return { executor, metadataProvider, ensureCapacity, close };
}

