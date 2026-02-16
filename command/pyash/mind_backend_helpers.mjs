export const MIND_BACKEND_CHOICES = [
  { key: "ollama", value: "ollama command mind", label: "Ollama" },
  { key: "litellm", value: "litellm command mind", label: "LiteLLM" },
  { key: "openai-api", value: "openai command mind", label: "OpenAI API key" },
  { key: "openai-codex", value: "openai command mind", label: "OpenAI Codex OAuth" },
  { key: "openrouter", value: "openrouter command mind", label: "OpenRouter" },
  { key: "vllm", value: "vllm command mind", label: "vLLM" }
];

export function canonicalizeMindBackend(raw) {
  const text = String(raw ?? "").trim();
  if (!text) return "";
  if (text === "openai-codex") return "openai command mind";
  if (text === "openai-api") return "openai command mind";
  if (text === "openai") return "openai command mind";
  if (text === "ollama") return "ollama command mind";
  if (text === "litellm") return "litellm command mind";
  if (text === "openrouter") return "openrouter command mind";
  if (text === "vllm") return "vllm command mind";
  return text;
}

export function looksLikeOllamaBackend(backend) {
  const text = canonicalizeMindBackend(backend).toLowerCase();
  return text === "ollama command mind" || text.includes("ollama");
}

export async function fetchOllamaModels(host, { timeoutMs = 5000 } = {}) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(`${host.replace(/\/+$/, "")}/api/tags`, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) {
      return { ok: false, error: `status ${res.status}`, models: [] };
    }
    const payload = await res.json();
    const models = Array.isArray(payload?.models)
      ? payload.models.map((item) => item?.name).filter((name) => typeof name === "string" && name.trim())
      : [];
    return { ok: true, models };
  } catch (err) {
    return { ok: false, error: String(err?.message || err), models: [] };
  }
}

export async function fetchCodexModels({
  rootDir,
  codexBin = "",
  runCodexAccountCommand,
  codexAccountPath
} = {}) {
  const run = await runCodexAccountCommand({
    action: "model/list",
    codexBin,
    cwd: rootDir,
    json: true,
    codexAccountPath
  });
  if (run.code !== 0) {
    return { ok: false, error: (run.stderr || run.stdout || "codex model list failed").trim(), models: [] };
  }
  try {
    const payload = JSON.parse(run.stdout || "{}");
    if (!payload?.ok) {
      return { ok: false, error: String(payload?.error || "codex model list failed"), models: [] };
    }
    const models = Array.isArray(payload?.models) ? payload.models : [];
    return { ok: true, models };
  } catch (err) {
    return { ok: false, error: String(err?.message || err), models: [] };
  }
}

export function resolveModelSelection(raw, { fallback = "", models = [] } = {}) {
  const input = String(raw ?? "").trim();
  if (/^\d+$/.test(input)) {
    const index = Number.parseInt(input, 10);
    if (Number.isFinite(index) && index >= 1 && index <= models.length) {
      return String(models[index - 1]);
    }
  }
  return input || fallback;
}

export function resolveReasoningEffortSelection(raw, { fallback = "", options = [] } = {}) {
  const input = String(raw ?? "").trim();
  if (/^\d+$/.test(input)) {
    const index = Number.parseInt(input, 10);
    if (Number.isFinite(index) && index >= 1 && index <= options.length) {
      return String(options[index - 1]);
    }
  }
  return input || fallback;
}

export function findMindBackendChoice(raw) {
  const text = String(raw ?? "").trim().toLowerCase();
  if (!text) return null;
  if (/^\d+$/.test(text)) {
    const index = Number.parseInt(text, 10);
    if (Number.isFinite(index) && index >= 1 && index <= MIND_BACKEND_CHOICES.length) {
      return MIND_BACKEND_CHOICES[index - 1];
    }
  }
  for (const item of MIND_BACKEND_CHOICES) {
    if (item.key === text) return item;
  }
  const canonical = canonicalizeMindBackend(text);
  for (const item of MIND_BACKEND_CHOICES) {
    if (item.value === canonical) {
      return item;
    }
  }
  return null;
}

