import path from "node:path";
import { fetchZaiCodingPlanModels } from "../runtime/zai_coding_plan.mjs";

export const SADDLE_OLLAMA_CONTEXT_PRESETS = [4096, 8192, 16384, 32768, 65536];

function formatContextLength(tokens) {
  const value = Number(tokens);
  if (!Number.isSafeInteger(value) || value <= 0) return "default";
  if (value >= 1_000_000) return `${Number((value / 1_000_000).toFixed(2))}M`;
  if (value >= 1024 && value % 1024 === 0) return `${value / 1024}K`;
  return value.toLocaleString("en-CA");
}

export function buildSaddleStrataContextOptions({
  options = [],
  currentContextLength = null,
  defaultContextLength = null
} = {}) {
  const values = [...new Set((Array.isArray(options) ? options : [])
    .map(Number)
    .filter((value) => Number.isSafeInteger(value) && value >= 8192 && value <= 262144))]
    .sort((a, b) => a - b);
  if (!values.length) return [];
  const choices = values.map((tokens) => ({
    model: String(tokens),
    value: formatContextLength(tokens),
    label: formatContextLength(tokens),
    tokens
  }));
  const defaultTokens = Number(defaultContextLength);
  if (values.includes(defaultTokens)) {
    choices.unshift({
      model: String(defaultTokens),
      value: "default",
      label: `Default (${formatContextLength(defaultTokens)})`,
      tokens: defaultTokens
    });
  }
  return choices.map((choice) => ({
    ...choice,
    current: choice.tokens === Number(currentContextLength),
    isDefault: choice.value === "default"
  }));
}

export const DEFAULT_CODING_SADDLE_SYSTEM_PROMPT = [
  "You are the Pyash coding saddle: an interactive coding agent operating inside the existing Pyash runtime.",
  "Use the provided Pyash tools for repository work. Do not pretend a change was made when a tool did not succeed.",
  "Keep work inside the configured coding directory and prefer small, verifiable steps.",
  "Use command to inspect or run code, write for bounded file creation, and repair for unified-diff corrections.",
  "Before reporting completion, run the narrowest relevant check and report its result.",
  "Respond concisely with the result and any remaining blocker."
].join(" ");

function normalizeText(value) {
  return String(value ?? "").trim();
}

export function normalizeSaddleModel(value, fallback = "qwen3.5:9b") {
  return normalizeText(value) || fallback;
}

export function normalizeSaddleBackend(value, fallback = "ollama") {
  const normalized = normalizeText(value).toLowerCase();
  const aliases = new Map([
    ["ollama command mind", "ollama"],
    ["openai command mind", "openai"],
    ["litellm command mind", "litellm"],
    ["openrouter command mind", "openrouter"],
    ["zai command mind", "zai"],
    ["vllm command mind", "vllm"],
    ["strata command mind", "strata"]
  ]);
  return aliases.get(normalized) || normalized || fallback;
}

export function normalizeSaddleHost(value, fallback = "http://localhost:11434") {
  return normalizeText(value) || fallback;
}

export function normalizeSaddleThinkSelection(value, backend) {
  const selected = normalizeText(value).toLowerCase();
  const provider = normalizeSaddleBackend(backend);
  if (provider === "ollama") {
    if (["off", "none", "false", "0"].includes(selected)) {
      return { value: "off", think: false, reasoningEffort: null };
    }
    if (["on", "think", "true", "1"].includes(selected)) {
      return { value: "on", think: true, reasoningEffort: null };
    }
    return null;
  }
  if (provider === "strata") {
    const effort = selected === "off" ? "none" : selected === "on" ? "high" : selected;
    if (["none", "low", "medium", "high"].includes(effort)) {
      return { value: effort, think: null, reasoningEffort: effort };
    }
  }
  return null;
}

function mindFieldValue(value) {
  if (typeof value === "string") return value.trim();
  if (!value || typeof value !== "object") return "";
  return normalizeText(value.name ?? value.text ?? value.filename);
}

