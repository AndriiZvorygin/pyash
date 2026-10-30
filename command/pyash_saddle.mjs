#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import readline from "node:readline/promises";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { allRemember, forget, remember, doRemember } from "../program/remember/index.mjs";
import { setEntryModulePath } from "../program/bridge/modules.mjs";
import { loadDefaultConfig } from "./run_pya_helpers.mjs";
import { resolveConfigText } from "../program/configure/env.mjs";
import { resolveAgentHouse, ensureAgentDirs } from "../program/agent/session.mjs";
import { mind_to_name_text } from "../program/verbs/mind/mind.mjs";
import { requestMindInterrupt } from "../program/agent/interrupt.mjs";
import { queueDepth } from "../program/runtime/gpu/queue.mjs";
import { dischargeOllamaMind } from "../program/motor/ollama_admin.mjs";
import {
  formatZaiContextWindow,
  getZaiCodexContextWindow,
  getZaiContextWindowOptions,
  getZaiModelContextLimit,
  setZaiCodexContextWindow,
  syncZaiCodexModelCatalog
} from "../program/runtime/zai_coding_plan.mjs";
import { requestCodingDutyHub, resolveCodingDutyHub } from "../program/agent/coding_duty_client.mjs";
import {
  appendSaddleUsage,
  formatSaddleUsageSummary,
  readSaddleUsageSummary
} from "../program/agent/coding_saddle_usage.mjs";
import { formatMindUsage, normalizeMindUsage, sumMindUsages } from "../program/verbs/mind/usage.mjs";
import {
  buildSaddleMindSentence,
  createSaddleInputDecoder,
  DEFAULT_CODING_SADDLE_SYSTEM_PROMPT,
  discoverSaddleModels,
  formatSaddleModelPicker,
  formatSaddleStatus,
  listSaddleMindNames,
  normalizeSaddleBackend,
  normalizeSaddleHost,
  normalizeSaddleModel,
  normalizeSaddleThinkSelection,
  resolveSaddleModelOption,
  resolveSaddleMindProfile,
  parseSaddleMindCommand,
  SADDLE_OLLAMA_CONTEXT_PRESETS,
  saddleToolEventLabel
} from "../program/agent/coding_saddle.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const AGENT_NAME = "coding saddle";
const TOOL_MAP_NAME = "saddle tools";
const SESSION_NAME = "coding";

function configValue(name, fallback = "") {
  return String(resolveConfigText(name, { rememberFn: remember }) ?? fallback).trim();
}

function resolveSaddleHost(backend) {
  if (backend === "ollama") return configValue("ollama host", "http://localhost:11434");
  if (backend === "zai") return "https://api.z.ai/api/v1";
  return configValue("ai host", configValue("ollama host", "http://localhost:11434"));
}

function resolveConfiguredSaddleMind(mindName) {
  const profile = remember(mindName);
  const usesGlobalDefaults = String(mindName).trim().toLowerCase() === "mind" && !profile?.fromstate;
  const selectedProfile = usesGlobalDefaults ? { ...profile, as: undefined, from: undefined } : profile;
  return resolveSaddleMindProfile({
    mindName,
    profile: selectedProfile,
    defaultBackend: normalizeSaddleBackend(configValue("mind backend", "ollama")),
    defaultModel: configValue("mind model", "qwen3.5:9b"),
    hostForBackend: resolveSaddleHost
  });
}

async function importSaddleTools() {
  const modulePath = path.join(root, "module", "saddle_tools.pya");
  const sentence = parse(`from filename ${JSON.stringify(modulePath)} ob name saddle tools to name saddle tools be import do`);
  await interpret(sentence);
}

