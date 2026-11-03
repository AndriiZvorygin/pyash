#!/usr/bin/env node
import { createHash } from "node:crypto";
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
import {
  ensureAgentDirs,
  listSessionFiles,
  readSessionMessages,
  readSessionMessagesWithFallback,
  resolveAgentHouse
} from "../program/agent/session.mjs";
import {
  getCodingSaddleProfile,
  readCodingSaddleState,
  setCodingSaddleProfile,
  writeCodingSaddleState
} from "../program/agent/coding_saddle_state.mjs";
import { mind_to_name_text } from "../program/verbs/mind/mind.mjs";
import { requestMindInterrupt } from "../program/agent/interrupt.mjs";
import { queueDepth } from "../program/runtime/gpu/queue.mjs";
import { createGpuHousekeeperAdapter } from "../program/runtime/gpu/housekeeper_adapter.mjs";
import { resolveGpuHousekeeperUrl } from "../program/runtime/gpu/managed-ollama.mjs";
import {
  formatZaiContextWindow,
  getZaiCodexContextWindow,
  getZaiContextWindowOptions,
  getZaiModelContextLimit,
  setZaiCodexContextWindow,
  syncZaiCodexModelCatalog
} from "../program/runtime/zai_coding_plan.mjs";
import { requestCodingDutyHub, resolveCodingDutyHub } from "../program/agent/coding_duty_client.mjs";
import { createSaddleTerminalUi } from "../program/agent/coding_saddle_tui.mjs";
import {
  appendSaddleUsage,
  formatSaddleUsageSummary,
  readSaddleUsageSummary
} from "../program/agent/coding_saddle_usage.mjs";
import { formatMindUsage, normalizeMindUsage, sumMindUsages } from "../program/verbs/mind/usage.mjs";
import {
  buildSaddleMindSentence,
  buildSaddleStrataContextOptions,
  formatSaddleCompletionEvidence,
  runSaddleTurnWithEvidence,
  createSaddleInputDecoder,
  DEFAULT_CODING_SADDLE_SYSTEM_PROMPT,
  discoverSaddleModels,
  formatSaddleBackendPicker,
  formatSaddleModelPicker,
  formatSaddleStatus,
  listSaddleBackendOptions,
  listSaddleMindNames,
  normalizeSaddleBackend,
  normalizeSaddleHost,
  normalizeSaddleModel,
  normalizeSaddleThinkSelection,
  resolveSaddleThinkSetting,
  resolveSaddleModelOption,
  resolveSaddleMindProfile,
  parseSaddleMindCommand,
  SADDLE_OLLAMA_CONTEXT_PRESETS,
  saddleToolEventLabel,
  saddleSlashCommandCompletions,
  startSaddleProgress
} from "../program/agent/coding_saddle.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const AGENT_NAME = "coding saddle";
const TOOL_MAP_NAME = "saddle tools";
const SESSION_NAME = "coding";
const RECENT_MODEL_SESSION = "__recent_model__";

export function resolveSaddleProjectWorldRoot({ runtimeRoot, cwd } = {}) {
  const resolvedRuntimeRoot = path.resolve(runtimeRoot || root);
  const resolvedCwd = path.resolve(cwd || process.cwd());
  if (resolvedCwd === resolvedRuntimeRoot) return path.join(resolvedRuntimeRoot, "world");
  const projectId = createHash("sha256").update(resolvedCwd).digest("hex").slice(0, 24);
  return path.join(resolvedRuntimeRoot, "world", "coding-saddle-projects", projectId);
}

function resolveSaddleAgentHouseAtWorldRoot(worldRoot) {
  return resolveAgentHouse({
    mindName: AGENT_NAME,
    rememberFn: (name) => name === "world root"
      ? { ob: { filename: worldRoot } }
      : remember(name)
  });
}

function isPathWithin(directory, target) {
  const relative = path.relative(path.resolve(directory), path.resolve(target));
  return Boolean(relative)
    && relative !== ".."
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative);
}

function configValue(name, fallback = "") {
  return String(resolveConfigText(name, { rememberFn: remember }) ?? fallback).trim();
}

function resolveSaddleHousekeeperUrl(cwd = process.cwd()) {
  return resolveGpuHousekeeperUrl({
    managerUrl: configValue("gpu housekeeper url"),
    cwd
  });
}

function isLocalModelBackend(backend) {
  return ["ollama", "strata"].includes(normalizeSaddleBackend(backend));
}