export function backendChoiceKey(backend) {
  const choice = findMindBackendChoice(backend);
  if (choice) return choice.key;
  if (canonicalizeMindBackend(backend) === "openai command mind") return "openai-api";
  return String(backend ?? "").trim().toLowerCase() || "ollama";
}

export function resolveMindBackendSource(raw, fallbackBackend = "ollama command mind") {
  const selected = findMindBackendChoice(raw);
  if (selected) return selected.key;
  const fallback = findMindBackendChoice(fallbackBackend);
  if (fallback) return fallback.key;
  return backendChoiceKey(fallbackBackend);
}

export function resolveMindBackendSelection(raw, fallbackBackend) {
  const fallbackChoice = findMindBackendChoice(fallbackBackend);
  const fallback = fallbackChoice ? fallbackChoice.value : canonicalizeMindBackend(fallbackBackend);
  const selected = findMindBackendChoice(raw);
  if (selected) return selected.value;
  const text = String(raw ?? "").trim();
  if (!text) return fallback;
  return canonicalizeMindBackend(text);
}

export function displayMindBackendKey(backend, source = "") {
  const sourceKey = String(source || "").trim().toLowerCase();
  if (sourceKey) return sourceKey;
  const canonical = canonicalizeMindBackend(backend);
  if (canonical === "openai command mind") return "openai-api";
  return backendChoiceKey(backend);
}

export function relayMatchesBackendSource(relay, sourceKey, backendValue) {
  const relaySource = String(relay?.source || "").trim().toLowerCase();
  const relayBackend = canonicalizeMindBackend(relay?.backend || "");
  if (relaySource && sourceKey && relaySource === sourceKey) return true;
  return relayBackend === canonicalizeMindBackend(backendValue || "");
}

export function formatNumberedRows(items, { columns = 2, gap = 3 } = {}) {
  const labels = items.map((item, idx) => `${idx + 1}. ${item}`);
  if (labels.length === 0) return [];
  if (columns <= 1) return labels;
  const rows = Math.ceil(labels.length / columns);
  const widths = Array.from({ length: columns }, () => 0);
  for (let col = 0; col < columns; col += 1) {
    for (let row = 0; row < rows; row += 1) {
      const idx = row + (rows * col);
      if (idx >= labels.length) continue;
      widths[col] = Math.max(widths[col], labels[idx].length);
    }
  }
  const out = [];
  for (let row = 0; row < rows; row += 1) {
    const cells = [];
    for (let col = 0; col < columns; col += 1) {
      const idx = row + (rows * col);
      if (idx >= labels.length) continue;
      const label = labels[idx];
      const padded = col < columns - 1 ? label.padEnd(widths[col] + gap, " ") : label;
      cells.push(padded);
    }
    out.push(cells.join(""));
  }
  return out;
}

export function suggestMindRelayName({ source = "", model = "", fallback = "default" } = {}) {
  const sourceKey = String(source || "").trim().toLowerCase();
  const modelText = String(model || "").trim().toLowerCase();
  if (!sourceKey && !modelText) return fallback;
  if (sourceKey === "openai-codex") {
    if (modelText.includes("gpt-5")) return "codex-gpt5";
    return "codex";
  }
  if (sourceKey === "openai-api") return "openai";
  if (sourceKey === "openrouter") return "openrouter";
  if (sourceKey === "litellm") return "litellm";
  if (sourceKey === "vllm") return "vllm";
  if (sourceKey === "ollama") {
    if (modelText.includes("gpt-oss")) return "local";
    if (modelText) return `local-${modelText.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "ollama"}`;
    return "local";
  }
  return sourceKey.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || fallback;
}

export function defaultMindHostForSource(source = "") {
  const key = String(source || "").trim().toLowerCase();
  if (key === "openai-api" || key === "openai-codex") {
    return "https://api.openai.com";
  }
  if (key === "openrouter") {
    return "https://openrouter.ai/api";
  }
  return "http://localhost:11434";
}

export function defaultMindModelForSource(source = "") {
  const key = String(source || "").trim().toLowerCase();
  if (key === "openai-api" || key === "openai-codex") return "gpt-5-codex";
  if (key === "openrouter") return "openrouter/auto";
  return "gpt-oss:latest";
}