export function resolveSaddleMindProfile({
  mindName,
  profile,
  defaultBackend = "ollama",
  defaultModel = "qwen3.5:9b",
  defaultHost = "http://localhost:11434",
  hostForBackend = () => defaultHost
} = {}) {
  const name = normalizeText(mindName);
  if (!name || profile?.be !== "mind") throw new Error(`Pyash mind not found: ${name || "(empty)"}`);
  const declaredBackend = mindFieldValue(profile.fromstate);
  const backend = normalizeSaddleBackend(declaredBackend || defaultBackend);
  const model = normalizeSaddleModel(
    mindFieldValue(profile.as) || (backend === "zai" ? "glm-5.3-flash" : defaultModel)
  );
  const declaredHost = mindFieldValue(profile.from);
  const host = normalizeSaddleHost(declaredHost || hostForBackend(backend), defaultHost);
  return { mindName: name, backend, model, host };
}

export function listSaddleMindNames({ minds = [], activeMindName = "coding saddle" } = {}) {
  const active = normalizeText(activeMindName).toLowerCase();
  const names = [...new Set((Array.isArray(minds) ? minds : [])
    .filter((fact) => fact?.be === "mind" && fact?.su?.name)
    .filter((fact) => normalizeText(fact.su.name).toLowerCase() !== active)
    .filter((fact) => normalizeText(fact.su.name).toLowerCase() === "mind" || mindFieldValue(fact.fromstate))
    .map((fact) => normalizeText(fact.su.name)))];
  return names.sort((left, right) => {
    if (left.toLowerCase() === "mind") return -1;
    if (right.toLowerCase() === "mind") return 1;
    return left.localeCompare(right);
  });
}

export function parseSaddleMindCommand(value) {
  const input = normalizeText(value);
  if (/^\/mind$/i.test(input)) return { type: "list" };
  const match = input.match(/^\/mind\s+(.+)$/i);
  return match ? { type: "select", mindName: normalizeText(match[1]) } : null;
}

export function resolveSaddleModelSelection(value, models = []) {
  const selected = resolveSaddleModelOption(value, models);
  return selected?.model || "";
}

export function resolveSaddleModelOption(value, models = []) {
  const input = normalizeText(value);
  const choices = Array.isArray(models)
    ? models.map((entry) => typeof entry === "string" ? { model: normalizeText(entry), value: normalizeText(entry) } : entry)
      .filter((entry) => normalizeText(entry?.model))
    : [];
  if (/^\d+$/.test(input)) {
    const index = Number.parseInt(input, 10);
    return index >= 1 && index <= choices.length ? choices[index - 1] : null;
  }
  const exact = choices.find((entry) => entry.value === input || entry.model === input || entry.label === input);
  if (exact) return exact;
  const insensitive = choices.find((entry) => [entry.value, entry.model, entry.label]
    .filter(Boolean)
    .some((candidate) => String(candidate).toLowerCase() === input.toLowerCase()));
  return insensitive || null;
}