async function withLocalModelsManaged(backend, housekeeperUrl, action) {
  if (!isLocalModelBackend(backend)) return action();
  const managerUrl = resolveGpuHousekeeperUrl({ managerUrl: housekeeperUrl });
  if (!managerUrl) throw new Error("local saddle models require a configured GPU Housekeeper URL");

  const keys = ["PYA_GPU_HOUSEKEEPER_URL", "PYA_GPU_MANAGER_REQUIRED", "PYA_GPU_MANAGER_ALLOW_DIRECT"];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  process.env.PYA_GPU_HOUSEKEEPER_URL = managerUrl;
  process.env.PYA_GPU_MANAGER_REQUIRED = "true";
  process.env.PYA_GPU_MANAGER_ALLOW_DIRECT = "false";
  try {
    return await action();
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
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
  runtimeRoot = root,
  worldRoot,
  mindName = process.env.PYA_SADDLE_MIND,
  model = process.env.PYA_SADDLE_MODEL,
  host = process.env.PYA_SADDLE_HOST,
  systemPrompt = DEFAULT_CODING_SADDLE_SYSTEM_PROMPT
} = {}) {
  const resolvedCwd = path.resolve(cwd);
  const resolvedRuntimeRoot = path.resolve(runtimeRoot);
  const resolvedWorldRoot = path.resolve(worldRoot || resolveSaddleProjectWorldRoot({
    runtimeRoot: resolvedRuntimeRoot,
    cwd: resolvedCwd
  }));
  const globalWorldRoot = path.join(resolvedRuntimeRoot, "world");
  setEntryModulePath(resolvedCwd);
  forget();
  await loadDefaultConfig({ cwd: resolvedRuntimeRoot, interpretFn: interpret, entryPath: path.join(resolvedRuntimeRoot, "saddle.pya") });
  await importSaddleTools();
  const housekeeperUrl = resolveSaddleHousekeeperUrl(resolvedRuntimeRoot);
  const configuredMindName = String(configValue("coding saddle mind", "mind")).trim();
  const agentHouse = resolveSaddleAgentHouseAtWorldRoot(resolvedWorldRoot);
  const globalAgentHouse = resolveSaddleAgentHouseAtWorldRoot(globalWorldRoot);
  await ensureAgentDirs(agentHouse);
  const useGlobalRecentPreference = worldRoot == null;
  const saddleStatePath = path.join(agentHouse, "conduct", "coding-saddle.pya");
  const saddleState = await readCodingSaddleState(saddleStatePath);
  const sessionDir = path.join(agentHouse, "session");
  const storedSessionFile = saddleState.activeSessionFile ? path.resolve(saddleState.activeSessionFile) : "";
  const sessionFile = storedSessionFile && isPathWithin(sessionDir, storedSessionFile) ? storedSessionFile : "";
  const sessionName = storedSessionFile && !sessionFile
    ? SESSION_NAME
    : saddleState.activeSessionName || SESSION_NAME;
  const sessionProfile = getCodingSaddleProfile(saddleState, { sessionName, sessionFile });
  const recentModelStatePath = path.join(
    useGlobalRecentPreference ? globalAgentHouse : agentHouse,
    "conduct",
    "coding-saddle-recent.pya"
  );
  const recentModelState = await readCodingSaddleState(recentModelStatePath);
  let recentModelProfile = getCodingSaddleProfile(recentModelState, { sessionName: RECENT_MODEL_SESSION });
  if (useGlobalRecentPreference && !Object.keys(recentModelProfile).length) {
    const legacyStatePath = path.join(globalAgentHouse, "conduct", "coding-saddle.pya");
    const legacyState = legacyStatePath === saddleStatePath
      ? saddleState
      : await readCodingSaddleState(legacyStatePath);
    recentModelProfile = getCodingSaddleProfile(legacyState, {
      sessionName: legacyState.activeSessionName || SESSION_NAME,
      sessionFile: legacyState.activeSessionFile || ""
    });
  }
  const savedProfile = Object.keys(sessionProfile).length ? sessionProfile : recentModelProfile;
  const hasExplicitSelection = Boolean(String(mindName || model || host || "").trim());
  const useSavedProfile = !hasExplicitSelection;
  const selectionSource = hasExplicitSelection
    ? "startup override"
    : (useSavedProfile && sessionProfile.backend && sessionProfile.model)
      ? "saved session state"
      : (useSavedProfile && recentModelProfile.backend && recentModelProfile.model)
        ? "recent model preference"
      : "configured mind";
  const selectedMind = String(
    mindName
    || (useSavedProfile && savedProfile.mindName)
    || configuredMindName
  ).trim();
  const profileResolved = resolveConfiguredSaddleMind(selectedMind);
  const resolvedBackend = normalizeSaddleBackend(
    (useSavedProfile && savedProfile.backend)
    || profileResolved.backend
  );
  const resolvedModel = normalizeSaddleModel(
    model
    || (useSavedProfile && savedProfile.model)
    || profileResolved.model
  );
  const resolvedHost = normalizeSaddleHost(
    host
    || (useSavedProfile && savedProfile.host)
    || profileResolved.host
  );
  const thinkSetting = resolveSaddleThinkSetting({
    backend: resolvedBackend,
    savedEffort: useSavedProfile ? savedProfile.reasoningEffort : "",
    configuredEffort: configValue("mind reasoning effort")
  });
  const mindModels = new Map([[selectedMind, resolvedModel]]);
  configureSaddle({
    cwd: resolvedCwd,
    runtimeRoot: resolvedRuntimeRoot,
    worldRoot: resolvedWorldRoot,
    model: resolvedModel,
    backend: resolvedBackend,
    host: resolvedHost,
    thinkSetting,
    systemPrompt
  });
  return {
    cwd: resolvedCwd,
    runtimeRoot: resolvedRuntimeRoot,
    worldRoot: resolvedWorldRoot,
    mindName: selectedMind,
    model: resolvedModel,
    backend: resolvedBackend,
    host: resolvedHost,
    thinkSetting,
    sessionName,
    sessionFile,
    selectionSource,
    defaultMindName: configuredMindName,
    defaultProfile: resolveConfiguredSaddleMind(configuredMindName),
    saddleState,
    saddleStatePath,
    recentModelState,
    recentModelStatePath,
    recentModelProfile,
    housekeeperUrl,
    mindModels,
    agentHouse,
    sessionDir,
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
  housekeeperUrl = "",
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
  return withLocalModelsManaged(backend, housekeeperUrl, () => mindFn(sentence, {
    onToolCall,
    onUsage: emitUsage,
    sessionUserContent: String(input ?? ""),
    sessionUserMetadata
  }));
}

export async function loadSaddleSessionHistory({
  agentHouse,
  sessionName = SESSION_NAME,
  sessionFile = "",
  historyWindow = 50
} = {}) {
  if (sessionFile) return readSessionMessages({ sessionFile, historyWindow });
  return readSessionMessagesWithFallback({
    sessionDir: path.join(agentHouse, "session"),
    baseName: sessionName,
    historyWindow
  });
}

export function renderSaddleSessionHistory(saddleUi, messages = [], session = "", detail = "") {
  const history = Array.isArray(messages) ? messages : [];
  saddleUi.clearHistory();
  saddleUi.writeLine(`session: ${session || SESSION_NAME} | restored ${history.length} saved messages${detail ? ` | ${detail}` : ""}`);
  for (const message of history) {
    if (message?.role === "assistant") {
      saddleUi.writeLine("saddle>");
      saddleUi.writeMarkdown(String(message.content ?? ""));
    } else if (message?.role === "user") {
      saddleUi.writeLine(`you> ${String(message.content ?? "")}`);
    } else if (message?.role === "tool") {
      saddleUi.writeLine(`[tool] ${String(message.content ?? "")}`);
    }
  }
  if (history.length) saddleUi.writeLine("--- end of saved history ---");
}

export async function dischargeSaddleModel(model, backend, {
  housekeeperUrl = "",
  cwd = process.cwd(),
  adapterFactory = createGpuHousekeeperAdapter
} = {}) {
  if (!isLocalModelBackend(backend)) return null;
  const managerUrl = resolveGpuHousekeeperUrl({ managerUrl: housekeeperUrl, cwd });
  if (!managerUrl) throw new Error("local saddle models require a configured GPU Housekeeper URL");
  const result = await adapterFactory({ baseUrl: managerUrl }).discharge({ profileName: model });
  if (result?.success === false) {
    throw new Error(result.reason || `Housekeeper could not discharge ${model}`);
  }
  return result;
}

let activeSaddleUi = null;
let activeSaddleResizeHandler = null;

function writeLine(text = "") {
  if (activeSaddleUi) activeSaddleUi.writeLine(text);
  else process.stdout.write(`${String(text)}\n`);
}

function writeMarkdown(text = "") {
  if (activeSaddleUi) activeSaddleUi.writeMarkdown(text);
  else process.stdout.write(`${String(text)}\n`);
}

function formatSaddleHeaderUsage(rawUsage) {
  const usage = normalizeMindUsage(rawUsage);
  if (!usage) return "";
  const count = (value) => new Intl.NumberFormat("en-US").format(value);
  return `turn usage · input ${count(usage.inputTokens)} (cached ${count(usage.cachedInputTokens)}) · output ${count(usage.outputTokens)} (reasoning ${count(usage.reasoningOutputTokens)}) · total ${count(usage.totalTokens)}`;
}

function restoreActiveSaddleUi() {
  if (process.stdin.isTTY && process.stdin.isRaw) process.stdin.setRawMode(false);
  if (process.stdin.isTTY) process.stdin.pause();
  if (activeSaddleResizeHandler) process.stdout.off("resize", activeSaddleResizeHandler);
  activeSaddleResizeHandler = null;
  activeSaddleUi?.exit();
  activeSaddleUi = null;
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
  let sessionName = config.sessionName || SESSION_NAME;
  let sessionFile = config.sessionFile || "";
  let contextWindow = backend === "zai" ? getZaiCodexContextWindow({ model }) : null;
  let thinkSetting = config.thinkSetting;
  let busy = false;
  let closing = false;
  let backendPicker = null;
  let modelPicker = null;
  let modelPickerTarget = null;
  let modelPickerAllowCustom = false;
  let modelPickerLoading = false;
  let contextPicker = null;
  let thinkPicker = null;
  let sessionPicker = null;
  let promptLabel = "pyash> ";
  let inputDecoder = null;
  const queuedInputs = [];
  const saddleUi = createSaddleTerminalUi();
  activeSaddleUi = saddleUi;
  saddleUi.enter();
  process.once("exit", restoreActiveSaddleUi);

  const saddleHousekeeper = () => createGpuHousekeeperAdapter({ baseUrl: config.housekeeperUrl });
  let queueSnapshot = null;
  const sessionLabel = () => sessionFile
    ? path.basename(sessionFile, path.extname(sessionFile))
    : sessionName;
  const restoreSessionHistory = async ({ detail = "" } = {}) => {
    try {
      const replay = await loadSaddleSessionHistory({
        agentHouse: config.agentHouse,
        sessionName,
        sessionFile,
        historyWindow: 50
      });
      renderSaddleSessionHistory(saddleUi, replay.messages, sessionLabel(), detail);
    } catch (error) {
      saddleUi.clearHistory();
      writeLine(`session history unavailable for ${sessionLabel()}: ${error.message}`);
    }
  };
  const renderStatus = ({ report = false } = {}) => {
    const status = formatSaddleStatus({
      mindName,
      model,
      backend,
      housekeeperUrl: config.housekeeperUrl,
      contextWindow,
      thinkMode: thinkSetting?.value,
      host,
      cwd: config.cwd,
      queue: queueSnapshot,
      busy,
      session: sessionLabel()
    });
    saddleUi.setStatus(status);
    if (report) writeLine(status);
  };
  const persistSelection = async ({ includeProfile = true } = {}) => {
    let nextState = {
      ...config.saddleState,
      activeSessionName: sessionName,
      activeSessionFile: sessionFile
    };
    if (includeProfile) {
      nextState = setCodingSaddleProfile(nextState, { sessionName, sessionFile }, {
        mindName,
        backend,
        model,
        host,
        reasoningEffort: thinkSetting?.reasoningEffort
      });
    }
    config.saddleState = nextState;
    await writeCodingSaddleState(config.saddleStatePath, nextState);
    if (includeProfile) {
      const recentState = setCodingSaddleProfile(
        config.recentModelState,
        { sessionName: RECENT_MODEL_SESSION },
        {
          mindName,
          backend,
          model,
          host,
          reasoningEffort: thinkSetting?.reasoningEffort
        }
      );
      config.recentModelState = recentState;
      config.recentModelProfile = getCodingSaddleProfile(recentState, { sessionName: RECENT_MODEL_SESSION });
      await writeCodingSaddleState(config.recentModelStatePath, recentState);
    }
  };
  const reportSelectionSaved = async () => {
    try {
      await persistSelection();
      writeLine(`saved model selection for session: ${sessionLabel()}`);
    } catch (error) {
      writeLine(`model selection is active but could not be saved: ${error.message}`);
    }
  };
  const showStatus = async ({ report = false } = {}) => {
    queueSnapshot = isLocalModelBackend(backend)
      ? await saddleHousekeeper().getQueue().catch(() => ({ available: false }))
      : await queueDepth(path.join(config.cwd, "world")).catch(() => ({ total: 0 }));
    renderStatus({ report });
  };
  const currentInputLabel = () => busy
    ? (queuedInputs.length ? `queue ${queuedInputs.length + 1}> ` : "next> ")
    : promptLabel;
  const prompt = ({ label = promptLabel } = {}) => {
    if (!busy) promptLabel = label;
    saddleUi.setInput(inputDecoder?.getState() ?? { value: "", cursor: 0 }, currentInputLabel());
  };
  const dispatchQueuedInput = () => {
    if (busy || closing) return;
    const nextInput = queuedInputs.shift();
    if (nextInput !== undefined) {
      void submit(nextInput, { alreadyDisplayed: true });
      return;
    }
    prompt();
  };
  const applyStrataContext = async (tokens) => {
    busy = true;
    saddleUi.setBusy(true);
    writeLine(`Housekeeper is reconfiguring Strata to ${formatZaiContextWindow(tokens)} and restarting its lazy server...`);
    prompt({ clear: false, label: "restarting Strata> " });
    try {
      const result = await saddleHousekeeper().setStrataContext({ contextLength: tokens });
      contextWindow = Number(result.contextLength || tokens);
      renderStatus();
      writeLine(`Strata context: ${formatZaiContextWindow(contextWindow)}; Housekeeper verified the restart; model remains unloaded until its next request`);
    } catch (error) {
      writeLine(`Strata context change failed: ${error.message}`);
    } finally {
      busy = false;
      saddleUi.setBusy(false);
      promptLabel = "pyash> ";
      dispatchQueuedInput();
    }
  };
  const getBackendOptions = () => listSaddleBackendOptions({
    minds: allRemember(),
    defaultBackend: normalizeSaddleBackend(configValue("mind backend", "ollama")),
    defaultModel: configValue("mind model", "qwen3.5:9b"),
    hostForBackend: resolveSaddleHost,
    currentBackend: backend,
    currentMindName: mindName,
    currentModel: model,
    currentHost: host
  });
  const showBackendPicker = () => {
    backendPicker = getBackendOptions();
    modelPicker = null;
    modelPickerTarget = null;
    writeLine(formatSaddleBackendPicker({ backends: backendPicker }));
    prompt({ clear: false, label: "select backend> " });
  };
  const showSessionPicker = async () => {
    const files = await listSessionFiles(path.join(config.agentHouse, "session"));
    const recentFiles = files.slice(-30).reverse();
    sessionPicker = [
      { model: "__daily_coding__", value: "__daily_coding__", label: "Daily coding session" },
      ...recentFiles.map((filename) => ({
        model: filename,
        value: filename,
        label: filename
      }))
    ];
    writeLine("available conversation sessions:");
    for (const [index, option] of sessionPicker.entries()) {
      const selected = option.value === "__daily_coding__"
        ? !sessionFile && sessionName === SESSION_NAME
        : sessionFile && path.basename(sessionFile) === option.value;
      writeLine(`${index + 1}. ${option.label}${selected ? " (current)" : ""}`);
    }
    writeLine("Choose a session file; the current backend and model are saved separately for each session.");
    prompt({ clear: false, label: "select session> " });
  };
  const activateSession = async (selection) => {
    await dischargeSaddleModel(model, backend, { housekeeperUrl: config.housekeeperUrl, cwd: config.runtimeRoot })
      .catch((error) => writeLine(`discharge: ${error.message}`));
    if (selection.value === "__daily_coding__") {
      sessionName = SESSION_NAME;
      sessionFile = "";
    } else {
      sessionName = path.basename(selection.value, path.extname(selection.value));
      sessionFile = path.resolve(config.agentHouse, "session", selection.value);
    }
    const saved = getCodingSaddleProfile(config.saddleState, { sessionName, sessionFile });
    if (Object.keys(saved).length) {
      mindName = saved.mindName || config.defaultMindName;
      const configured = resolveConfiguredSaddleMind(mindName);
      backend = normalizeSaddleBackend(saved.backend || configured.backend);
      model = normalizeSaddleModel(saved.model || configured.model);
      host = normalizeSaddleHost(saved.host || configured.host);
    } else {
      const recent = config.recentModelProfile;
      mindName = recent.mindName || config.defaultMindName;
      const configured = resolveConfiguredSaddleMind(mindName);
      backend = normalizeSaddleBackend(recent.backend || configured.backend);
      model = normalizeSaddleModel(recent.model || configured.model);
      host = normalizeSaddleHost(recent.host || configured.host);
    }
    mindModels.set(mindName, model);
    contextWindow = backend === "zai" ? getZaiCodexContextWindow({ model }) : null;
    thinkSetting = resolveSaddleThinkSetting({
      backend,
      savedEffort: saved.reasoningEffort || config.recentModelProfile.reasoningEffort,
      configuredEffort: configValue("mind reasoning effort")
    });
    await restoreSessionHistory();
    configureSaddle({ cwd: config.cwd, model, backend, host, systemPrompt: config.systemPrompt });
    renderStatus();
    try {
      await persistSelection({ includeProfile: false });
    } catch (error) {
      writeLine(`session is active but could not be saved: ${error.message}`);
    }
    promptLabel = "pyash> ";
    writeLine(`session: ${sessionLabel()} | mind: ${mindName} | backend: ${backend} | model: ${model}`);
    prompt({ clear: false });
  };
  const showModelPicker = async (target = null) => {
    const selection = target || { backend, host, model, mindName };
    const targetBackend = normalizeSaddleBackend(selection.backend || backend);
    const targetHost = normalizeSaddleHost(selection.host || host);
    const targetModel = normalizeSaddleModel(selection.model || model);
    modelPickerLoading = true;
    backendPicker = null;
    modelPickerTarget = { ...selection, backend: targetBackend, host: targetHost, model: targetModel };
    writeLine("discovering models...");
    prompt({ clear: false, label: "model loading> " });
    const fallbackModels = String(process.env.PYA_SADDLE_MODELS || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    const discovered = await discoverSaddleModels({
      backend: targetBackend,
      host: targetHost,
      housekeeperUrl: isLocalModelBackend(targetBackend) ? config.housekeeperUrl : "",
      currentModel: targetModel,
      fallbackModels
    });
    if (targetBackend === "zai" && discovered.available && discovered.catalogModels?.length) {
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
      backend: targetBackend,
      host: targetHost,
      mindName: selection.mindName || mindName,
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
      modelPicker = [{ model: targetModel, value: targetModel, backend: targetBackend, host: targetHost, mindName: selection.mindName || mindName, label: targetModel }];
    }
    modelPickerAllowCustom = ["openai", "litellm", "openrouter", "vllm"].includes(targetBackend);
    modelPickerLoading = false;
    writeLine(formatSaddleModelPicker({
      models: modelPicker,
      currentModel: targetModel,
      currentBackend: targetBackend,
      error: discovered.available ? "" : discovered.error
    }));
    if (modelPickerAllowCustom) writeLine("For this backend, you can also enter a model ID directly.");
    prompt({ clear: false, label: "select model> " });
  };
  const showContextPicker = async () => {
    if (backend === "strata") {
      try {
        const status = await saddleHousekeeper().getStrataContext();
        contextWindow = Number(status.contextLength || 0) || null;
        contextPicker = buildSaddleStrataContextOptions({
          options: status.options,
          currentContextLength: status.contextLength,
          defaultContextLength: status.defaultContextLength
        });
        if (!contextPicker.length) throw new Error("Housekeeper returned no supported context sizes");
        writeLine(`Strata context for ${model}: current ${formatZaiContextWindow(contextWindow)}; default ${formatZaiContextWindow(status.defaultContextLength)}`);
        writeLine("Choose a size. Housekeeper updates Strata's launch profile and restarts it while holding the GPU gate.");
        for (const [index, option] of contextPicker.entries()) {
          writeLine(`${index + 1}. ${option.label}${option.current ? " (current)" : ""}`);
        }
        prompt({ clear: false, label: "select context> " });
        return;
      } catch (error) {
        writeLine(`Strata context selection unavailable: ${error.message}`);
      }
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
    if (!["ollama", "strata", "minimax", "zai"].includes(backend)) {
      writeLine("/think controls are available for Ollama, Strata, Z.AI, and MiniMax minds");
      prompt({ clear: false });
      return;
    }
    const options = backend === "ollama"
      ? ["off", "on"]
      : backend === "minimax"
        ? ["low", "medium", "high", "xhigh", "max"]
        : backend === "zai"
          ? ["low", "high", "max"]
          : ["none", "low", "medium", "high"];
    thinkPicker = options.map((value) => ({ model: value, value, label: value }));
    const defaultEffortLabel = backend === "minimax"
      ? "provider default"
      : backend === "zai"
        ? "low (Pyash default)"
        : "Strata default";
    writeLine(backend === "ollama"
      ? `thinking for ${model}: current ${thinkSetting?.value ?? "model default"}`
      : `reasoning effort for ${model}: current ${thinkSetting?.value ?? defaultEffortLabel}`);
    for (const [index, option] of thinkPicker.entries()) {
      writeLine(`${index + 1}. ${option.label}${option.value === thinkSetting?.value ? " (current)" : ""}`);
    }
    writeLine(backend === "ollama"
      ? "Choose whether to request thinking; model support varies."
      : backend === "minimax"
        ? "Choose MiniMax reasoning effort. MiniMax M3.1 Flash does not support disabling thinking."
          : backend === "zai"
            ? "Choose Z.AI Coding Plan reasoning effort for subsequent saddle requests."
            : "Choose the Strata reasoning effort for subsequent requests.");
    promptLabel = "select thinking> ";
    prompt({ clear: false });
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
    restoreActiveSaddleUi();
    writeLine("saddle closed");
  };
  const submit = async (value, { alreadyDisplayed = false } = {}) => {
    const input = String(value ?? "");
    if (!input.trim() || closing) {
      prompt({ clear: false });
      return;
    }
    if (input.trim() === "/exit" || input.trim() === "/quit") {
      await shutdown();
      return;
    }
    if (busy) {
      if (input.trim().startsWith("/")) {
        writeLine("commands wait until the current response finishes; ordinary messages are queued");
        prompt({ clear: false });
        return;
      }
      queuedInputs.push(input);
      writeLine(`[queued ${queuedInputs.length}] you> ${input}`);
      prompt({ clear: false });
      return;
    }
    if (modelPickerLoading) {
      writeLine("model discovery is still running; please choose after the list appears");
      prompt({ clear: false, label: "model loading> " });
      return;
    }
    if (sessionPicker) {
      const selected = resolveSaddleModelOption(input, sessionPicker);
      if (!selected) {
        writeLine("invalid session selection");
        prompt({ clear: false, label: "select session> " });
        return;
      }
      sessionPicker = null;
      await activateSession(selected);
      return;
    }
    if (backendPicker) {
      const selected = resolveSaddleModelOption(input, backendPicker);
      if (!selected) {
        writeLine("invalid backend selection");
        prompt({ clear: false, label: "select backend> " });
        return;
      }
      await showModelPicker(selected);
      return;
    }
    if (contextPicker) {
      const selected = resolveSaddleModelOption(input, contextPicker);
      if (!selected) {
        writeLine("invalid context window selection");
        prompt({ clear: false, label: "select context> " });
        return;
      }
      if (backend === "strata") {
        contextPicker = null;
        await applyStrataContext(selected.tokens);
        return;
      }
      if (backend === "zai") {
        const saved = setZaiCodexContextWindow({ model, contextWindow: selected.tokens });
        if (!saved.updated) {
          contextPicker = null;
          promptLabel = "pyash> ";
          writeLine(`could not save context window: ${saved.reason}`);
          prompt({ clear: false });
          return;
        }
      }
      contextWindow = selected.tokens == null ? null : Number(selected.tokens);
      contextPicker = null;
      promptLabel = "pyash> ";
      renderStatus();
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
      promptLabel = "pyash> ";
      renderStatus();
      writeLine(backend === "ollama"
        ? `thinking: ${thinkSetting.value} for ${model}`
        : `reasoning effort: ${thinkSetting.value} for ${model}`);
      await reportSelectionSaved();
      prompt({ clear: false });
      return;
    }
    if (modelPicker) {
      const selected = resolveSaddleModelOption(input, modelPicker)
        || (modelPickerAllowCustom && input.trim()
          ? {
            model: input.trim(),
            backend: modelPickerTarget?.backend,
            host: modelPickerTarget?.host,
            mindName: modelPickerTarget?.mindName
          }
          : null);
      if (!selected) {
        writeLine("invalid model selection");
        prompt({ clear: false, label: "select model> " });
        return;
      }
      modelPicker = null;
      modelPickerAllowCustom = false;
      const previousBackend = backend;
      const previousEffort = thinkSetting?.value ?? "";
      const nextBackend = normalizeSaddleBackend(selected.backend || modelPickerTarget?.backend || backend);
      const nextMindName = String(selected.mindName || modelPickerTarget?.mindName || mindName).trim();
      backend = nextBackend;
      mindName = nextMindName;
      host = normalizeSaddleHost(selected.host || modelPickerTarget?.host || host);
      modelPickerTarget = null;
      model = normalizeSaddleModel(selected.model, model);
      mindModels.set(mindName, model);
      if (backend === "zai") {
        contextWindow = Math.min(contextWindow || getZaiCodexContextWindow({ model }), getZaiModelContextLimit({ model }));
      } else {
        contextWindow = null;
      }
      thinkSetting = resolveSaddleThinkSetting({
        backend,
        savedEffort: backend === previousBackend ? previousEffort : "",
        configuredEffort: configValue("mind reasoning effort")
      });
      promptLabel = "pyash> ";
      configureSaddle({ cwd: config.cwd, model, backend, host, systemPrompt: config.systemPrompt });
      renderStatus();
      writeLine(`mind: ${mindName} | backend: ${backend} | model: ${model}`);
      await reportSelectionSaved();
      prompt({ clear: false });
      return;
    }
    if (input.trim() === "/help") {
      writeLine("/status  /session  /mind [name]  /model [backend|model-id]  /context [size]  /think [mode]  /host <url>  /usage  /discharge  /exit");
      writeLine("Tab completes slash-command names; repeated Tab cycles matching commands.");
      prompt({ clear: false });
      return;
    }
    const sessionMatch = input.trim().match(/^\/session(?:\s+(.+))?$/i);
    if (sessionMatch) {
      const requested = String(sessionMatch[1] || "").trim();
      if (!requested || requested.toLowerCase() === "list") {
        await showSessionPicker();
        return;
      }
      const files = await listSessionFiles(path.join(config.agentHouse, "session"));
      const match = files.find((filename) => filename.toLowerCase() === requested.toLowerCase());
      if (!match) {
        writeLine(`unknown session file: ${requested}; use /session to list available sessions`);
        prompt({ clear: false });
        return;
      }
      await activateSession({ value: match });
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
      await dischargeSaddleModel(model, backend, { housekeeperUrl: config.housekeeperUrl, cwd: config.runtimeRoot })
        .catch((error) => writeLine(`discharge: ${error.message}`));
      const nextProfile = resolveConfiguredSaddleMind(canonicalName);
      const previousBackend = backend;
      const previousEffort = thinkSetting?.value ?? "";
      mindName = canonicalName;
      backend = nextProfile.backend;
      host = nextProfile.host;
      model = normalizeSaddleModel(mindModels.get(mindName) || nextProfile.model);
      contextWindow = backend === "zai" ? getZaiCodexContextWindow({ model }) : null;
      thinkSetting = resolveSaddleThinkSetting({
        backend,
        savedEffort: backend === previousBackend ? previousEffort : "",
        configuredEffort: configValue("mind reasoning effort")
      });
      mindModels.set(mindName, model);
      configureSaddle({ cwd: config.cwd, model, backend, host, systemPrompt: config.systemPrompt });
      renderStatus();
      writeLine(`mind: ${mindName} | model: ${model}`);
      await reportSelectionSaved();
      prompt({ clear: false });
      return;
    }
    if (input.trim() === "/model") {
      showBackendPicker();
      return;
    }
    const contextMatch = input.trim().match(/^\/context(?:\s+(.+))?$/i);
    if (contextMatch) {
      if (!contextMatch[1]) {
        await showContextPicker();
        return;
      }
      if (backend === "strata") {
        try {
          const status = await saddleHousekeeper().getStrataContext();
          const choices = buildSaddleStrataContextOptions({
            options: status.options,
            currentContextLength: status.contextLength,
            defaultContextLength: status.defaultContextLength
          });
          const selected = resolveSaddleModelOption(contextMatch[1], choices);
          if (!selected) {
            writeLine(`unknown Strata context size; available: ${choices.map((choice) => choice.label).join(", ")}`);
            prompt({ clear: false });
            return;
          }
          await applyStrataContext(selected.tokens);
        } catch (error) {
          writeLine(`Strata context selection unavailable: ${error.message}`);
          prompt({ clear: false });
        }
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
      renderStatus();
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
            : backend === "minimax"
              ? "MiniMax accepts /think low, medium, high, xhigh, or max; thinking cannot be disabled for M3.1 Flash"
              : backend === "zai"
                ? "Z.AI accepts /think low, high, or max"
                : "/think is available for Ollama, Strata, Z.AI, and MiniMax minds");
        prompt({ clear: false });
        return;
      }
      thinkSetting = selected;
      promptLabel = "pyash> ";
      renderStatus();
      writeLine(backend === "ollama"
        ? `thinking: ${selected.value} for ${model}`
        : `reasoning effort: ${selected.value} for ${model}`);
      prompt({ clear: false });
      return;
    }
    if (input.trim() === "/status") {
      await showStatus({ report: true });
      prompt({ clear: false });
      return;
    }
    if (input.trim() === "/discharge") {
      await dischargeSaddleModel(model, backend, { housekeeperUrl: config.housekeeperUrl, cwd: config.runtimeRoot })
        .then(() => writeLine(`discharged through Housekeeper: ${model}`))
        .catch((error) => writeLine(`discharge failed: ${error.message}`));
      prompt({ clear: false });
      return;
    }
    const modelMatch = input.trim().match(/^\/model\s+(.+)$/i);
    if (modelMatch) {
      const requested = modelMatch[1].trim();
      const targetBackend = getBackendOptions().find((entry) => [entry.backend, entry.label]
        .some((value) => value.toLowerCase() === requested.toLowerCase()));
      if (targetBackend) {
        await showModelPicker(targetBackend);
        return;
      }
      model = normalizeSaddleModel(requested, model);
      mindModels.set(mindName, model);
      contextWindow = backend === "zai" ? getZaiCodexContextWindow({ model }) : null;
      thinkSetting = resolveSaddleThinkSetting({
        backend,
        savedEffort: thinkSetting?.value,
        configuredEffort: configValue("mind reasoning effort")
      });
      configureSaddle({ cwd: config.cwd, model, backend, host, systemPrompt: config.systemPrompt });
      renderStatus();
      writeLine(`model: ${model}`);
      await reportSelectionSaved();
      prompt({ clear: false });
      return;
    }
    const hostMatch = input.trim().match(/^\/host\s+(.+)$/i);
    if (hostMatch) {
      host = normalizeSaddleHost(hostMatch[1], host);
      configureSaddle({ cwd: config.cwd, model, backend, host, systemPrompt: config.systemPrompt });
      renderStatus();
      writeLine(`host: ${host}`);
      await reportSelectionSaved();
      prompt({ clear: false });
      return;
    }

    busy = true;
    saddleUi.setBusy(true);
    saddleUi.setUsage("");
    if (!alreadyDisplayed) writeLine(`you> ${input}`);
    saddleUi.setActivity(`working: ${model} via ${backend}${isLocalModelBackend(backend) ? " through GPU Housekeeper" : ""}`);
    prompt({ clear: false });
    const stopProgress = startSaddleProgress({
      backend,
      model,
      onProgress: (line) => saddleUi.setActivity(line)
    });
    const turnUsages = [];
    try {
      const turn = await runSaddleTurnWithEvidence({
        input,
        runTurn: ({ input: turnInput, onToolCall }) => runSaddleTurn({
          input: turnInput,
          model,
          backend,
          host,
          housekeeperUrl: config.housekeeperUrl,
          contextWindow,
          think: thinkSetting?.think,
          reasoningEffort: thinkSetting?.reasoningEffort,
          sessionName,
          sessionFile,
          onUsage: (usage) => {
            turnUsages.push(usage);
            return usage;
          },
          onToolCall
        }),
        onToolCall: async (event) => {
          if (event?.stage === "call" || event?.stage === "result" || event?.stage === "ratify") {
            writeLine(`${saddleToolEventLabel(event)}${event.toolText ? `: ${String(event.toolText).slice(0, 400)}` : ""}`);
          }
        },
        onFollowup: (assessment) => {
          writeLine(`[saddle] completion check missing ${assessment.missing.join("; ")}; making one completion pass`);
        }
      });
      const result = turn.result;
      const text = result?.ob?.text ?? result?.fromstate?.text ?? result?.value?.text ?? "";
      writeLine("saddle>");
      writeMarkdown(String(text).trim() || "(no response text)");
      const evidence = formatSaddleCompletionEvidence(turn.assessment);
      if (evidence) writeLine(`${evidence}${turn.retryError ? ` retry failed: ${turn.retryError}` : ""}`);
      const usage = sumMindUsages(turnUsages);
      if (usage) {
        saddleUi.setUsage(formatSaddleHeaderUsage(usage));
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
      stopProgress();
      busy = false;
      saddleUi.setBusy(false);
      saddleUi.setActivity("ready");
      dispatchQueuedInput();
    }
  };

  process.stdin.setEncoding("utf8");
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.on("SIGINT", () => { shutdown().catch(() => {}); });
  process.on("SIGTERM", () => { shutdown().catch(() => {}); });
  activeSaddleResizeHandler = () => saddleUi.draw();
  process.stdout.on("resize", activeSaddleResizeHandler);

  await showStatus();
  await restoreSessionHistory({ detail: `model selection source: ${config.selectionSource}` });
  inputDecoder = createSaddleInputDecoder({
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
    onScroll: (direction) => saddleUi.scrollBy(-direction),
    onAutocomplete: saddleSlashCommandCompletions,
    onChange: (state) => {
      if (!closing) {
        saddleUi.setInput(state, currentInputLabel());
      }
    }
  });
  process.stdin.on("data", (chunk) => inputDecoder.feed(chunk));
  prompt();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    restoreActiveSaddleUi();
    process.stderr.write(`${String(error?.stack ?? error)}\n`);
    process.exitCode = 1;
  });
}

export { main, resumeDuty };