function configureSaddle({ cwd, runtimeRoot = cwd, worldRoot = path.join(cwd, "world"), model, backend, host, systemPrompt }) {
  const toolMap = remember(TOOL_MAP_NAME);
  if (toolMap?.be === "map") {
    doRemember({
      ...toolMap,
      at: { filename: cwd }
    });
  }
  doRemember({
    mood: "ya",
    su: { name: "run root" },
    be: "default",
    ob: { filename: path.resolve(runtimeRoot) }
  });
  doRemember({
    mood: "ya",
    su: { name: "world root" },
    be: "root",
    ob: { filename: path.resolve(worldRoot) }
  });
  doRemember({
    mood: "ya",
    su: { name: "coding saddle system" },
    be: "text",
    ob: { text: systemPrompt }
  });
  doRemember({
    mood: "ya",
    su: { name: AGENT_NAME },
    be: "mind",
    as: { name: model },
    fromstate: { text: backend },
    from: { text: host },
    fromtext: { text: systemPrompt }
  });
}

export async function prepareSaddle({
  cwd = process.cwd(),
  runtimeRoot = cwd,
  worldRoot = path.join(runtimeRoot, "world"),
  mindName = process.env.PYA_SADDLE_MIND,
  model = process.env.PYA_SADDLE_MODEL,
  host = process.env.PYA_SADDLE_HOST,
  systemPrompt = DEFAULT_CODING_SADDLE_SYSTEM_PROMPT
} = {}) {
  const resolvedCwd = path.resolve(cwd);
  const resolvedRuntimeRoot = path.resolve(runtimeRoot);
  const resolvedWorldRoot = path.resolve(worldRoot);
  setEntryModulePath(resolvedCwd);
  forget();
  await loadDefaultConfig({ cwd: resolvedRuntimeRoot, interpretFn: interpret, entryPath: path.join(resolvedRuntimeRoot, "saddle.pya") });
  await importSaddleTools();
  const selectedMind = String(mindName || configValue("coding saddle mind", "mind")).trim();
  const profileResolved = resolveConfiguredSaddleMind(selectedMind);
  const resolvedBackend = profileResolved.backend;
  const resolvedModel = normalizeSaddleModel(model || profileResolved.model);
  const resolvedHost = normalizeSaddleHost(host || profileResolved.host);
  const mindModels = new Map([[selectedMind, resolvedModel]]);
  configureSaddle({
    cwd: resolvedCwd,
    runtimeRoot: resolvedRuntimeRoot,
    worldRoot: resolvedWorldRoot,
    model: resolvedModel,
    backend: resolvedBackend,
    host: resolvedHost,
    systemPrompt
  });
  const agentHouse = resolveAgentHouse({ mindName: AGENT_NAME, rememberFn: remember });
  await ensureAgentDirs(agentHouse);
  return {
    cwd: resolvedCwd,
    runtimeRoot: resolvedRuntimeRoot,
    worldRoot: resolvedWorldRoot,
    mindName: selectedMind,
    model: resolvedModel,
    backend: resolvedBackend,
    host: resolvedHost,
    mindModels,
    agentHouse,
    systemPrompt
  };
}

export async function runSaddleTurn({
  input,
  model,
  backend,
  host,
  contextWindow,
  think,
  reasoningEffort,
  sessionName = SESSION_NAME,
  sessionFile = "",
  sessionUserMetadata = null,
  onUsage,
  onToolCall,
  mindFn = mind_to_name_text
} = {}) {
  const sentence = buildSaddleMindSentence({
    input,
    model,
    backend,
    host,
    contextWindow,
    think,
    reasoningEffort,
    mindName: AGENT_NAME,
    toolMapName: TOOL_MAP_NAME,
    sessionName,
    sessionFile
  });
  const emitUsage = (usage) => {
    const normalized = normalizeMindUsage(usage);
    if (!normalized) return null;
    if (typeof onUsage !== "function") return normalized;
    return onUsage(normalized);
  };
  return mindFn(sentence, {
    onToolCall,
    onUsage: emitUsage,
    sessionUserContent: String(input ?? ""),
    sessionUserMetadata
  });
}

