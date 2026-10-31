import path from "node:path";
import { fetchZaiCodingPlanModels } from "../runtime/zai_coding_plan.mjs";
import { fetchMiniMaxModels } from "../runtime/minimax.mjs";

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
  "For requests about repository files, code, tests, git, or commands, use the relevant Pyash tools before answering and report concrete evidence. For general advice, answer directly without unnecessary tool calls.",
  "Do not pretend a change was made when a tool did not succeed.",
  "Keep work inside the configured coding directory and prefer small, verifiable steps.",
  "For code changes, name the target file before editing; use write for bounded file creation and repair for unified-diff edits.",
  "After the final edit, use command to run the narrowest relevant test, build, syntax check, or execution check. A check run before the final edit does not count.",
  "Before reporting completion, state the changed file paths, summarize the change, and give the exact check command and its result. If work or verification is incomplete, say so plainly instead of saying done.",
  "Respond concisely with the result and any remaining blocker."
].join(" ");

const SADDLE_CHANGE_ACTION = /\b(?:add|build|change|create|edit|fix|generate|implement|make|modify|patch|refactor|remove|rewrite|update|write)\b/iu;
const SADDLE_CODE_TARGET = /\b(?:code|program|script|source|file|function|class|module|test|bug|tool|harness|command|repository|repo|pipeline|variable|package|configuration|config)\b|\.(?:mjs|js|cjs|ts|py|pya|json|sh|md)\b/iu;

export function isSaddleCodeChangeRequest(input = "") {
  const text = String(input ?? "").replace(
    /\b(?:i|we)\s+(?:just\s+)?(?:did|made|completed|finished)\s+(?:an?\s+)?(?:add|build|change|create|edit|fix|generate|implement|make|modify|patch|refactor|remove|rewrite|update|write)\b/giu,
    " "
  );
  if (!SADDLE_CHANGE_ACTION.test(text)) return false;
  if (/\b(?:fix|implement|patch|refactor)\b/iu.test(text)) return true;
  return SADDLE_CODE_TARGET.test(text);
}

function eventToolName(event = {}) {
  return String(event.toolName ?? event.tool_name ?? event.toolCall?.function?.name ?? "").trim().toLowerCase();
}

function eventArguments(event = {}) {
  const raw = event.toolCall?.function?.arguments ?? event.toolCall?.arguments;
  if (raw && typeof raw === "object") return raw;
  if (typeof raw === "string") {
    try { return JSON.parse(raw); } catch { return {}; }
  }
  return {};
}

function toolKind(name = "") {
  const parts = String(name).split(/[^a-z0-9]+/u).filter(Boolean);
  return parts[0] === "be" ? parts[1] ?? "" : parts[0] ?? "";
}

function eventSentence(event = {}) {
  if (event.toolSentence && typeof event.toolSentence === "object") return event.toolSentence;
  const args = eventArguments(event);
  return args.sentence && typeof args.sentence === "object" ? args.sentence : args;
}

function commandText(event = {}) {
  const sentence = eventSentence(event);
  const args = eventArguments(event);
  const raw = sentence?.ob?.text ?? args.command ?? args.ob?.text ?? args.ob;
  return typeof raw === "string" ? raw.trim() : "";
}

