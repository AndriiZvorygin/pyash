import { remember } from "../remember/index.mjs";

function scalarFact(value) {
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

function runtimeMap(context) {
  const tuning = context?.modelTuning && typeof context.modelTuning === "object"
    ? context.modelTuning
    : {};
  const values = {
    model: context?.model,
    backend: context?.backend,
    "runtime host": safeHostLabel(context?.host),
    "reasoning effort": context?.reasoningEffort,
    think: tuning.think,
    temperature: tuning.temperature,
    "top p": tuning.topP,
    "top k": tuning.topK,
    "min p": tuning.minP,
    "presence penalty": tuning.presencePenalty,
    "max output tokens": tuning.numPredict,
    "context length": tuning.contextLength,
    "tools map": context?.toolMap,
    "agent name": context?.agentName
  };
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, scalarFact(value)])
  );
}

export function status(sentence, {
  remember: rememberFn = remember,
  runtimeContext = null
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
  return {
    mood: "ya",
    su: { name: "result" },
    be: "map",
    ob: { map: runtimeMap(context) }
  };
}

export default status;

export const signatures = [
  { signatureWords: ["be", "status", "as", "wo", "runtime"], handler: status }
];