export async function discoverSaddleModels({
  backend,
  host,
  currentModel = "",
  fallbackModels = [],
  apiKey,
  fetchFn = globalThis.fetch,
  timeoutMs = 4000
} = {}) {
  const normalizedBackend = normalizeSaddleBackend(backend);
  const normalizedHost = normalizeSaddleHost(host);
  const configured = [currentModel, ...fallbackModels].map(normalizeText).filter(Boolean);
  if (normalizedBackend === "zai") {
    const discovered = await fetchZaiCodingPlanModels({
      host: normalizedHost,
      apiKey,
      fetchFn,
      timeoutMs
    });
    return {
      models: [...new Set([...configured, ...discovered.models])],
      catalogModels: discovered.models,
      available: discovered.ok,
      error: discovered.error || null
    };
  }
  if (["openai", "litellm", "openrouter", "vllm"].includes(normalizedBackend)) {
    return { models: [...new Set(configured)], available: false, error: "enter a model ID supported by the selected mind" };
  }
  if (typeof fetchFn !== "function") {
    return { models: [...new Set(configured)], available: false, error: "model discovery is unavailable" };
  }
  const endpoint = normalizedBackend === "strata" ? "/v1/models" : "/api/tags";
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timer = controller && Number.isFinite(Number(timeoutMs))
    ? setTimeout(() => controller.abort(), Number(timeoutMs))
    : null;
  try {
    const response = await fetchFn(`${normalizedHost.replace(/\/+$/u, "")}${endpoint}`, {
      signal: controller?.signal
    });
    if (!response?.ok) throw new Error(`model catalogue returned HTTP ${response?.status ?? "unknown"}`);
    const payload = await response.json();
    const entries = normalizedBackend === "strata"
      ? (Array.isArray(payload?.data) ? payload.data : Array.isArray(payload?.models) ? payload.models : [])
      : (Array.isArray(payload?.models) ? payload.models : []);
    const discovered = entries.map((entry) => {
      if (typeof entry === "string") return entry;
      return entry?.id ?? entry?.name ?? entry?.model ?? "";
    }).map(normalizeText).filter(Boolean);
    const models = [...new Set([...configured, ...discovered])];
    return { models, available: true, error: models.length ? null : "no models are available" };
  } catch (error) {
    return {
      models: [...new Set(configured)],
      available: false,
      error: String(error?.message ?? error)
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function formatSaddleModelPicker({ models = [], currentModel = "", currentBackend = "", error = "" } = {}) {
  const choices = Array.isArray(models)
    ? models.map((entry) => typeof entry === "string" ? { model: normalizeText(entry), value: normalizeText(entry) } : entry)
      .filter((entry) => normalizeText(entry?.model))
    : [];
  const lines = ["available models:"];
  choices.forEach((entry, index) => {
    const model = normalizeText(entry.model);
    const backend = normalizeText(entry.backend).toLowerCase();
    const label = normalizeText(entry.label)
      || (backend && backend !== "ollama" ? `${backend}: ${model}` : model);
    const host = normalizeText(entry.host);
    const location = backend && backend !== "ollama" && host ? ` @ ${host}` : "";
    const marker = model === normalizeText(currentModel)
      && (!normalizeText(currentBackend) || !backend || backend === normalizeText(currentBackend).toLowerCase())
      ? " (current)"
      : "";
    lines.push(`${index + 1}. ${label}${location}${marker}`);
  });
  if (error) lines.push(`discovery: ${error}`);
  lines.push("Enter a number or exact model name; Ctrl+C cancels.");
  return lines.join("\n");
}

export function buildSaddleMindSentence({
  input,
  model,
  backend,
  host,
  contextWindow,
  think,
  reasoningEffort,
  mindName = "coding saddle",
  toolMapName = "saddle tools",
  sessionName = "coding",
  sessionFile = ""
} = {}) {
  const sentence = {
    mood: "do",
    be: "write",
    for: { name: normalizeText(mindName) || "coding saddle" },
    ob: { text: String(input ?? "") },
    to: { name: "text" },
    with: { name: normalizeText(toolMapName) || "saddle tools" },
    fromstate: { text: normalizeSaddleBackend(backend) },
    from: { text: normalizeSaddleHost(host) },
    fromtext: sessionFile
      ? { filename: path.resolve(String(sessionFile)) }
      : { name: `session name ${normalizeText(sessionName) || "coding"}` },
    by: { num: 50 },
    // The model is persisted in the mind configuration fact; the sentence stays canonical Pyash shape.
  };
  if (Number.isSafeInteger(Number(contextWindow)) && Number(contextWindow) > 0) {
    sentence.contextWindow = Number(contextWindow);
  }
  if (typeof think === "boolean") sentence.think = think;
  if (["none", "low", "medium", "high"].includes(String(reasoningEffort ?? "").trim().toLowerCase())) {
    sentence.reasoningEffort = String(reasoningEffort).trim().toLowerCase();
  }
  return sentence;
}

export function formatSaddleStatus({
  mindName = "mind",
  model,
  contextWindow,
  thinkMode,
  host,
  cwd,
  queue,
  busy = false,
  session = "coding"
} = {}) {
  const queueValue = queue && typeof queue === "object"
    ? (Number(queue.total ?? queue.runtime ?? queue.input ?? 0) || 0)
    : Number(queue ?? 0) || 0;
  return [
    `mind: ${normalizeText(mindName) || "mind"}`,
    `model: ${normalizeSaddleModel(model)}`,
    ...(Number.isSafeInteger(Number(contextWindow)) && Number(contextWindow) > 0
      ? [`context: ${Number(contextWindow).toLocaleString("en-CA")} tokens`]
      : []),
    ...(normalizeText(thinkMode) ? [`thinking: ${normalizeText(thinkMode)}`] : []),
    `host: ${normalizeSaddleHost(host)}`,
    `session: ${normalizeText(session) || "coding"}`,
    `cwd: ${path.resolve(String(cwd || process.cwd()))}`,
    `gpu queue: ${queueValue}`,
    `state: ${busy ? "running" : "ready"}`
  ].join(" | ");
}

function isShiftEnterSequence(value) {
  return value === "\u001b[13;2u"
    || value === "\u001b[27;2;13~"
    || value === "\u001b[27;2;13;~";
}

function isCsiFinal(value) {
  if (value.startsWith("\u001b[")) {
    return value.length > 2 && /[\x40-\x7e]$/.test(value.slice(2));
  }
  return value.length > 1;
}

export function createSaddleInputDecoder({
  onSubmit,
  onCancel,
  onExit,
  onChange
} = {}) {
  const state = { value: "", cursor: 0 };
  let escape = "";

  const changed = () => {
    if (typeof onChange === "function") onChange({ ...state });
  };
  const insert = (text) => {
    const value = String(text ?? "");
    state.value = `${state.value.slice(0, state.cursor)}${value}${state.value.slice(state.cursor)}`;
    state.cursor += value.length;
    changed();
  };
  const submit = () => {
    const value = state.value;
    state.value = "";
    state.cursor = 0;
    changed();
    if (typeof onSubmit === "function") {
      Promise.resolve(onSubmit(value)).catch(() => undefined);
    }
  };
  const handleEscape = (sequence) => {
    if (isShiftEnterSequence(sequence)) {
      insert("\n");
      return;
    }
    if (sequence === "\u001b[D") {
      state.cursor = Math.max(0, state.cursor - 1);
      changed();
      return;
    }
    if (sequence === "\u001b[C") {
      state.cursor = Math.min(state.value.length, state.cursor + 1);
      changed();
      return;
    }
    if (sequence === "\u001b[H" || sequence === "\u001b[1~") {
      state.cursor = 0;
      changed();
      return;
    }
    if (sequence === "\u001b[F" || sequence === "\u001b[4~") {
      state.cursor = state.value.length;
      changed();
      return;
    }
    if (sequence === "\u001b[3~") {
      if (state.cursor < state.value.length) {
        state.value = `${state.value.slice(0, state.cursor)}${state.value.slice(state.cursor + 1)}`;
        changed();
      }
    }
  };
  const handleChar = (char) => {
    if (escape) {
      escape += char;
      if (isCsiFinal(escape)) {
        const sequence = escape;
        escape = "";
        handleEscape(sequence);
      } else if (escape.length > 32) {
        escape = "";
      }
      return;
    }
    if (char === "\u001b") {
      escape = char;
      return;
    }
    if (char === "\u0003") {
      if (typeof onCancel === "function") onCancel();
      return;
    }
    if (char === "\u0004") {
      if (typeof onExit === "function") onExit();
      return;
    }
    if (char === "\r") {
      submit();
      return;
    }
    if (char === "\n") {
      insert("\n");
      return;
    }
    if (char === "\u007f" || char === "\b") {
      if (state.cursor > 0) {
        state.value = `${state.value.slice(0, state.cursor - 1)}${state.value.slice(state.cursor)}`;
        state.cursor -= 1;
        changed();
      }
      return;
    }
    if (char >= " " || char === "\t") insert(char);
  };

  return {
    feed(chunk) {
      for (const char of String(chunk ?? "")) handleChar(char);
    },
    getState() {
      return { ...state };
    },
    setValue(value) {
      state.value = String(value ?? "");
      state.cursor = state.value.length;
      changed();
    }
  };
}

export function saddleToolEventLabel(event = {}) {
  const stage = normalizeText(event.stage).toUpperCase();
  const tool = normalizeText(event.toolName) || "tool";
  if (!stage) return `[tool] ${tool}`;
  return `[${stage.toLowerCase()}] ${tool}`;
}
