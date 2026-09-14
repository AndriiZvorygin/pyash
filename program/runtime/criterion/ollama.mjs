import { ollamaTiming, stripThinking } from "./metrics.mjs";

export function resolveOllamaBaseUrl(baseUrl = null, env = process.env) {
  return String(baseUrl ?? env.OLLAMA_BASE_URL ?? env.OLLAMA_HOST ?? "http://localhost:11434").replace(/\/$/u, "");
}

export const DEFAULT_PROFILES = Object.freeze({
  summary_direct: Object.freeze({ think: false, temperature: 0.2, top_p: 0.8, top_k: 20, contextLength: 32768 }),
  reasoning: Object.freeze({ think: true, temperature: 0.6, top_p: 0.95, top_k: 20, contextLength: 32768 })
});

export function resolveProfile(name = "summary_direct", overrides = {}) {
  const base = DEFAULT_PROFILES[name] ?? DEFAULT_PROFILES.summary_direct;
  return {
    ...base,
    ...overrides,
    contextLength: Number(overrides.contextLength ?? base.contextLength)
  };
}

function responseError(response, endpoint) {
  return new Error(`ollama request failed at ${endpoint}: ${response.status} ${response.statusText ?? ""}`.trim());
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
  signal
} = {}) {
  if (typeof fetchImpl !== "function") throw new Error("Ollama benchmark requires fetch");
  if (!model) throw new Error("Ollama benchmark requires a model");
  const settings = resolveProfile(profile, { ...sampling, contextLength });
  const startedAt = new Date(now()).toISOString();
  const response = await fetchImpl(`${resolveOllamaBaseUrl(baseUrl)}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal,
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: String(prompt ?? "") }],
      stream: false,
      think: settings.think,
      options: {
        temperature: settings.temperature,
        top_p: settings.top_p,
        top_k: settings.top_k,
        num_ctx: settings.contextLength
      }
    })
  });
  if (!response.ok) throw responseError(response, "/api/chat");
  const payload = await response.json();
  if (payload.error) throw new Error(`ollama request error: ${payload.error}`);
  const finishedAt = new Date(now()).toISOString();
  const rawText = payload.message?.content ?? payload.response ?? "";
  return {
    text: stripThinking(rawText),
    thinking: payload.message?.thinking ?? payload.thinking ?? "",
    payload,
    timing: ollamaTiming(payload, startedAt, finishedAt),
    startedAt,
    finishedAt
  };
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
  return out;
}

export async function probeOllama({ baseUrl, model, fetchImpl = globalThis.fetch } = {}) {
  const base = resolveOllamaBaseUrl(baseUrl);
  const tags = await fetchJson(`${base}/api/tags`, {}, fetchImpl);
  const models = Array.isArray(tags.models) ? tags.models : [];
  const found = model ? models.find(row => row.name === model) : null;
  return { baseUrl: base, available: true, model, modelAvailable: Boolean(found), models: models.map(row => row.name) };
}