async function dischargeSaddleModel(model, backend) {
  if (normalizeSaddleBackend(backend) !== "ollama") return;
  await dischargeOllamaMind(model, { rememberFn: remember, timeoutMs: 3000 });
}

function writeLine(text = "") {
  process.stdout.write(`${String(text)}\n`);
}

function clearRenderedInput(rows) {
  const count = Math.max(1, Number(rows) || 1);
  if (count > 1) process.stdout.write(`\u001b[${count - 1}A`);
  for (let index = 0; index < count; index += 1) {
    process.stdout.write("\u001b[2K\r");
    if (index < count - 1) process.stdout.write("\u001b[1B");
  }
  if (count > 1) process.stdout.write(`\u001b[${count - 1}A`);
  process.stdout.write("\r");
}

function renderInput(state, { rows = 1, clear = true, label = "pyash> " } = {}) {
  if (clear) clearRenderedInput(rows);
  const lines = String(state?.value ?? "").split("\n");
  process.stdout.write(`${label}${lines.join("\n")}`);
  const cursorLine = lines.length - 1;
  const cursorColumn = String(lines[cursorLine] ?? "").length;
  if (cursorLine > 0) process.stdout.write(`\u001b[${cursorLine}A`);
  process.stdout.write(`\r\u001b[${label.length + (cursorLine === 0 ? cursorColumn : 0)}C`);
  if (cursorLine > 0) process.stdout.write(`\u001b[${cursorLine}B\r\u001b[${label.length + cursorColumn}C`);
  return lines.length;
}

async function resumeDuty(dutyId) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("resuming a duty requires an interactive terminal");
  }
  const id = String(dutyId ?? "").trim();
  if (!/^duty-[a-z0-9._-]+$/iu.test(id)) throw new Error("provide a duty ID, for example duty-...");
  const hub = resolveCodingDutyHub();
  const route = `/api/duties/${encodeURIComponent(id)}`;
  const showDuty = async () => (await requestCodingDutyHub(hub, route)).duty;
  const duty = await showDuty();
  process.stdout.write(`Pyash duty: ${duty.title}\n`);
  process.stdout.write(`Directory: ${duty.repositoryId} · Access: ${duty.permissionScope || "project"} · Worker: ${duty.workerId} · ${duty.status}\n`);
  process.stdout.write("History:\n");
  for (const message of duty.messages || []) {
    process.stdout.write(`${message.role === "user" ? "you" : "pyash"}> ${message.text}\n`);
  }
  process.stdout.write("Enter sends an instruction; /permissions shows or changes access; /refresh reloads; /accept accepts an idle duty; /exit leaves it running.\n");

  const terminal = readline.createInterface({ input: process.stdin, output: process.stdout });
  const printedReplies = new Set((duty.messages || []).filter((message) => message.role === "assistant").map((message) => message.id));
  let refreshing = false;
  const refresh = async () => {
    if (refreshing) return;
    refreshing = true;
    try {
      const latest = await showDuty();
      for (const message of latest.messages || []) {
        if (message.role !== "assistant" || printedReplies.has(message.id)) continue;
        printedReplies.add(message.id);
        process.stdout.write(`\npyash> ${message.text}\n`);
      }
    } catch (error) {
      process.stdout.write(`\nduty status unavailable: ${error.message}\n`);
    } finally {
      refreshing = false;
    }
  };
  const watcher = setInterval(refresh, 2000);
  watcher.unref?.();
  try {
    while (true) {
      const input = (await terminal.question("you> ")).trim();
      if (!input) continue;
      if (input === "/exit" || input === "/quit") break;
      if (input === "/refresh") {
        const latest = await showDuty();
        process.stdout.write(`duty ${latest.status} · ${latest.permissionScope || "project"} access${latest.active ? " · worker active" : ""}\n`);
        continue;
      }
      if (input === "/permissions") {
        const latest = await showDuty();
        process.stdout.write(`Filesystem access: ${latest.permissionScope || "project"}. Project scope is Pyash tool-root policy, not an OS jail. Commands run as the worker account.\n`);
        process.stdout.write("Use /permissions project or /permissions home to change an idle duty. Home access may expose all files readable by the worker account.\n");
        continue;
      }
      if (input === "/permissions project" || input === "/permissions home") {
        const permissionScope = input.endsWith("home") ? "home" : "project";
        if (permissionScope === "home") {
          const confirmation = (await terminal.question("This permits access to the worker account's entire home directory. Type yes to confirm: ")).trim().toLowerCase();
          if (confirmation !== "yes") {
            process.stdout.write("Home access unchanged.\n");
            continue;
          }
        }
        const result = await requestCodingDutyHub(hub, `${route}/permissions`, {
          method: "POST",
          body: { permissionScope }
        });
        process.stdout.write(`Filesystem access set to ${result.duty.permissionScope}.\n`);
        continue;
      }
      if (input === "/accept") {
        const result = await requestCodingDutyHub(hub, `${route}/accept`, { method: "POST" });
        process.stdout.write(`duty ${result.duty.status}\n`);
        continue;
      }
      const queued = await requestCodingDutyHub(hub, `${route}/messages`, {
        method: "POST",
        body: { message: input }
      });
      process.stdout.write(`duty ${queued.duty.status} · instruction queued\n`);
      void refresh();
    }
  } finally {
    clearInterval(watcher);
    terminal.close();
  }
}

