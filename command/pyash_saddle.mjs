#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import readline from "node:readline/promises";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, remember, doRemember } from "../program/remember/index.mjs";
import { setEntryModulePath } from "../program/bridge/modules.mjs";
import { loadDefaultConfig } from "./run_pya_helpers.mjs";
import { resolveConfigText } from "../program/configure/env.mjs";
import { resolveAgentHouse, ensureAgentDirs } from "../program/agent/session.mjs";
import { mind_to_name_text } from "../program/verbs/mind/mind.mjs";
import { requestMindInterrupt } from "../program/agent/interrupt.mjs";
import { queueDepth } from "../program/runtime/gpu/queue.mjs";
import { dischargeOllamaMind } from "../program/motor/ollama_admin.mjs";
import { fetchWebModels } from "./pyash_web_server.mjs";
import { requestCodingDutyHub, resolveCodingDutyHub } from "../program/agent/coding_duty_client.mjs";
import {
  buildSaddleMindSentence,
  createSaddleInputDecoder,
  DEFAULT_CODING_SADDLE_SYSTEM_PROMPT,
  discoverSaddleModels,
  formatSaddleModelPicker,
  formatSaddleStatus,
  normalizeSaddleBackend,
  normalizeSaddleHost,
  normalizeSaddleModel,
  resolveSaddleModelOption,
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
  return configValue("ai host", configValue("ollama host", "http://localhost:11434"));
}

async function importSaddleTools() {
  const modulePath = path.join(root, "module", "saddle_tools.pya");
  const sentence = parse(`from filename ${JSON.stringify(modulePath)} ob name saddle tools to name saddle tools be import do`);
  await interpret(sentence);
}

function configureSaddle({ cwd, worldRoot = path.join(cwd, "world"), model, backend, host, systemPrompt }) {
  const toolMap = remember(TOOL_MAP_NAME);
  if (toolMap?.be === "map") {
    doRemember({
      ...toolMap,
      at: { filename: cwd }
    });
  }
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
  model = process.env.PYA_SADDLE_MODEL,
  backend = process.env.PYA_SADDLE_BACKEND,
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
  const resolvedBackend = normalizeSaddleBackend(backend || configValue("mind backend", "ollama"));
  const resolvedModel = normalizeSaddleModel(model || configValue("mind model", "qwen3.5:9b"));
  const resolvedHost = normalizeSaddleHost(host || resolveSaddleHost(resolvedBackend));
  configureSaddle({
    cwd: resolvedCwd,
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
    model: resolvedModel,
    backend: resolvedBackend,
    host: resolvedHost,
    agentHouse,
    systemPrompt
  };
}

export async function runSaddleTurn({
  input,
  model,
  backend,
  host,
  sessionName = SESSION_NAME,
  sessionFile = "",
  sessionUserMetadata = null,
  onToolCall,
  mindFn = mind_to_name_text
} = {}) {
  const sentence = buildSaddleMindSentence({
    input,
    model,
    backend,
    host,
    mindName: AGENT_NAME,
    toolMapName: TOOL_MAP_NAME,
    sessionName,
    sessionFile
  });
  return mindFn(sentence, {
    onToolCall,
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
  process.stdout.write(`Directory: ${duty.repositoryId} · Worker: ${duty.workerId} · ${duty.status}\n`);
  process.stdout.write("History:\n");
  for (const message of duty.messages || []) {
    process.stdout.write(`${message.role === "user" ? "you" : "pyash"}> ${message.text}\n`);
  }
  process.stdout.write("Enter sends an instruction; /refresh reloads; /accept accepts an idle duty; /exit leaves it running.\n");

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
        process.stdout.write(`duty ${latest.status}${latest.active ? " · worker active" : ""}\n`);
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
  let backend = config.backend;
  let host = config.host;
  let busy = false;
  let closing = false;
  let modelPicker = null;
  let modelPickerLoading = false;
  let promptLabel = "pyash> ";
  let renderedRows = 1;

  const showStatus = async () => {
    const queue = await queueDepth(path.join(config.cwd, "world")).catch(() => ({ total: 0 }));
    writeLine(formatSaddleStatus({ model, backend, host, cwd: config.cwd, queue, busy, session: SESSION_NAME }));
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
    const catalog = await fetchWebModels(model, backend).catch(() => ({ modelOptions: [], errors: {} }));
    const discoveredOptions = discovered.models.map((entry) => ({
      model: entry,
      value: entry,
      backend,
      host,
      label: backend === "ollama" ? entry : `${backend}: ${entry}`
    }));
    const options = [
      ...(Array.isArray(catalog.modelOptions) ? catalog.modelOptions : []),
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
      error: discovered.available && !catalog.errors?.strata ? "" : [
        discovered.available ? "" : discovered.error,
        catalog.errors?.strata
      ].filter(Boolean).join("; ")
    }));
    prompt({ clear: false, label: "select model> " });
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
    if (modelPicker) {
      const selected = resolveSaddleModelOption(input, modelPicker);
      if (!selected) {
        writeLine("invalid model selection");
        prompt({ clear: false, label: "select model> " });
        return;
      }
      modelPicker = null;
      model = normalizeSaddleModel(selected.model, model);
      backend = normalizeSaddleBackend(selected.backend, backend);
      host = normalizeSaddleHost(selected.host, host);
      promptLabel = "pyash> ";
      configureSaddle({ cwd: config.cwd, model, backend, host, systemPrompt: config.systemPrompt });
      writeLine(`model: ${model} via ${backend}${host ? ` @ ${host}` : ""}`);
      prompt({ clear: false });
      return;
    }
    if (input.trim() === "/help") {
      writeLine("/status  /model <name>  /backend <name>  /host <url>  /discharge  /exit");
      prompt({ clear: false });
      return;
    }
    if (input.trim() === "/model") {
      await showModelPicker();
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
      configureSaddle({ cwd: config.cwd, model, backend, host, systemPrompt: config.systemPrompt });
      writeLine(`model: ${model}`);
      prompt({ clear: false });
      return;
    }
    const backendMatch = input.trim().match(/^\/backend\s+(.+)$/i);
    if (backendMatch) {
      backend = normalizeSaddleBackend(backendMatch[1], backend);
      host = resolveSaddleHost(backend);
      configureSaddle({ cwd: config.cwd, model, backend, host, systemPrompt: config.systemPrompt });
      writeLine(`backend: ${backend} (${host})`);
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
    try {
      const result = await runSaddleTurn({
        input,
        model,
        backend,
        host,
        onToolCall: async (event) => {
          if (event?.stage === "call" || event?.stage === "result" || event?.stage === "ratify") {
            writeLine(`${saddleToolEventLabel(event)}${event.toolText ? `: ${String(event.toolText).slice(0, 400)}` : ""}`);
          }
        }
      });
      const text = result?.ob?.text ?? result?.fromstate?.text ?? result?.value?.text ?? "";
      writeLine(`saddle> ${String(text).trim() || "(no response text)"}`);
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
