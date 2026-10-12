import { remember } from "../remember/index.mjs";

function scalarFact(value) {
  if (value && typeof value === "object" && ("text" in value || "num" in value || "boolean" in value)) {
    return value;
  }
  if (value === null || value === undefined || value === "") {
    return { text: "unavailable" };
  }
  if (typeof value === "boolean") return { boolean: value };
  if (typeof value === "number" && Number.isFinite(value)) return { num: value };
  return { text: String(value) };
}

function safeHostLabel(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  try {
    return new URL(raw).hostname || raw;
  } catch {
    return raw.replace(/^https?:\/\//u, "").split("/")[0] || null;
  }
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function parseOllamaParameters(value) {
  const parameters = {};
  for (const line of String(value ?? "").split(/\r?\n/u)) {
    const match = line.trim().match(/^([a-z_]+)\s+(.+)$/iu);
    if (!match) continue;
    const key = match[1].toLowerCase();
    const number = finiteNumber(match[2]);
    if (number !== null) parameters[key] = number;
  }
  return parameters;
}

function modelContextLength(modelInfo = {}, details = {}) {
  const candidates = [
    details.context_length,
    details.contextLength,
    modelInfo["qwen35.context_length"],
    modelInfo["qwen3.context_length"],
    modelInfo["llama.context_length"],
    modelInfo["bert.context_length"]
  ];
  return candidates.map(finiteNumber).find((value) => value !== null) ?? null;
}

async function readOllamaModelInfo(context, fetchFn) {
  const backend = String(context?.backend ?? "").toLowerCase();
  const host = String(context?.host ?? "").replace(/\/$/u, "");
  const model = String(context?.model ?? "").trim();
  if (!context?.probeProvider || !backend.includes("ollama") || !host || !model || typeof fetchFn !== "function") {
    return null;
  }
  try {
    const response = await fetchFn(`${host}/api/show`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model }),
      signal: typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
        ? AbortSignal.timeout(2500)
        : undefined
    });
    if (!response?.ok) return { unavailable: `Ollama model metadata returned HTTP ${response?.status ?? "unknown"}` };
    const payload = await response.json();
    const modelInfo = payload?.model_info && typeof payload.model_info === "object" ? payload.model_info : {};
    const details = payload?.details && typeof payload.details === "object" ? payload.details : {};
    const parameters = parseOllamaParameters(payload?.parameters);
    const contextLength = modelContextLength(modelInfo, details);
    return {
      contextLength,
      family: details.family ?? modelInfo["general.architecture"] ?? null,
      parameterSize: details.parameter_size ?? null,
      quantization: details.quantization_level ?? null,
      capabilities: Array.isArray(payload?.capabilities) ? payload.capabilities : [],
      defaults: {
        temperature: parameters.temperature,
        topP: parameters.top_p,
        topK: parameters.top_k,
        minP: parameters.min_p,
        presencePenalty: parameters.presence_penalty
      }
    };
  } catch (error) {
    return { unavailable: String(error?.message ?? error) };
  }
}

function fallbackRuntimeContext(rememberFn) {
  const modelFact = rememberFn("mind model");
  const backendFact = rememberFn("mind backend");
  const hostFact = rememberFn("ollama host");
  return {
    model: modelFact?.ob?.text ?? modelFact?.ob?.name ?? null,
    backend: backendFact?.ob?.text ?? backendFact?.ob?.name ?? null,
    host: hostFact?.ob?.text ?? hostFact?.ob?.name ?? null,
    modelTuning: {}
  };
}

function runtimeMap(context, providerInfo = null) {
  const tuning = context?.modelTuning && typeof context.modelTuning === "object"
    ? context.modelTuning
    : {};
  const providerDefaults = providerInfo?.defaults && typeof providerInfo.defaults === "object"
    ? providerInfo.defaults
    : {};
  const effective = (configured, providerDefault) => configured ?? providerDefault;
  const effectiveContextLength = tuning.contextLength ?? providerInfo?.contextLength;
  const values = {
    model: context?.model,
    backend: context?.backend,
    "runtime host": safeHostLabel(context?.host),
    "reasoning effort": context?.reasoningEffort,
    think: tuning.think,
    temperature: effective(tuning.temperature, providerDefaults.temperature),
    "top p": effective(tuning.topP, providerDefaults.topP),
    "top k": effective(tuning.topK, providerDefaults.topK),
    "min p": effective(tuning.minP, providerDefaults.minP),
    "presence penalty": effective(tuning.presencePenalty, providerDefaults.presencePenalty),
    "max output tokens": tuning.numPredict ?? { text: "provider default" },
    "context length": effectiveContextLength,
    "context length source": tuning.contextLength
      ? "request override"
      : (providerInfo?.contextLength ? "Ollama model maximum; no request override" : null),
    "sampling source": tuning.temperature !== undefined || tuning.topP !== undefined || tuning.topK !== undefined
      ? "Pyash request override"
      : (providerInfo ? "Ollama model defaults" : null),
    "model family": providerInfo?.family,
    "parameter size": providerInfo?.parameterSize,
    quantization: providerInfo?.quantization,
    capabilities: providerInfo?.capabilities?.length ? providerInfo.capabilities.join(", ") : null,
    "provider metadata": providerInfo?.unavailable ? `unavailable: ${providerInfo.unavailable}` : (providerInfo ? "available" : null),
    "tools map": context?.toolMap,
    "agent name": context?.agentName
  };
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, scalarFact(value)])
  );
}

export async function status(sentence, {
  remember: rememberFn = remember,
  runtimeContext = null,
  fetchFn = globalThis.fetch
} = {}) {
  const requestedScope = String(sentence?.as?.wo ?? sentence?.as?.text ?? sentence?.as?.name ?? "runtime").trim().toLowerCase();
  if (requestedScope !== "runtime") {
    return {
      mood: "ya",
      su: { name: "result" },
      be: "map",
      ob: { map: { status: { text: "unsupported status scope" } } }
    };
  }
  const context = runtimeContext ?? fallbackRuntimeContext(rememberFn);
  const providerInfo = await readOllamaModelInfo(context, fetchFn);
  return {
    mood: "ya",
    su: { name: "result" },
    be: "map",
    ob: { map: runtimeMap(context, providerInfo) }
  };
}

export default status;

export const signatures = [
  { signatureWords: ["be", "status", "as", "wo", "runtime"], handler: status }
];