async function main() {
  if (process.argv[2] === "resume") {
    await resumeDuty(process.argv[3]);
    return;
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    writeLine("pyash saddle requires an interactive terminal");
    process.exitCode = 1;
    return;
  }

  const config = await prepareSaddle({ cwd: process.env.PYA_SADDLE_CWD || process.cwd() });
  let model = config.model;
  let mindName = config.mindName;
  const mindModels = config.mindModels;
  let backend = config.backend;
  let host = config.host;
  let contextWindow = backend === "zai" ? getZaiCodexContextWindow({ model }) : null;
  let thinkSetting = null;
  let busy = false;
  let closing = false;
  let modelPicker = null;
  let modelPickerLoading = false;
  let contextPicker = null;
  let thinkPicker = null;
  let promptLabel = "pyash> ";
  let renderedRows = 1;

  const showStatus = async () => {
    const queue = await queueDepth(path.join(config.cwd, "world")).catch(() => ({ total: 0 }));
    writeLine(formatSaddleStatus({ mindName, model, contextWindow, thinkMode: thinkSetting?.value, host, cwd: config.cwd, queue, busy, session: SESSION_NAME }));
  };
  const prompt = ({ clear = true, label = promptLabel } = {}) => {
    promptLabel = label;
    renderedRows = renderInput({ value: "", cursor: 0 }, { rows: renderedRows, clear, label });
  };
  const showModelPicker = async () => {
    modelPickerLoading = true;
    writeLine("discovering models...");
    prompt({ clear: false, label: "model loading> " });
    const fallbackModels = String(process.env.PYA_SADDLE_MODELS || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    const discovered = await discoverSaddleModels({ backend, host, currentModel: model, fallbackModels });
    if (backend === "zai" && discovered.available && discovered.catalogModels?.length) {
      try {
        const refreshed = syncZaiCodexModelCatalog({ models: discovered.catalogModels });
        if (refreshed.updated) writeLine(`Codex Z.AI catalog refreshed: ${refreshed.models.length} models`);
      } catch (error) {
        writeLine(`Codex Z.AI catalog refresh failed: ${String(error?.message ?? error)}`);
      }
    }
    const discoveredOptions = discovered.models.map((entry) => ({
      model: entry,
      value: entry,
      backend,
      host,
      label: entry
    }));
    const options = [
      ...discoveredOptions
    ];
    modelPicker = [...new Map(options
      .filter((entry) => entry?.model)
      .map((entry) => [entry.value || `${entry.backend || backend}::${entry.model}`, entry]))
      .values()];
    if (!modelPicker.length) {
      modelPicker = [{ model, value: model, backend, host, label: model }];
    }
    modelPickerLoading = false;
    writeLine(formatSaddleModelPicker({
      models: modelPicker,
      currentModel: model,
      currentBackend: backend,
      error: discovered.available ? "" : discovered.error
    }));
    prompt({ clear: false, label: "select model> " });
  };
  const showContextPicker = () => {
    if (backend === "strata") {
      writeLine("Strata context is fixed when its server launches; Pyash cannot change it per request. Configure the Strata launch context and restart it through its normal GPU-managed process.");
      prompt({ clear: false });
      return;
    }
    if (backend === "zai") {
      const maximum = getZaiModelContextLimit({ model });
      const options = getZaiContextWindowOptions({ model });
      contextPicker = options.map((tokens) => ({
        model: String(tokens),
        value: formatZaiContextWindow(tokens),
        label: formatZaiContextWindow(tokens),
        tokens
      }));
      writeLine(`context window for ${model}: current ${formatZaiContextWindow(contextWindow)}, model maximum ${formatZaiContextWindow(maximum)}`);
      writeLine("Choose a size by number or label; this sets the client-side budget, not the provider's model limit.");
    } else if (backend === "ollama") {
      contextPicker = [
        { model: "default", value: "default", label: "Ollama default", tokens: null },
        ...SADDLE_OLLAMA_CONTEXT_PRESETS.map((tokens) => ({
          model: String(tokens),
          value: formatZaiContextWindow(tokens),
          label: formatZaiContextWindow(tokens),
          tokens
        }))
      ];
      writeLine(`Ollama context for ${model}: current ${contextWindow ? formatZaiContextWindow(contextWindow) : "Ollama default"}`);
      writeLine("Choose a request num_ctx preset. Larger contexts use more memory; default leaves Ollama unchanged.");
    } else {
      writeLine("Per-request context selection is supported here only for Ollama and Z.AI; Strata context is set at server launch.");
      prompt({ clear: false });
      return;
    }
    for (const [index, option] of contextPicker.entries()) {
      writeLine(`${index + 1}. ${option.label}${option.tokens === contextWindow ? " (current)" : ""}`);
    }
    prompt({ clear: false, label: "select context> " });
  };
  const showThinkPicker = () => {
    if (!["ollama", "strata"].includes(backend)) {
      writeLine("/think controls are available for Ollama and Strata minds");
      prompt({ clear: false });
      return;
    }
    const options = backend === "ollama" ? ["off", "on"] : ["none", "low", "medium", "high"];
    thinkPicker = options.map((value) => ({ model: value, value, label: value }));
    writeLine(backend === "ollama"
      ? `thinking for ${model}: current ${thinkSetting?.value ?? "model default"}`
      : `reasoning effort for ${model}: current ${thinkSetting?.value ?? "Strata default"}`);
    for (const [index, option] of thinkPicker.entries()) {
      writeLine(`${index + 1}. ${option.label}${option.value === thinkSetting?.value ? " (current)" : ""}`);
    }
    writeLine(backend === "ollama"
      ? "Choose whether to request thinking; model support varies."
      : "Choose the Strata reasoning effort for subsequent requests.");
    prompt({ clear: false, label: "select thinking> " });
  };
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    if (busy) {
      await requestMindInterrupt({
        worldRoot: path.join(config.cwd, "world"),
        agentName: AGENT_NAME,
        source: "coding saddle",
        reason: "terminal exit"
      }).catch(() => {});
    }
    await dischargeSaddleModel(model, backend).catch((error) => writeLine(`discharge: ${error.message}`));
    if (process.stdin.isRaw) process.stdin.setRawMode(false);
    process.stdin.pause();
    writeLine("saddle closed");
  };
  const submit = async (value) => {
    const input = String(value ?? "");
    if (!input.trim() || busy || closing) {
      prompt({ clear: false });
      return;
    }
    if (input.trim() === "/exit" || input.trim() === "/quit") {
      await shutdown();
      return;
    }
    if (modelPickerLoading) {
      writeLine("model discovery is still running; please choose after the list appears");
      prompt({ clear: false, label: "model loading> " });
      return;
    }
    if (contextPicker) {
      const selected = resolveSaddleModelOption(input, contextPicker);
      if (!selected) {
        writeLine("invalid context window selection");
        prompt({ clear: false, label: "select context> " });
        return;
      }
      if (backend === "zai") {
        const saved = setZaiCodexContextWindow({ model, contextWindow: selected.tokens });
        if (!saved.updated) {
          contextPicker = null;
          writeLine(`could not save context window: ${saved.reason}`);
          prompt({ clear: false });
          return;
        }
      }
      contextWindow = selected.tokens == null ? null : Number(selected.tokens);
      contextPicker = null;
      writeLine(backend === "zai"
        ? `context window: ${formatZaiContextWindow(contextWindow)} for ${model}; saved for Pyash and future Codex sessions`
        : `Ollama request context: ${contextWindow ? formatZaiContextWindow(contextWindow) : "provider default"} for ${model}; applies for this saddle session`);
      prompt({ clear: false });
      return;
    }
    if (thinkPicker) {
      const selected = resolveSaddleModelOption(input, thinkPicker);
      if (!selected) {
        writeLine("invalid thinking selection");
        prompt({ clear: false, label: "select thinking> " });
        return;
      }
      thinkSetting = normalizeSaddleThinkSelection(selected.value, backend);
      thinkPicker = null;
      writeLine(backend === "ollama"
        ? `thinking: ${thinkSetting.value} for ${model}`
        : `reasoning effort: ${thinkSetting.value} for ${model}`);
      prompt({ clear: false });
      return;
    }
    if (modelPicker) {
      const selected = resolveSaddleModelOption(input, modelPicker);
      if (!selected) {
        writeLine("invalid model selection");
        prompt({ clear: false, label: "select model> " });
        return;
      }
      modelPicker = null;
      model = normalizeSaddleModel(selected.model, model);
      mindModels.set(mindName, model);
      if (backend === "zai") {
        contextWindow = Math.min(contextWindow || getZaiCodexContextWindow({ model }), getZaiModelContextLimit({ model }));
      } else {
        contextWindow = null;
      }
      thinkSetting = null;
      promptLabel = "pyash> ";
      configureSaddle({ cwd: config.cwd, model, backend, host, systemPrompt: config.systemPrompt });
      writeLine(`model: ${model} (mind ${mindName})`);
      prompt({ clear: false });
      return;
    }
    if (input.trim() === "/help") {
      writeLine("/status  /mind [name]  /model <name>  /context [size]  /think [mode]  /host <url>  /usage  /discharge  /exit");
      prompt({ clear: false });
      return;
    }
    if (input.trim() === "/usage") {
      const usage = await readSaddleUsageSummary({ worldRoot: config.worldRoot });
      writeLine(formatSaddleUsageSummary(usage));
      prompt({ clear: false });
      return;
    }
    const mindCommand = parseSaddleMindCommand(input);
    if (mindCommand?.type === "list") {
      const names = listSaddleMindNames({ minds: allRemember(), activeMindName: AGENT_NAME });
      writeLine(`available minds: ${names.map((name) => `${name}${name === mindName ? " (current)" : ""}`).join(", ")}`);
      prompt({ clear: false });
      return;
    }
    if (mindCommand?.type === "select") {
      const nextMindName = mindCommand.mindName;
      const available = listSaddleMindNames({ minds: allRemember(), activeMindName: AGENT_NAME });
      if (!available.some((name) => name.toLowerCase() === nextMindName.toLowerCase())) {
        writeLine(`unknown Pyash mind: ${nextMindName}; available: ${available.join(", ")}`);
        prompt({ clear: false });
        return;
      }
      const canonicalName = available.find((name) => name.toLowerCase() === nextMindName.toLowerCase());
      await dischargeSaddleModel(model, backend).catch((error) => writeLine(`discharge: ${error.message}`));
      const nextProfile = resolveConfiguredSaddleMind(canonicalName);
      mindName = canonicalName;
      backend = nextProfile.backend;
      host = nextProfile.host;
      model = normalizeSaddleModel(mindModels.get(mindName) || nextProfile.model);
      contextWindow = backend === "zai" ? getZaiCodexContextWindow({ model }) : null;
      thinkSetting = null;
      mindModels.set(mindName, model);
      configureSaddle({ cwd: config.cwd, model, backend, host, systemPrompt: config.systemPrompt });
      writeLine(`mind: ${mindName} | model: ${model}`);
      prompt({ clear: false });
      return;
    }
    if (input.trim() === "/model") {
      await showModelPicker();
      return;
    }
    const contextMatch = input.trim().match(/^\/context(?:\s+(.+))?$/i);
    if (contextMatch) {
      if (!contextMatch[1]) {
        showContextPicker();
        return;
      }
      if (backend === "strata") {
        writeLine("Strata context is fixed when its server launches; Pyash cannot change it per request. Configure the Strata launch context and restart it through its normal GPU-managed process.");
        prompt({ clear: false });
        return;
      }
      if (backend !== "zai" && backend !== "ollama") {
        writeLine("per-request context selection is supported here only for Ollama and Z.AI");
        prompt({ clear: false });
        return;
      }
      const choices = backend === "zai"
        ? getZaiContextWindowOptions({ model }).map((tokens) => ({
          model: String(tokens),
          value: formatZaiContextWindow(tokens),
          label: formatZaiContextWindow(tokens),
          tokens
        }))
        : ["default", ...SADDLE_OLLAMA_CONTEXT_PRESETS].map((tokens) => ({
          model: String(tokens),
          value: typeof tokens === "number" ? formatZaiContextWindow(tokens) : "default",
          label: typeof tokens === "number" ? formatZaiContextWindow(tokens) : "default",
          tokens: typeof tokens === "number" ? tokens : null
        }));
      const selected = resolveSaddleModelOption(contextMatch[1], choices);
      if (!selected) {
        writeLine(`unknown context size; available: ${choices.map((choice) => choice.label).join(", ")}`);
        prompt({ clear: false });
        return;
      }
      if (backend === "zai") {
        const saved = setZaiCodexContextWindow({ model, contextWindow: selected.tokens });
        if (!saved.updated) {
          writeLine(`could not save context window: ${saved.reason}`);
          prompt({ clear: false });
          return;
        }
      }
      contextWindow = selected.tokens == null ? null : Number(selected.tokens);
      writeLine(backend === "zai"
        ? `context window: ${formatZaiContextWindow(contextWindow)} for ${model}; saved for Pyash and future Codex sessions`
        : `Ollama request context: ${contextWindow ? formatZaiContextWindow(contextWindow) : "provider default"} for ${model}; applies for this saddle session`);
      prompt({ clear: false });
      return;
    }
    const thinkMatch = input.trim().match(/^\/think(?:\s+(.+))?$/i);
    if (thinkMatch) {
      if (!thinkMatch[1]) {
        showThinkPicker();
        return;
      }
      const selected = normalizeSaddleThinkSelection(thinkMatch[1], backend);
      if (!selected) {
        writeLine(backend === "ollama"
          ? "Ollama accepts /think on or /think off"
          : backend === "strata"
            ? "Strata accepts /think none, low, medium, high, on, or off"
            : "/think is available for Ollama and Strata minds");
        prompt({ clear: false });
        return;
      }
      thinkSetting = selected;
      writeLine(backend === "ollama"
        ? `thinking: ${selected.value} for ${model}`
        : `reasoning effort: ${selected.value} for ${model}`);
      prompt({ clear: false });
      return;
    }
    if (input.trim() === "/status") {
      await showStatus();
      prompt({ clear: false });
      return;
    }
    if (input.trim() === "/discharge") {
      await dischargeSaddleModel(model, backend).then(() => writeLine(`discharged: ${model}`)).catch((error) => writeLine(`discharge failed: ${error.message}`));
      prompt({ clear: false });
      return;
    }
    const modelMatch = input.trim().match(/^\/model\s+(.+)$/i);
    if (modelMatch) {
      model = normalizeSaddleModel(modelMatch[1], model);
      mindModels.set(mindName, model);
      contextWindow = backend === "zai" ? getZaiCodexContextWindow({ model }) : null;
      thinkSetting = null;
      configureSaddle({ cwd: config.cwd, model, backend, host, systemPrompt: config.systemPrompt });
      writeLine(`model: ${model}`);
      prompt({ clear: false });
      return;
    }
    const hostMatch = input.trim().match(/^\/host\s+(.+)$/i);
    if (hostMatch) {
      host = normalizeSaddleHost(hostMatch[1], host);
      configureSaddle({ cwd: config.cwd, model, backend, host, systemPrompt: config.systemPrompt });
      writeLine(`host: ${host}`);
      prompt({ clear: false });
      return;
    }

    busy = true;
    clearRenderedInput(renderedRows);
    writeLine(`you> ${input}`);
    writeLine(`saddle: queued ${model} via ${backend}`);
    const turnUsages = [];
    try {
      const result = await runSaddleTurn({
        input,
        model,
        backend,
        host,
        contextWindow,
        think: thinkSetting?.think,
        reasoningEffort: thinkSetting?.reasoningEffort,
        onUsage: (usage) => {
          turnUsages.push(usage);
          return usage;
        },
        onToolCall: async (event) => {
          if (event?.stage === "call" || event?.stage === "result" || event?.stage === "ratify") {
            writeLine(`${saddleToolEventLabel(event)}${event.toolText ? `: ${String(event.toolText).slice(0, 400)}` : ""}`);
          }
        }
      });
      const text = result?.ob?.text ?? result?.fromstate?.text ?? result?.value?.text ?? "";
      writeLine(`saddle> ${String(text).trim() || "(no response text)"}`);
      const usage = sumMindUsages(turnUsages);
      if (usage) {
        writeLine(formatMindUsage(usage));
        await appendSaddleUsage({
          worldRoot: config.worldRoot,
          turnId: result?.accordingto?.text ?? "",
          mindName,
          backend,
          model,
          usage
        }).catch((error) => writeLine(`usage record failed: ${error.message}`));
      }
    } catch (error) {
      writeLine(`saddle error> ${error?.message ?? error}`);
    } finally {
      busy = false;
      prompt({ clear: false });
    }
  };

  process.stdin.setEncoding("utf8");
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.on("SIGINT", () => { shutdown().catch(() => {}); });
  process.on("SIGTERM", () => { shutdown().catch(() => {}); });

  writeLine("Pyash coding saddle");
  writeLine("Enter submits; Shift+Enter or Ctrl+J inserts a newline; Ctrl+C interrupts; Ctrl+D exits.");
  await showStatus();
  const decoder = createSaddleInputDecoder({
    onSubmit: submit,
    onCancel: async () => {
      if (!busy) return;
      await requestMindInterrupt({
        worldRoot: path.join(config.cwd, "world"),
        agentName: AGENT_NAME,
        source: "coding saddle",
        reason: "user interrupt"
      }).catch(() => {});
      writeLine("interrupt requested");
    },
    onExit: () => { shutdown().catch(() => {}); },
    onChange: (state) => {
      if (!busy && !closing) renderedRows = renderInput(state, { rows: renderedRows, label: promptLabel });
    }
  });
  process.stdin.on("data", (chunk) => decoder.feed(chunk));
  prompt();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${String(error?.stack ?? error)}\n`);
    process.exitCode = 1;
  });
}

export { main, resumeDuty };