function isMutatingCommand(text = "") {
  const command = String(text ?? "");
  return /\b(?:apply_patch|install|mkdir|mv|rm|tee|touch)\b|\b(?:cp|git)\s+(?:-[^\s]+\s+)*(?:add|apply|checkout|clean|commit|merge|move|rebase|reset|restore|rm|switch)\b|\bsed\s+-i\b|\bperl\s+-pi\b/iu.test(command)
    || /(?:^|[^<])>{1,2}\s*(?:["']?)(?:\/|\.\.?\/|~\/|[\w.-]+\/|[\w.-]+\.[a-z0-9_-]+)/iu.test(command);
}

function isValidationCommand(text = "") {
  const command = String(text ?? "").trim();
  if (!command) return false;
  return /(?:^|[;&|]\s*)(?:git\s+diff\s+--check\b|(?:npm|pnpm|yarn)\s+(?:run\s+)?(?:test|lint|build|check|typecheck)\b|(?:node|npx)\s+(?:--test\b|--check\b|[\w./-]+\.(?:mjs|js|cjs|ts)\b)|(?:python|python3)\s+[\w./-]+\.py\b|(?:bash|sh)\s+[\w./-]+\.sh\b|pytest\b|vitest\b|jest\b|eslint\b|tsc\b|mypy\b|ruff\b|(?:cargo|go)\s+test\b|make\s+(?:test|check|build)\b|\.\/run\s+\S+)/iu.test(command);
}

function isToolFailure(text = "") {
  const value = String(text ?? "");
  return /\b(?:isError|is_error)\s*["']?\s*:\s*true\b|\b(?:command|write|repair) defective\b|\bexit=(?:[1-9]\d*|unknown)\b|"be"\s*:\s*"error"/iu.test(value);
}

function changedPathForEvent(event = {}) {
  const sentence = eventSentence(event);
  const args = eventArguments(event);
  const target = sentence?.to?.filename ?? args.to?.filename ?? args.filename;
  if (typeof target === "string" && target.trim()) return target.trim();
  const patch = sentence?.ob?.text ?? args.ob?.text ?? args.ob;
  if (typeof patch !== "string") return "";
  const match = patch.match(/^\+\+\+ b\/(.+)$/mu);
  return match?.[1]?.trim() ?? "";
}

function pairToolEvents(events = []) {
  const pending = new Map();
  const calls = [];
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index] ?? {};
    const stage = String(event.stage ?? "").toLowerCase();
    const name = eventToolName(event);
    if (!name) continue;
    if (stage === "call") {
      const call = { event, name, index, resultText: "", resultIndex: -1 };
      calls.push(call);
      const queue = pending.get(name) ?? [];
      queue.push(call);
      pending.set(name, queue);
    } else if (stage === "result") {
      const queue = pending.get(name);
      const call = queue?.shift();
      if (call) {
        call.resultText = String(event.toolText ?? event.tool_text ?? "");
        call.resultIndex = index;
      }
    }
  }
  return calls;
}

export function assessSaddleCompletion(input = "", events = []) {
  if (!isSaddleCodeChangeRequest(input)) {
    return { required: false, complete: true, missing: [], changedPaths: [], validation: null };
  }

  const calls = pairToolEvents(events);
  const mutations = calls.filter((call) => {
    if (call.resultIndex < 0 || isToolFailure(call.resultText)) return false;
    const kind = toolKind(call.name);
    if (kind === "write") return true;
    if (kind === "repair") return !/\bcheck\b/iu.test(call.name);
    return kind === "command" && isMutatingCommand(commandText(call.event));
  });
  const lastMutation = mutations.reduce((latest, call) => Math.max(latest, call.index), -1);
  const validations = calls.filter((call) => toolKind(call.name) === "command"
    && !isMutatingCommand(commandText(call.event))
    && isValidationCommand(commandText(call.event))
    && call.resultIndex > lastMutation
    && !isToolFailure(call.resultText));
  const validation = validations.at(-1) ?? null;
  const missing = [];
  if (mutations.length === 0) missing.push("a successful file-changing tool call");
  if (!validation) missing.push("a successful relevant validation command after the final edit");
  return {
    required: true,
    complete: missing.length === 0,
    missing,
    changedPaths: [...new Set(mutations.map((call) => changedPathForEvent(call.event)).filter(Boolean))],
    changeTools: [...new Set(mutations.map((call) => call.name))],
    validation: validation ? {
      command: commandText(validation.event),
      output: validation.resultText.trim().slice(0, 240)
    } : null
  };
}

export function buildSaddleCompletionFollowup(input = "", assessment = {}) {
  const missing = Array.isArray(assessment.missing) ? assessment.missing : [];
  return [
    "Harness completion check: the original code-change request is not complete yet.",
    `Original request: ${String(input ?? "").trim()}`,
    `Missing evidence: ${missing.join("; ") || "report the actual changed files and check"}.`,
    "Continue the original task using the available Pyash tools; do not merely restate your previous answer. Make the requested change, then run a relevant validation command after the last edit. If blocked, report the exact tool error and leave the task explicitly incomplete."
  ].join("\n");
}

export function formatSaddleCompletionEvidence(assessment = {}) {
  if (!assessment.required) return "";
  if (!assessment.complete) return `[saddle incomplete] ${assessment.missing.join("; ")}.`;
  const changed = assessment.changedPaths.length ? assessment.changedPaths.join(", ") : assessment.changeTools.join(", ");
  const output = assessment.validation.output ? ` -> ${assessment.validation.output}` : " (returned successfully)";
  return `[saddle evidence] changed: ${changed}; command: ${assessment.validation.command}${output}`;
}

export async function runSaddleTurnWithEvidence({ input, runTurn, onToolCall, onFollowup } = {}) {
  if (typeof runTurn !== "function") throw new TypeError("runSaddleTurnWithEvidence requires runTurn");
  const events = [];
  const invoke = (turnInput) => runTurn({
    input: turnInput,
    onToolCall: async (event) => {
      events.push(event);
      await onToolCall?.(event);
    }
  });
  let result = await invoke(input);
  let assessment = assessSaddleCompletion(input, events);
  let retried = false;
  let retryError = "";
  if (assessment.required && !assessment.complete) {
    retried = true;
    await onFollowup?.(assessment);
    try {
      result = await invoke(buildSaddleCompletionFollowup(input, assessment));
    } catch (error) {
      retryError = String(error?.message ?? error);
    }
    assessment = assessSaddleCompletion(input, events);
  }
  return { result, assessment, retried, retryError, events };
}

function normalizeText(value) {
  return String(value ?? "").trim();
}

export function layoutSaddleInput({ value = "", cursor, label = "pyash> ", columns = 80 } = {}) {
  const text = String(value ?? "");
  const prefix = String(label ?? "");
  const cursorIndex = Math.max(0, Math.min(text.length, Number.isInteger(cursor) ? cursor : text.length));
  // Leave the terminal's final column unused so redraws never trigger implicit autowrap.
  const maxColumn = Math.max(1, Math.floor(Number(columns) || 80) - 1);
  const lines = [""];
  let row = 0;
  let column = 0;
  let cursorPosition = null;
  const rendered = `${prefix}${text}`;
  const renderedCursor = prefix.length + cursorIndex;

  for (let index = 0; index < rendered.length; index += 1) {
    const character = rendered[index];
    if (character === "\n") {
      if (index === renderedCursor) cursorPosition = { row, column };
      lines.push("");
      row += 1;
      column = 0;
      if (index + 1 === renderedCursor) cursorPosition = { row, column };
      continue;
    }
    if (column >= maxColumn) {
      lines.push("");
      row += 1;
      column = 0;
    }
    if (index === renderedCursor) cursorPosition = { row, column };
    lines[row] += character;
    column += 1;
  }

  if (renderedCursor === rendered.length) cursorPosition = { row, column };
  return {
    lines,
    rowCount: lines.length,
    cursorRow: cursorPosition?.row ?? row,
    cursorColumn: cursorPosition?.column ?? column
  };
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
    ["minimax command mind", "minimax"],
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
  if (provider === "minimax") {
    if (["low", "medium", "high", "xhigh", "max"].includes(selected)) {
      return { value: selected, think: null, reasoningEffort: selected };
    }
  }
  if (provider === "zai") {
    if (["low", "high", "max"].includes(selected)) {
      return { value: selected, think: null, reasoningEffort: selected };
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
    mindFieldValue(profile.as) || (backend === "zai" ? "glm-5.3-flash" : backend === "minimax" ? "MiniMax-M3.1-Flash" : defaultModel)
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

const SADDLE_BACKEND_LABELS = new Map([
  ["ollama", "Ollama"],
  ["strata", "Strata"],
  ["zai", "Z.AI"],
  ["openai", "OpenAI"],
  ["minimax", "MiniMax"],
  ["openrouter", "OpenRouter"],
  ["litellm", "LiteLLM"],
  ["vllm", "vLLM"]
]);

const SADDLE_BACKEND_ORDER = ["ollama", "strata", "zai", "openai", "minimax", "openrouter", "litellm", "vllm"];

export function listSaddleBackendOptions({
  minds = [],
  defaultBackend = "ollama",
  defaultModel = "qwen3.5:9b",
  hostForBackend = () => "http://localhost:11434",
  currentBackend = "",
  currentMindName = "",
  currentModel = "",
  currentHost = ""
} = {}) {
  const profilesByName = new Map();
  for (const fact of Array.isArray(minds) ? minds : []) {
    if (fact?.be !== "mind" || !fact?.su?.name) continue;
    profilesByName.set(normalizeText(fact.su.name).toLowerCase(), fact);
  }

  const profiles = [...profilesByName.values()]
    .filter((profile) => normalizeText(profile.su.name).toLowerCase() === "mind" || mindFieldValue(profile.fromstate))
    .map((profile) => resolveSaddleMindProfile({
      mindName: profile.su.name,
      profile,
      defaultBackend,
      defaultModel,
      hostForBackend
    }));

  const normalizedCurrentBackend = normalizeSaddleBackend(currentBackend, "");
  if (normalizedCurrentBackend && !profiles.some((profile) => profile.backend === normalizedCurrentBackend)) {
    profiles.push({
      mindName: normalizeText(currentMindName) || normalizedCurrentBackend,
      backend: normalizedCurrentBackend,
      model: normalizeSaddleModel(currentModel, defaultModel),
      host: normalizeSaddleHost(currentHost || hostForBackend(normalizedCurrentBackend))
    });
  }

  const byBackend = new Map();
  for (const profile of profiles) {
    const backend = normalizeSaddleBackend(profile.backend, "");
    if (!backend) continue;
    const priority = (profile.mindName.toLowerCase() === normalizeText(currentMindName).toLowerCase() && backend === normalizedCurrentBackend ? 0 : 10)
      + (profile.mindName.toLowerCase() === backend ? 0 : 1)
      + (profile.mindName.toLowerCase() === "mind" ? 0 : 1);
    const existing = byBackend.get(backend);
    if (!existing || priority < existing.priority) byBackend.set(backend, { ...profile, backend, priority });
  }

  return [...byBackend.values()]
    .sort((left, right) => {
      const leftOrder = SADDLE_BACKEND_ORDER.indexOf(left.backend);
      const rightOrder = SADDLE_BACKEND_ORDER.indexOf(right.backend);
      return (leftOrder < 0 ? SADDLE_BACKEND_ORDER.length : leftOrder)
        - (rightOrder < 0 ? SADDLE_BACKEND_ORDER.length : rightOrder)
        || left.backend.localeCompare(right.backend);
    })
    .map(({ priority, ...profile }) => ({
      ...profile,
      value: profile.backend,
      label: SADDLE_BACKEND_LABELS.get(profile.backend) || profile.backend,
      current: profile.backend === normalizedCurrentBackend
    }));
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
  housekeeperUrl = "",
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
  if (normalizedBackend === "minimax") {
    const discovered = await fetchMiniMaxModels({
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
  const localBackend = ["ollama", "strata"].includes(normalizedBackend);
  if (!localBackend) {
    return {
      models: [...new Set(configured)],
      available: false,
      error: `model discovery is unsupported for backend ${normalizedBackend || "(empty)"}`
    };
  }
  const catalogHost = normalizeText(housekeeperUrl).replace(/\/+$/u, "");
  if (!catalogHost) {
    return {
      models: [...new Set(configured)],
      available: false,
      error: "GPU Housekeeper URL is required for local model discovery"
    };
  }
  const endpoint = `${catalogHost}/runtime/${normalizedBackend}/models`;
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timer = controller && Number.isFinite(Number(timeoutMs))
    ? setTimeout(() => controller.abort(), Number(timeoutMs))
    : null;
  try {
    const response = await fetchFn(endpoint, {
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
    const location = backend && !["ollama", "strata"].includes(backend) && host ? ` @ ${host}` : "";
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

export function formatSaddleBackendPicker({ backends = [] } = {}) {
  const choices = Array.isArray(backends) ? backends : [];
  const lines = ["available backends:"];
  choices.forEach((entry, index) => {
    const label = normalizeText(entry?.label || entry?.backend);
    const model = normalizeText(entry?.model);
    const current = entry?.current ? " (current)" : "";
    lines.push(`${index + 1}. ${label}${model ? ` — ${model}` : ""}${current}`);
  });
  lines.push("Enter a number or backend name; Ctrl+C cancels.");
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
  if (["none", "low", "medium", "high", "xhigh", "max"].includes(String(reasoningEffort ?? "").trim().toLowerCase())) {
    sentence.reasoningEffort = String(reasoningEffort).trim().toLowerCase();
  }
  return sentence;
}

export function formatSaddleStatus({
  mindName = "mind",
  model,
  backend = "",
  housekeeperUrl = "",
  contextWindow,
  thinkMode,
  host,
  cwd,
  queue,
  busy = false,
  session = "coding"
} = {}) {
  const queueValue = queue?.available === false
    ? "unavailable"
    : queue && typeof queue === "object" && (queue.queuedCount !== undefined || queue.runningCount !== undefined)
      ? `${Number(queue.queuedCount ?? 0) || 0} queued, ${Number(queue.runningCount ?? 0) || 0} running`
      : queue && typeof queue === "object"
        ? (Number(queue.total ?? queue.runtime ?? queue.input ?? queue.queueDepth ?? 0) || 0)
        : Number(queue ?? 0) || 0;
  const localBackend = ["ollama", "strata"].includes(normalizeSaddleBackend(backend));
  return [
    `mind: ${normalizeText(mindName) || "mind"}`,
    `model: ${normalizeSaddleModel(model)}`,
    ...(Number.isSafeInteger(Number(contextWindow)) && Number(contextWindow) > 0
      ? [`context: ${Number(contextWindow).toLocaleString("en-CA")} tokens`]
      : []),
    ...(normalizeText(thinkMode) ? [`thinking: ${normalizeText(thinkMode)}`] : []),
    ...(localBackend
      ? [`route: GPU Housekeeper ${normalizeText(housekeeperUrl) || "(not configured)"}`]
      : [`host: ${normalizeSaddleHost(host)}`]),
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
  const label = stage === "CALL" ? "tool call" : stage === "RESULT" ? "tool result" : stage === "RATIFY" ? "tool approval" : `tool ${stage.toLowerCase()}`;
  return `[${label}] ${tool}`;
}

export function startSaddleProgress({
  backend,
  model,
  onProgress,
  intervalMs = 5000,
  now = Date.now,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval
} = {}) {
  if (typeof onProgress !== "function") return () => {};
  const startedAt = now();
  const timer = setIntervalFn(() => {
    const elapsedSeconds = Math.max(1, Math.floor((now() - startedAt) / 1000));
    onProgress(`working... ${elapsedSeconds}s elapsed (${normalizeText(backend) || "model"} / ${normalizeText(model) || "unknown"})`);
  }, Math.max(250, Number(intervalMs) || 5000));
  timer?.unref?.();
  return () => clearIntervalFn(timer);
}
