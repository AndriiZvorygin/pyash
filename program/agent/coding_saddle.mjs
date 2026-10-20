import path from "node:path";

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
    ["vllm command mind", "vllm"],
    ["strata command mind", "strata"]
  ]);
  return aliases.get(normalized) || normalized || fallback;
}

export function normalizeSaddleHost(value, fallback = "http://localhost:11434") {
  return normalizeText(value) || fallback;
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
  fetchFn = globalThis.fetch,
  timeoutMs = 4000
} = {}) {
  const normalizedBackend = normalizeSaddleBackend(backend);
  const normalizedHost = normalizeSaddleHost(host);
  const configured = [currentModel, ...fallbackModels].map(normalizeText).filter(Boolean);
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
  mindName = "coding saddle",
  toolMapName = "saddle tools",
  sessionName = "coding",
  sessionFile = ""
} = {}) {
  return {
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
}

export function formatSaddleStatus({
  model,
  backend,
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
    `model: ${normalizeSaddleModel(model)}`,
    `backend: ${normalizeSaddleBackend(backend)}`,
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
