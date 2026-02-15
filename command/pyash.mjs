#!/usr/bin/env node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline/promises";
import { Writable } from "node:stream";
import { parseArgValue, parseArgValues, hasFlag, parseTruthy } from "./pyash/cli_args.mjs";
import {
  blockMarkers,
  escapeRegex,
  renderManagedBlock,
  planManagedUpsert,
  extractManagedBlock
} from "./pyash/managed_blocks.mjs";
import {
  buildChannelPollCalendarBlock,
  buildChannelInputCalendarBlock,
  buildChannelProduceCalendarBlock,
  stripAgentChannelScheduleText,
  stripLegacySingleChannelScheduleText,
  scrubLegacyMatrixChannelSeed,
  extractChannelPollVectorForAgent,
  upsertChannelPollCalendarText
} from "./pyash/matrix_schedule.mjs";
import {
  readText,
  pathExists,
  detectProjectRoot,
  resolveRootDirFromArgs,
  ensureDirForFile
} from "./pyash/fs_paths.mjs";
import {
  normalizeHomeserver,
  isAppserviceMode,
  sanitizeMatrixLocalpart,
  matrixUserIdFromLocalpart,
  matrixLocalpartFromUserId,
  normalizeMatrixUserIdentity,
  matrixUsersMatch,
  resolveAgentMatrixUserId,
  homeserverHost,
  matrixSupportsSharedSecret,
  matrixServerFromId,
  ensureMatrixIdServer,
  rewriteMatrixIdServer,
  ensureMatrixUserServer,
  redactText,
  redactMatrixConfig,
  normalizeMatrixMode,
  stripYamlScalarQuotes,
  parseTopLevelYamlScalars,
  resolveConfigPath,
  readMatrixAppserviceRegistration
} from "./pyash/matrix_helpers.mjs";
import {
  loginMatrixWithPassword,
  matrixWhoAmI,
  matrixVersions,
  matrixJoinRoom,
  matrixSendRoomMessage,
  matrixInviteRoomMember,
  matrixCreateDirectRoom
} from "./pyash/matrix_api.mjs";
import { runNodeScript, runCodexAccountCommand } from "./pyash/process_exec.mjs";
import {
  ensureMatrixCredentials,
  ensureMatrixExecutiveDmRoom,
  readMatrixAuthCache,
  writeMatrixAuthCache
} from "../program/agent/channels/bootstrap.mjs";
import { establishAgent, beginAgent, stopAgent, listAgents } from "../program/agent/admin.mjs";
import { schedulerBegin, schedulerStop, schedulerRestart, schedulerHealth, schedulerList } from "../program/agent/scheduler_control.mjs";
import { discoverScheduledJobs } from "../program/agent/scheduler.mjs";
import { isServiceEnabled } from "../program/agent/scheduler_service_control.mjs";
import { splitSentences } from "../program/library/sentenceSplitter.mjs";
import {
  listWorldDeclaredAgentHouses,
  resolveWorldAgentHouseDirectory
} from "../program/library/agent_command_policy.mjs";
import { loadChannelPolicyWithGlobal } from "../program/agent/channels/policy.mjs";
import { parse } from "../program/understand/index.mjs";
import { sentenceToPyash } from "../program/beautiful.mjs";
import { enqueueCliInbound } from "../program/agent/channels/cli.mjs";
import {
  claimOldestProduceEnvelope,
  ackRuntimeEnvelopeSuccess,
  ackRuntimeEnvelopeFail
} from "../program/agent/channel_core/queue.mjs";

const __filename = fileURLToPath(import.meta.url);
const installRoot = path.resolve(path.dirname(__filename), "..");
const runProgramPath = path.join(installRoot, "command", "run_pya_program.mjs");
const replPath = path.join(installRoot, "program", "main.mjs");
const codexAccountPath = path.join(installRoot, "command", "codex_account.mjs");

const MATRIX_CATERER_NAME = "matrix";
const MATRIX_BLOCK_NAME = "matrix channel";
const CHANNEL_CONFIG_BLOCK_NAME = "channel configure";
const MATRIX_POLICY_BLOCK_NAME = "matrix channel conduct";
const MATRIX_WORLD_POLICY_BLOCK_NAME = "matrix channel world conduct";
const ORCHESTRATOR_CONFIG_BLOCK_NAME = "orchestrator configure";
const MIND_CONFIG_BLOCK_NAME = "mind configure";
const MIND_RELAYS_BLOCK_NAME = "mind relays";
const MIND_DEFAULTS_BLOCK_NAME = "mind defaults";
const DEFAULT_CHANNEL_AGENT_NAME = "pyash-agent";
const DEFAULT_MIND_RELAY_NAME = "default";
const MATRIX_CHANNEL_MODES = ["poll", "sync", "appservice-push", "appservice"];
const DEFAULT_MATRIX_CHANNEL_MODE = "poll";
const DEFAULT_CHANNEL_POLL_INTERVAL_SECONDS = 10;
const DEFAULT_MATRIX_APPSERVICE_REGISTRATION = "configure/secret/matrix.yaml";
const MIND_BACKEND_CHOICES = [
  { key: "ollama", value: "ollama command mind", label: "Ollama" },
  { key: "litellm", value: "litellm command mind", label: "LiteLLM" },
  { key: "openai-api", value: "openai command mind", label: "OpenAI API key" },
  { key: "openai-codex", value: "openai command mind", label: "OpenAI Codex OAuth" },
  { key: "openrouter", value: "openrouter command mind", label: "OpenRouter" },
  { key: "vllm", value: "vllm command mind", label: "vLLM" }
];

function normalizeChannelAgentName(raw) {
  const text = String(raw ?? "").trim();
  if (!text) return "";
  const localpart = sanitizeMatrixLocalpart(matrixLocalpartFromUserId(text));
  if (localpart) return localpart;
  return text.replace(/^@+/, "").trim();
}

function isEphemeralRootDir(rootDir) {
  const resolved = path.resolve(String(rootDir ?? ""));
  if (!resolved) return false;
  const tmpRoot = path.resolve(os.tmpdir());
  if (!(resolved === tmpRoot || resolved.startsWith(`${tmpRoot}${path.sep}`))) return false;
  const base = path.basename(resolved);
  return /^pyash-(configure|scheduler-control)-/i.test(base);
}

function usage() {
  return [
    "Usage:",
    "  pyash run <file.pya> [run flags...]",
    "  pyash <file.pya> [run flags...]",
    "  pyash repl",
    "  pyash configure",
    "  pyash configure intro [--root <path>] [--json]",
    "  pyash configure orchestrator [--root <path>] [--non-interactive] [--dry-run] [--print] [--json] [--mode <container|local>] [--host <hostname>] [--port <n>] [--autostart <truth|lie>] [--health-rhythm-minute <n>]",
    "  pyash configure channel",
    "  pyash configure channel list [--json]",
    "  pyash configure channel matrix [--root <path>] [--non-interactive] [--dry-run] [--print] [--json] [--quickstart|--advanced] [--test-now <truth|lie>] [--start-now <truth|lie>] [--homeserver <url>] [--room <id-or-alias>] [--mode <poll|sync|appservice-push>] [--appservice-registration <path>] [--executive <@user:server>]... [--agent-user-id <@user:server>] [--auth-mode <password|token|shared-secret>] [--password <password>] [--token <token>] [--registration-shared-secret <secret>] [--admin-token <token>] [--agent <name>] [--write-agent-policy <truth|lie>] [--public-tag-answer <truth|lie>]",
    "  pyash configure channel matrix test [--root <path>] [--json]",
    "  pyash configure channel matrix doctor [--root <path>] [--json]",
    "  pyash configure mind [--root <path>] [--non-interactive] [--dry-run] [--print] [--json] [--relay <name>] [--set-default <truth|lie>] [--backend <name>] [--host <url>] [--model <name>] [--reasoning-effort <name>] [--test-now <truth|lie>] [--codex-login <truth|lie>] [--codex-bin <path>]",
    "  pyash configure agent",
    "  pyash configure agent list [--root <path>] [--json]",
    "  pyash configure agent establish [--root <path>] [--non-interactive] [--dry-run] [--print] [--json] [--agent <name>] [--purpose <text>] [--interval-minutes <n>] [--relay <name|number>] [--backend <name>] [--model <name>] [--tools-map <name>] [--bind-channel <truth|lie>] [--smoke-test <truth|lie>] [--start-now <truth|lie>]",
    "  pyash configure agent improve [--root <path>] [--non-interactive] [--dry-run] [--print] [--json] [--agent <name>] [--purpose <text>] [--interval-minutes <n>] [--relay <name|number>] [--backend <name>] [--model <name>] [--tools-map <name>] [--bind-channel <truth|lie>] [--smoke-test <truth|lie>] [--start-now <truth|lie>]",
    "  pyash configure agent delete [--root <path>] [--non-interactive] [--json] [--agent <name>] [--yes <truth|lie>]",
    "  pyash calendar <health|begin|stop|restart|list> [--root <path>] [--agent <name>] [--json]",
    "  pyash channel poll [--root <path>] [--agent <name>] [--channel <matrix|cli>] [--json]",
    "  pyash channel bootstrap [--root <path>] [--agent <name>] [--channel <matrix>] [--executive <@user:server>] [--json]",
    "  pyash channel log [--root <path>] [--agent <name>] [--channel <matrix|cli>] [--tail <n>] [--json]",
    "  pyash channel cli send [--root <path>] [--agent <name>] [--room <name>] [--sender <name>] --text <text> [--json]",
    "  pyash channel cli read [--root <path>] [--agent <name>] [--tail <n>] [--json]",
    "",
    "Notes:",
    "  - Recommended onboarding route is: pyash configure intro",
    "  - Canonical configure route is: pyash configure channel <caterer>",
    "  - Channel config writes managed blocks to configure/secret.pya",
    `  - Matrix appservice default registration path is ${DEFAULT_MATRIX_APPSERVICE_REGISTRATION}`,
    "  - Optional channel conduct writes to declared agent house conduct/channels.pya"
  ].join("\n");
}

function jsonOut(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function textOut(value = "") {
  process.stdout.write(`${value}\n`);
}

function quoteText(value) {
  const text = String(value ?? "");
  return `\"${text.replace(/\\/g, "\\\\").replace(/\"/g, "\\\"")}"`;
}

function unquotePyashText(value) {
  const text = String(value ?? "").trim();
  if (!(text.startsWith("\"") && text.endsWith("\""))) return text;
  const inner = text.slice(1, -1);
  return inner
    .replace(/\\\\/g, "\\")
    .replace(/\\\"/g, "\"");
}

function defaultAgentHouse(worldRoot, agentName) {
  return path.join(worldRoot, "house", String(agentName ?? "").trim());
}

function resolveConfiguredAgentHouse(worldRoot, agentName) {
  return resolveWorldAgentHouseDirectory({
    worldRoot,
    agentName,
    includeFallback: true
  }) ?? defaultAgentHouse(worldRoot, agentName);
}

function resolveConfiguredAgentHouseFromRoot(rootDir, agentName) {
  const worldRoot = path.join(rootDir, "world");
  return resolveConfiguredAgentHouse(worldRoot, agentName);
}

function canonicalizeMindBackend(raw) {
  const text = String(raw ?? "").trim();
  const key = text.toLowerCase();
  if (!key) return "";
  if (key === "ollama") return "ollama command mind";
  if (key === "litellm") return "litellm command mind";
  if (key === "openai-api") return "openai command mind";
  if (key === "openai-codex") return "openai command mind";
  if (key === "openai") return "openai command mind";
  if (key === "openrouter") return "openrouter command mind";
  if (key === "vllm") return "vllm command mind";
  return text;
}

function looksLikeOllamaBackend(backend) {
  const text = canonicalizeMindBackend(backend).toLowerCase();
  return text.includes("ollama");
}

async function fetchOllamaModels(host, { timeoutMs = 5000 } = {}) {
  const base = normalizeHomeserver(host);
  if (!base || !/^https?:\/\//i.test(base)) {
    return { ok: false, models: [], error: "invalid host" };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${base}/api/tags`, {
      method: "GET",
      signal: controller.signal
    });
    if (!response.ok) {
      return { ok: false, models: [], error: `status=${response.status}` };
    }
    const payload = await response.json().catch(() => ({}));
    const models = Array.from(new Set(
      (Array.isArray(payload?.models) ? payload.models : [])
        .map((entry) => {
          if (typeof entry === "string") return entry.trim();
          const name = entry?.name ?? entry?.model ?? "";
          return String(name ?? "").trim();
        })
        .filter(Boolean)
    ));
    return { ok: true, models: models.sort((a, b) => a.localeCompare(b)) };
  } catch (err) {
    return { ok: false, models: [], error: String(err?.message ?? err) };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchCodexModels({ rootDir, codexBin = "" } = {}) {
  const run = await runCodexAccountCommand({
    action: "models",
    codexBin: String(codexBin || "").trim(),
    cwd: rootDir || process.cwd(),
    json: true,
    codexAccountPath
  });
  if (run.code !== 0) {
    return { ok: false, models: [], error: String(run.stderr || run.stdout || "codex model listing failed").trim() };
  }
  let payload;
  try {
    payload = JSON.parse(run.stdout || "{}");
  } catch {
    return { ok: false, models: [], error: "invalid codex model listing response" };
  }
  if (!payload?.ok) {
    return { ok: false, models: [], error: String(payload?.error || "codex model listing failed") };
  }
  const models = Array.isArray(payload?.models) ? payload.models : [];
  return { ok: true, models };
}

function resolveModelSelection(raw, { fallback = "", models = [] } = {}) {
  const text = String(raw ?? "").trim();
  if (!text) return fallback;
  if (/^\d+$/.test(text) && Array.isArray(models) && models.length > 0) {
    const index = Number(text);
    if (Number.isFinite(index) && index >= 1 && index <= models.length) {
      return models[index - 1];
    }
  }
  return text;
}

function resolveReasoningEffortSelection(raw, { fallback = "", options = [] } = {}) {
  const text = String(raw ?? "").trim();
  if (!text) return fallback;
  if (/^\d+$/.test(text) && Array.isArray(options) && options.length > 0) {
    const index = Number(text);
    if (Number.isFinite(index) && index >= 1 && index <= options.length) {
      return String(options[index - 1] ?? "").trim();
    }
  }
  return text;
}

function findMindBackendChoice(raw) {
  const text = String(raw ?? "").trim();
  if (!text) return null;
  const lowered = text.toLowerCase();
  if (/^\d+$/.test(lowered)) {
    const index = Number(lowered);
    if (Number.isFinite(index) && index >= 1 && index <= MIND_BACKEND_CHOICES.length) {
      return MIND_BACKEND_CHOICES[index - 1];
    }
  }
  for (const item of MIND_BACKEND_CHOICES) {
    if (lowered === item.key) return item;
  }
  const canonical = canonicalizeMindBackend(text);
  for (const item of MIND_BACKEND_CHOICES) {
    if (canonical === item.value) return item;
  }
  return null;
}

function backendChoiceKey(backend) {
  const choice = findMindBackendChoice(backend);
  if (choice) return choice.key;
  if (canonicalizeMindBackend(backend) === "openai command mind") return "openai-api";
  return "ollama";
}

function resolveMindBackendSource(raw, fallbackBackend = "ollama command mind") {
  const selected = findMindBackendChoice(raw);
  if (selected) return selected.key;
  const fallback = findMindBackendChoice(fallbackBackend);
  if (fallback) return fallback.key;
  return backendChoiceKey(fallbackBackend);
}

function resolveMindBackendSelection(raw, fallbackBackend) {
  const fallbackChoice = findMindBackendChoice(fallbackBackend);
  const fallback = fallbackChoice ? fallbackChoice.value : canonicalizeMindBackend(fallbackBackend);
  const selected = findMindBackendChoice(raw);
  if (selected) return selected.value;
  const text = String(raw ?? "").trim();
  if (!text) return fallback;
  return canonicalizeMindBackend(text);
}

function displayMindBackendKey(backend, source = "") {
  const sourceText = String(source || "").trim().toLowerCase();
  if (sourceText) return sourceText;
  const canonical = canonicalizeMindBackend(backend);
  if (canonical === "ollama command mind") return "ollama";
  if (canonical === "litellm command mind") return "litellm";
  if (canonical === "openai command mind") return "openai-api";
  if (canonical === "openrouter command mind") return "openrouter";
  if (canonical === "vllm command mind") return "vllm";
  return canonical || "unknown";
}

function relayMatchesBackendSource(relay, sourceKey, backendValue) {
  const relaySource = String(relay?.source || "").trim().toLowerCase();
  const relayBackend = canonicalizeMindBackend(relay?.backend || "");
  if (relaySource && relaySource === String(sourceKey || "").trim().toLowerCase()) return true;
  return relayBackend === canonicalizeMindBackend(backendValue || "");
}

function formatNumberedRows(items, { columns = 2, gap = 3 } = {}) {
  const values = Array.isArray(items) ? items : [];
  if (values.length === 0) return [];
  const normalizedColumns = Math.max(1, Number(columns) || 1);
  const labels = values.map((item, index) => `${index + 1}. ${item}`);
  const width = labels.reduce((max, item) => Math.max(max, item.length), 0) + gap;
  const lines = [];
  for (let i = 0; i < labels.length; i += normalizedColumns) {
    const row = labels.slice(i, i + normalizedColumns);
    lines.push(row.map((entry, offset) => (
      offset === row.length - 1 ? entry : entry.padEnd(width, " ")
    )).join(""));
  }
  return lines;
}

function suggestMindRelayName({ source = "", model = "", fallback = DEFAULT_MIND_RELAY_NAME } = {}) {
  const baseBySource = {
    "openai-codex": "codex",
    "openai-api": "openai",
    "openrouter": "openrouter",
    "litellm": "litellm",
    "vllm": "vllm",
    "ollama": "ollama"
  };
  const sourceKey = String(source || "").trim().toLowerCase();
  const base = baseBySource[sourceKey] || sourceKey || String(fallback || DEFAULT_MIND_RELAY_NAME);
  const modelText = String(model || "").trim().toLowerCase();
  const modelStemRaw = modelText.split(":")[0] || "";
  const modelStem = modelStemRaw.replace(/[^a-z0-9]+/g, " ").trim();
  if (!modelStem) return base;
  if (modelStem === base) return base;
  if (modelStem.startsWith(`${base} `)) return modelStem;
  return `${base} ${modelStem}`.trim();
}

function defaultMindHostForSource(source = "") {
  const key = String(source || "").trim().toLowerCase();
  if (key === "openai-api" || key === "openai-codex") return "https://api.openai.com";
  if (key === "openrouter") return "https://openrouter.ai/api/v1";
  if (key === "litellm") return "http://localhost:4000";
  if (key === "vllm") return "http://localhost:8000";
  return "http://localhost:11434";
}

function defaultMindModelForSource(source = "") {
  const key = String(source || "").trim().toLowerCase();
  if (key === "openai-codex") return "gpt-5-codex";
  return "gpt-oss:latest";
}

function sectionPrinter() {
  return {
    header(title) {
      textOut("");
      textOut(`[${title}]`);
    },
    why(text) {
      textOut(`Why this matters: ${text}`);
    },
    how(text) {
      textOut(`How to get it: ${text}`);
    },
    examples(text) {
      textOut(`Examples: ${text}`);
    },
    gap() {
      textOut("");
    }
  };
}

class MuteWritable extends Writable {
  constructor(target) {
    super();
    this.target = target;
    this.muted = false;
  }

  _write(chunk, encoding, callback) {
    if (!this.muted) this.target.write(chunk, encoding);
    callback();
  }
}

function parseMapBlock(blockText) {
  const out = {};
  const linePattern = /su name (.+?)\s+ob text\s+("[^"\\]*(?:\\.[^"\\]*)*")\s+ya/g;
  for (const match of blockText.matchAll(linePattern)) {
    out[match[1]] = unquotePyashText(match[2]);
  }
  return out;
}

async function loadMatrixConfigFromSecret(rootDir) {
  const secretPath = path.join(rootDir, "configure", "secret.pya");
  const text = await readText(secretPath);
  if (!text) return {};

  const matrixBlock = extractManagedBlock(text, MATRIX_BLOCK_NAME);
  const channelCfgBlock = extractManagedBlock(text, CHANNEL_CONFIG_BLOCK_NAME);

  const matrixValues = parseMapBlock(matrixBlock);
  const channelValues = parseMapBlock(channelCfgBlock);

  const defaultCaterer = channelValues["default caterer"] || "";

  return {
    defaultCaterer,
    homeserver: matrixValues.homeserver || "",
    appserviceRegistration: matrixValues["bridge service file"] || matrixValues["appservice registration"] || "",
    userId: "",
    authMode: "",
    token: "",
    password: "",
    registrationSharedSecret: matrixValues["registration shared secret"] || "",
    adminToken: "",
    legacyRoom: matrixValues.room || "",
    legacyMode: matrixValues.mode || ""
  };
}

async function loadMatrixPolicyConfig({ rootDir, agentName = DEFAULT_CHANNEL_AGENT_NAME } = {}) {
  const worldRoot = path.join(rootDir, "world");
  const agentHouse = resolveConfiguredAgentHouse(worldRoot, agentName);
  const allChannels = await loadChannelPolicyWithGlobal({ worldRoot, agentHouse });
  const matrix = allChannels?.matrix ?? {};
  const roomEntries = Array.isArray(matrix.rooms) ? matrix.rooms : [];
  const dmRooms = new Set(Array.isArray(matrix.dmRooms) ? matrix.dmRooms.map((roomId) => String(roomId ?? "").trim()) : []);
  const primaryRoom = roomEntries.find((entry) => {
    const id = String(entry?.id ?? "").trim();
    return id && !dmRooms.has(id);
  })?.id ?? roomEntries[0]?.id ?? "";
  const executives = Array.isArray(matrix.executiveUsernames)
    ? matrix.executiveUsernames.map((value) => String(value ?? "").trim()).filter(Boolean)
    : [];
  return {
    room: String(primaryRoom ?? "").trim(),
    mode: normalizeMatrixMode(matrix.mode || "", DEFAULT_MATRIX_CHANNEL_MODE),
    authMode: String(matrix.authMode || "").trim().toLowerCase(),
    publicTagAnswer: matrix.publicTagAnswer === true,
    executiveUsername: executives[0] || "",
    executiveUsernames: executives,
    userId: String(matrix.user || "").trim(),
    token: String(matrix.token || "").trim(),
    password: String(matrix.password || "").trim(),
    hasPolicy: Boolean(allChannels?.matrix)
  };
}

async function loadMatrixConfigureDefaults({ rootDir, agentName = DEFAULT_CHANNEL_AGENT_NAME } = {}) {
  const [secret, policy] = await Promise.all([
    loadMatrixConfigFromSecret(rootDir),
    loadMatrixPolicyConfig({ rootDir, agentName })
  ]);
  const legacyMode = normalizeMatrixMode(secret.legacyMode || "", DEFAULT_MATRIX_CHANNEL_MODE);
  return {
    ...secret,
    room: policy.room || secret.legacyRoom || "",
    mode: policy.hasPolicy ? policy.mode : legacyMode,
    authMode: policy.authMode || secret.authMode || "password",
    publicTagAnswer: policy.publicTagAnswer === true,
    executiveUsername: policy.executiveUsername || "",
    executiveUsernames: policy.executiveUsernames || [],
    userId: policy.userId || secret.userId || "",
    token: policy.token || secret.token || "",
    password: policy.password || secret.password || ""
  };
}

async function loadOrchestratorConfigFromSecret(rootDir) {
  const secretPath = path.join(rootDir, "configure", "secret.pya");
  const text = await readText(secretPath);
  if (!text) return {};
  const orchestratorBlock = extractManagedBlock(text, ORCHESTRATOR_CONFIG_BLOCK_NAME);
  const values = parseMapBlock(orchestratorBlock);
  return {
    mode: values.mode || "",
    host: values.host || "",
    port: values.port || "",
    autostart: values.autostart || "",
    healthMinute: values["health rhythm minute"] || ""
  };
}

async function loadMindConfigFromSecret(rootDir) {
  const secretPath = path.join(rootDir, "configure", "secret.pya");
  const text = await readText(secretPath);
  if (!text) return {};
  const mindBlock = extractManagedBlock(text, MIND_CONFIG_BLOCK_NAME);
  const relaysBlock = extractManagedBlock(text, MIND_RELAYS_BLOCK_NAME);
  const values = parseMapBlock(mindBlock);
  const relayValues = parseMapBlock(relaysBlock);
  const relays = {};
  for (const [key, value] of Object.entries(relayValues)) {
    const match = key.match(/^relay (.+) (backend|host|model|source|reasoning effort)$/);
    if (!match) continue;
    const relayName = String(match[1] ?? "").trim();
    const field = match[2] === "reasoning effort" ? "reasoningEffort" : match[2];
    if (!relayName) continue;
    if (!relays[relayName]) relays[relayName] = { source: "", backend: "", host: "", model: "", reasoningEffort: "" };
    relays[relayName][field] = String(value ?? "").trim();
  }
  if (!Object.keys(relays).length && values.backend && values.host && values.model) {
    relays[DEFAULT_MIND_RELAY_NAME] = {
      source: backendChoiceKey(values.backend),
      backend: String(values.backend).trim(),
      host: String(values.host).trim(),
      model: String(values.model).trim(),
      reasoningEffort: String(values["reasoning effort"] || "").trim()
    };
  }
  for (const relayName of Object.keys(relays)) {
    const relay = relays[relayName];
    if (!relay.source) relay.source = backendChoiceKey(relay.backend || "");
  }
  let defaultRelay = String(relayValues["default relay"] || "").trim();
  if (!defaultRelay) defaultRelay = Object.keys(relays)[0] || DEFAULT_MIND_RELAY_NAME;
  if (!relays[defaultRelay] && Object.keys(relays).length > 0) {
    defaultRelay = Object.keys(relays)[0];
  }
  const selected = relays[defaultRelay] ?? {};
  const source = String(selected.source || values.source || "").trim();
  const backend = String(selected.backend || values.backend || "").trim();
  const host = String(selected.host || values.host || "").trim();
  const model = String(selected.model || values.model || "").trim();
  const reasoningEffort = String(selected.reasoningEffort || values["reasoning effort"] || "").trim();
  return {
    source: source || backendChoiceKey(backend),
    backend,
    host,
    model,
    reasoningEffort,
    defaultRelay,
    relays
  };
}

function buildOrchestratorConfigureBlock(cfg) {
  return [
    "su name orchestrator configure be map def",
    `  su name mode ob text ${quoteText(cfg.mode)} ya`,
    `  su name host ob text ${quoteText(cfg.host)} ya`,
    `  su name port ob text ${quoteText(String(cfg.port))} ya`,
    `  su name autostart ob text ${quoteText(cfg.autostart ? "truth" : "lie")} ya`,
    `  su name health rhythm minute ob text ${quoteText(String(cfg.healthMinute))} ya`,
    "prah"
  ].join("\n");
}

function buildMatrixMapBlock(cfg) {
  const lines = [
    "su name matrix channel be map def",
    `  su name homeserver ob text ${quoteText(cfg.homeserver)} ya`
  ];
  if (cfg.appserviceRegistration) {
    lines.push(`  su name bridge service file ob text ${quoteText(String(cfg.appserviceRegistration))} ya`);
  }
  if (cfg.registrationSharedSecret) {
    lines.push(`  su name registration shared secret ob text ${quoteText(cfg.registrationSharedSecret)} ya`);
  }
  lines.push("prah");
  return lines.join("\n");
}

function buildChannelConfigureBlock() {
  return [
    "su name channel configure be map def",
    `  su name default caterer ob text ${quoteText(MATRIX_CATERER_NAME)} ya`,
    "  su name matrix ob name matrix channel ya",
    "prah"
  ].join("\n");
}

function buildChannelConductBlock({
  room,
  executiveUsernames = [],
  publicTagAnswer = true,
  toolSummary = false,
  dmToolSummary = true,
  mode = DEFAULT_MATRIX_CHANNEL_MODE,
  userId = ""
}) {
  const normalizedMode = normalizeMatrixMode(mode, DEFAULT_MATRIX_CHANNEL_MODE);
  return [
    "su name matrix channel ob bool truth ya",
    `su name matrix public tag answer ob bool ${publicTagAnswer ? "truth" : "lie"} ya`,
    `su name matrix tool summary ob bool ${toolSummary ? "truth" : "lie"} ya`,
    `su name matrix dm tool summary ob bool ${dmToolSummary ? "truth" : "lie"} ya`,
    `su name matrix mode ob text ${quoteText(normalizedMode)} ya`,
    `su name matrix room ob text ${quoteText(room)} ya`,
    ...Array.from(new Set(
      (Array.isArray(executiveUsernames) ? executiveUsernames : [])
        .map((value) => String(value ?? "").trim())
        .filter(Boolean)
    )).map((executive) => `su name matrix executive username ob text ${quoteText(executive)} ya`),
    ...(userId
      ? [`su name matrix user ob text ${quoteText(userId)} ya`]
      : [])
  ].join("\n");
}

function buildAgentChannelConductBlock({
  userId = "",
  authMode = "",
  token = "",
  password = ""
}) {
  const lines = [];
  const normalizedUserId = String(userId ?? "").trim();
  const normalizedAuthMode = String(authMode ?? "").trim().toLowerCase();
  const normalizedToken = String(token ?? "").trim();
  const normalizedPassword = String(password ?? "").trim();
  if (normalizedAuthMode) lines.push(`su name matrix auth mode ob text ${quoteText(normalizedAuthMode)} ya`);
  if (normalizedUserId) lines.push(`su name matrix user ob text ${quoteText(normalizedUserId)} ya`);
  if (normalizedToken) lines.push(`su name matrix token ob text ${quoteText(normalizedToken)} ya`);
  if (normalizedPassword) lines.push(`su name matrix password ob text ${quoteText(normalizedPassword)} ya`);
  if (!lines.length) return "# no per-agent matrix overrides";
  return lines.join("\n");
}


function matrixVerification(cfg) {
  const errors = [];
  const warnings = [];

  const homeserver = normalizeHomeserver(cfg.homeserver);
  const room = String(cfg.room || "").trim();
  const authMode = String(cfg.authMode || "").trim();
  const channelMode = normalizeMatrixMode(cfg.mode || "", "");
  const appserviceRegistration = String(cfg.appserviceRegistration || "").trim();

  if (!homeserver) errors.push({ code: "missing_homeserver", message: "homeserver is required" });
  if (!/^https?:\/\//i.test(homeserver)) {
    errors.push({ code: "invalid_homeserver_url", message: "homeserver must start with http:// or https://" });
  }

  if (!room) errors.push({ code: "missing_room", message: "room is required" });
  if (room && !room.startsWith("#") && !room.startsWith("!")) {
    errors.push({ code: "invalid_room", message: "room must start with # or !" });
  }

  if (!["password", "token", "shared-secret"].includes(authMode)) {
    errors.push({ code: "invalid_auth_mode", message: "auth mode must be password, token, or shared-secret" });
  }
  if (!MATRIX_CHANNEL_MODES.includes(channelMode)) {
    errors.push({ code: "invalid_channel_mode", message: `mode must be ${MATRIX_CHANNEL_MODES.join(", ")}` });
  }
  if (isAppserviceMode(channelMode) && !appserviceRegistration) {
    errors.push({
      code: "missing_appservice_registration",
      message: "appservice registration path is required for appservice-push mode"
    });
  }
  if (authMode === "shared-secret" && !matrixSupportsSharedSecret(homeserver)) {
    errors.push({
      code: "invalid_auth_mode_for_homeserver",
      message: "shared-secret mode is not supported for matrix.org; use password or token"
    });
  }

  if (authMode === "password") {
    if (!cfg.userId) errors.push({ code: "missing_user", message: "agent user id is required for password mode" });
    if (!cfg.password && !cfg.token) {
      errors.push({ code: "missing_password", message: "password (or existing token) is required for password mode" });
    }
  }
  if (authMode === "token") {
    if (!cfg.token) errors.push({ code: "missing_token", message: "token is required for token mode" });
  }
  if (authMode === "shared-secret") {
    if (!cfg.registrationSharedSecret) {
      errors.push({ code: "missing_registration_shared_secret", message: "registration shared secret is required" });
    }
    if (!cfg.userId) {
      warnings.push({ code: "missing_user_shared_secret", message: "agent user id is recommended for shared-secret mode" });
    }
  }

  const host = homeserverHost(homeserver);
  const roomServer = matrixServerFromId(room);
  if (host && roomServer && host !== roomServer) {
    warnings.push({
      code: "room_server_mismatch",
      message: `room server (${roomServer}) differs from homeserver (${host})`
    });
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings
  };
}

async function matrixLiveTest(cfg) {
  const checks = [];
  try {
    await matrixVersions({ homeserver: cfg.homeserver });
    checks.push({ name: "homeserver reachable", ok: true });
  } catch (err) {
    checks.push({ name: "homeserver reachable", ok: false, error: String(err?.message || err) });
    return { ok: false, checks };
  }

  let token = cfg.token;
  if (!token && cfg.authMode === "password" && cfg.userId && cfg.password) {
    try {
      const login = await loginMatrixWithPassword({
        homeserver: cfg.homeserver,
        userId: cfg.userId,
        password: cfg.password
      });
      token = login.token;
      checks.push({ name: "password login", ok: true, userId: login.userId || cfg.userId });
    } catch (err) {
      checks.push({ name: "password login", ok: false, error: String(err?.message || err) });
      return { ok: false, checks };
    }
  }

  if (!token) {
    checks.push({ name: "auth verification", ok: false, error: "missing token for whoami" });
    return { ok: false, checks };
  }

  try {
    const who = await matrixWhoAmI({
      homeserver: cfg.homeserver,
      token,
      userId: cfg.userId || "",
      mode: cfg.mode || ""
    });
    checks.push({ name: "whoami", ok: true, userId: who.userId || null });
  } catch (err) {
    checks.push({ name: "whoami", ok: false, error: String(err?.message || err) });
    return { ok: false, checks };
  }

  return { ok: true, checks };
}

async function ensureSharedSecretToken({ cfg, rootDir }) {
  if (cfg.authMode !== "shared-secret" || cfg.token) return cfg;
  const agentName = String(cfg.agentName || DEFAULT_CHANNEL_AGENT_NAME).trim() || DEFAULT_CHANNEL_AGENT_NAME;
  const agentHouse = resolveConfiguredAgentHouseFromRoot(rootDir, agentName);
  const credentials = await ensureMatrixCredentials({
    agentName,
    agentHouse,
    config: {
      homeserver: cfg.homeserver,
      user: cfg.userId || null,
      token: cfg.token || null,
      registrationSharedSecret: cfg.registrationSharedSecret || null,
      adminToken: cfg.adminToken || null
    }
  });
  return {
    ...cfg,
    token: credentials.token || cfg.token,
    userId: cfg.userId || credentials.user || ""
  };
}

async function ensureExecutiveDmRoom({ cfg, rootDir }) {
  const agentName = String(cfg.agentName || DEFAULT_CHANNEL_AGENT_NAME).trim() || DEFAULT_CHANNEL_AGENT_NAME;
  const agentHouse = resolveConfiguredAgentHouseFromRoot(rootDir, agentName);
  const roomId = await ensureMatrixExecutiveDmRoom({
    agentHouse,
    homeserver: cfg.homeserver,
    token: cfg.token,
    user: cfg.userId,
    mode: cfg.mode || "",
    executiveUser: cfg.executiveUsername
  });
  return roomId;
}

async function matrixPostSetupTest(cfg, { rootDir } = {}) {
  const checks = [];
  const executiveUsernames = Array.from(new Set(
    [
      ...(Array.isArray(cfg.executiveUsernames) ? cfg.executiveUsernames : []),
      cfg.executiveUsername
    ]
      .map((value) => String(value ?? "").trim())
      .filter(Boolean)
  ));
  const live = await matrixLiveTest(cfg);
  checks.push(...(live.checks || []));
  if (!live.ok) return { ok: false, checks };

  if (!cfg.token) {
    checks.push({ name: "room join + greeting", ok: true, note: "skipped: no token available" });
    if (executiveUsernames.length > 0) {
      checks.push({ name: "executive dm greeting", ok: true, note: "skipped: no token available" });
    }
    return { ok: true, checks };
  }

  try {
    const joinedRoomId = await matrixJoinRoom({
      homeserver: cfg.homeserver,
      token: cfg.token,
      room: cfg.room,
      mode: cfg.mode || "",
      userId: cfg.userId || ""
    });
    checks.push({ name: "join room", ok: true, roomId: joinedRoomId });
    const roomEventId = await matrixSendRoomMessage({
      homeserver: cfg.homeserver,
      token: cfg.token,
      roomId: joinedRoomId,
      content: "Pyash configure test greeting. If you can read this, channel setup works.",
      mode: cfg.mode || "",
      userId: cfg.userId || ""
    });
    checks.push({ name: "send room greeting", ok: true, eventId: roomEventId });
  } catch (err) {
    checks.push({ name: "room join + greeting", ok: false, error: String(err?.message || err) });
    return { ok: false, checks };
  }

  if (executiveUsernames.length > 0) {
    for (const executiveUsername of executiveUsernames) {
      try {
        const dmRoomId = rootDir
          ? await ensureExecutiveDmRoom({ cfg: { ...cfg, executiveUsername }, rootDir })
          : await matrixCreateDirectRoom({
            homeserver: cfg.homeserver,
            token: cfg.token,
            executiveUsername,
            mode: cfg.mode || "",
            userId: cfg.userId || ""
          });
        checks.push({ name: "resolve executive dm room", ok: true, executiveUsername, roomId: dmRoomId });
        const dmEventId = await matrixSendRoomMessage({
          homeserver: cfg.homeserver,
          token: cfg.token,
          roomId: dmRoomId,
          content: "Pyash configure DM test greeting. Executive messaging is working.",
          mode: cfg.mode || "",
          userId: cfg.userId || ""
        });
        checks.push({ name: "send executive dm greeting", ok: true, executiveUsername, eventId: dmEventId });
      } catch (err) {
        checks.push({ name: "executive dm greeting", ok: false, executiveUsername, error: String(err?.message || err) });
        return { ok: false, checks };
      }
    }
  }

  return { ok: true, checks };
}

async function matrixDoctor({ rootDir }) {
  const loaded = await loadMatrixConfigureDefaults({ rootDir, agentName: DEFAULT_CHANNEL_AGENT_NAME });
  const configExists = Boolean(
    loaded.homeserver
    || loaded.room
    || loaded.token
    || loaded.userId
    || loaded.authMode
    || loaded.registrationSharedSecret
  );
  if (!configExists) {
    return {
      ok: false,
      issues: [{ code: "missing_config", kind: "missing", message: "matrix channel config is missing from configure/secret.pya + world/conduct/channels.pya" }],
      remedies: ["run: pyash configure channel matrix"]
    };
  }

  const resolved = await ensureSharedSecretToken({ cfg: { ...loaded, agentName: DEFAULT_CHANNEL_AGENT_NAME }, rootDir });
  const verification = matrixVerification(resolved);
  const issues = [];
  for (const err of verification.errors) issues.push({ code: err.code, kind: "invalid", message: err.message });
  for (const warn of verification.warnings) issues.push({ code: warn.code, kind: "warning", message: warn.message });
  if (loaded.legacyRoom) {
    issues.push({
      code: "legacy_secret_room",
      kind: "warning",
      message: "legacy room declaration found in configure/secret.pya; room now belongs in world/conduct/channels.pya"
    });
  }
  if (loaded.legacyMode) {
    issues.push({
      code: "legacy_secret_mode",
      kind: "warning",
      message: "legacy mode declaration found in configure/secret.pya; mode now belongs in world/conduct/channels.pya"
    });
  }
  let appservice = null;
  if (isAppserviceMode(resolved.mode) && resolved.appserviceRegistration) {
    try {
      const loaded = await readMatrixAppserviceRegistration({
        rootDir,
        registrationPath: resolved.appserviceRegistration
      });
      appservice = {
        path: loaded.path,
        id: loaded.id || "",
        senderLocalpart: loaded.senderLocalpart,
        url: loaded.url,
        hasAsToken: Boolean(loaded.asToken),
        hasHsToken: Boolean(loaded.hsToken)
      };
    } catch (err) {
      issues.push({
        code: "invalid_appservice_registration",
        kind: "invalid",
        message: String(err?.message || err)
      });
    }
  }

  let live = null;
  if (verification.ok) {
    live = await matrixLiveTest(resolved);
    if (!live.ok) {
      issues.push({ code: "live_check_failed", kind: "unreachable", message: "live check failed; inspect checks for details" });
    }
  }

  const remedies = [];
  if (!verification.ok) {
    remedies.push("rerun configure: pyash configure channel matrix");
  }
  if (issues.some((issue) => issue.code === "room_server_mismatch")) {
    remedies.push("set room server suffix to match homeserver host");
  }
  if (issues.some((issue) => issue.code === "live_check_failed")) {
    remedies.push("verify homeserver reachability and credentials, then rerun: pyash configure channel matrix test");
  }

  return {
    ok: verification.ok && (!live || live.ok) && !issues.some((issue) => issue.kind === "invalid"),
    config: redactMatrixConfig(resolved),
    issues,
    live,
    appservice,
    remedies
  };
}

function collectMatrixFromFlags({ args, prior }) {
  const homeserver = normalizeHomeserver(parseArgValue(args, "--homeserver") ?? prior.homeserver ?? "");
  const host = homeserverHost(homeserver);
  const providedRoom = parseArgValue(args, "--room");
  const room = providedRoom
    ? ensureMatrixIdServer(providedRoom, host)
    : rewriteMatrixIdServer(prior.room ?? "", host);
  const providedExecutives = parseArgValues(args, "--executive");
  const priorExecutives = Array.isArray(prior.executiveUsernames) && prior.executiveUsernames.length
    ? prior.executiveUsernames
    : [prior.executiveUsername ?? ""];
  const executiveUsernames = Array.from(new Set(
    (providedExecutives.length ? providedExecutives : priorExecutives)
      .map((value) => ensureMatrixUserServer(value, host))
      .filter(Boolean)
  ));
  const executiveUsername = executiveUsernames[0] ?? "";
  const providedUserId = parseArgValue(args, "--agent-user-id");
  const userId = ensureMatrixUserServer(providedUserId ?? prior.userId ?? "", host);
  const authMode = String(parseArgValue(args, "--auth-mode") ?? prior.authMode ?? "password").trim().toLowerCase();
  const token = parseArgValue(args, "--token") ?? prior.token ?? "";
  const password = parseArgValue(args, "--password") ?? "";
  const registrationSharedSecret = parseArgValue(args, "--registration-shared-secret") ?? prior.registrationSharedSecret ?? "";
  const adminToken = parseArgValue(args, "--admin-token") ?? prior.adminToken ?? "";
  const mode = normalizeMatrixMode(
    parseArgValue(args, "--mode") ?? prior.mode ?? DEFAULT_MATRIX_CHANNEL_MODE,
    DEFAULT_MATRIX_CHANNEL_MODE
  );
  const appserviceRegistration = String(
    parseArgValue(args, "--appservice-registration")
      ?? prior.appserviceRegistration
      ?? (isAppserviceMode(mode) ? DEFAULT_MATRIX_APPSERVICE_REGISTRATION : "")
  ).trim();
  const explicitAgentName = parseArgValue(args, "--agent");
  const agentName = normalizeChannelAgentName(explicitAgentName ?? (providedUserId ? "" : (prior.agentName ?? "")));
  const writeAgentPolicy = parseTruthy(parseArgValue(args, "--write-agent-policy"), true);
  const publicTagAnswer = parseTruthy(parseArgValue(args, "--public-tag-answer"), prior.publicTagAnswer !== false);

  return {
    homeserver,
    room,
    executiveUsername,
    executiveUsernames,
    userId,
    authMode,
    token,
    password,
    registrationSharedSecret,
    adminToken,
    mode,
    appserviceRegistration,
    agentName,
    writeAgentPolicy,
    publicTagAnswer
  };
}

async function collectMatrixInteractive({ prior, mode, rootDir, explicitAgentName = "" }) {
  const quickstart = mode !== "advanced";
  const printer = sectionPrinter();
  const muteOutput = new MuteWritable(process.stdout);
  const rl = readline.createInterface({ input: process.stdin, output: muteOutput, terminal: true });
  try {
    const ask = async (label, fallback = "") => {
      muteOutput.muted = false;
      const shown = fallback ? ` [${fallback}]` : "";
      const v = (await rl.question(`${label}${shown}: `)).trim();
      return v || fallback;
    };
    const askYesNo = async (label, fallback = true) => {
      muteOutput.muted = false;
      const shown = fallback ? "Y/n" : "y/N";
      const v = (await rl.question(`${label} [${shown}]: `)).trim().toLowerCase();
      if (!v) return fallback;
      return v === "y" || v === "yes";
    };
    const askSecret = async (label, fallback = "", opts = {}) => {
      const shown = fallback
        ? (opts.noChange ? " [press enter for no change]" : " [set]")
        : "";
      muteOutput.muted = false;
      process.stdout.write(`${label}${shown}: `);
      muteOutput.muted = true;
      const v = (await rl.question("")).trim();
      muteOutput.muted = false;
      process.stdout.write("\n");
      return v || fallback;
    };
    const validateHomeserverUrl = (value) => {
      try {
        const url = new URL(value);
        if (!/^https?:$/i.test(url.protocol)) {
          return "homeserver must use http or https";
        }
        return "";
      } catch {
        return "homeserver must be a valid URL or hostname";
      }
    };

    printer.header("A.1 Homeserver");
    printer.why("All channel and auth operations depend on the homeserver endpoint.");
    printer.how("Enter server host or full URL. If protocol is omitted, https:// is assumed.");
    printer.examples("matrix.org | https://matrix.liberit.ca");
    let homeserver = "";
    while (!homeserver) {
      const entered = await ask("Matrix homeserver", prior.homeserver || "https://matrix.org");
      const normalized = normalizeHomeserver(entered);
      const issue = validateHomeserverUrl(normalized);
      if (issue) {
        textOut(`- invalid: ${issue}`);
        continue;
      }
      let reachable = false;
      try {
        await matrixVersions({ homeserver: normalized });
        reachable = true;
        textOut("- check: homeserver reachable");
      } catch (err) {
        textOut(`- warning: homeserver check failed (${String(err?.message || err)})`);
      }
      if (!reachable) {
        const keep = await askYesNo("Keep this homeserver anyway", false);
        if (!keep) continue;
      }
      homeserver = normalized;
      textOut(`- server set to ${homeserver}`);
      textOut(`- server check ${reachable ? "passed" : "not verified"}`);
    }
    const host = homeserverHost(homeserver);

    const detectedDefaultAppservicePath = await pathExists(
      path.join(rootDir, DEFAULT_MATRIX_APPSERVICE_REGISTRATION)
    )
      ? DEFAULT_MATRIX_APPSERVICE_REGISTRATION
      : "";
    let appserviceRegistration = String(prior.appserviceRegistration || "").trim();
    let appserviceLoaded = null;
    let appserviceDetectedAccepted = false;
    let channelMode = "";
    if (!appserviceRegistration && detectedDefaultAppservicePath) {
      printer.header("A.1b Appservice Detection");
      printer.why("A default Matrix appservice registration file was detected.");
      printer.how("Using it now can skip manual appservice path entry.");
      printer.examples(detectedDefaultAppservicePath);
      const useDetectedAppservice = await askYesNo(
        `Use detected ${detectedDefaultAppservicePath}`,
        true
      );
      if (useDetectedAppservice) {
        channelMode = "appservice-push";
        appserviceRegistration = detectedDefaultAppservicePath;
        appserviceDetectedAccepted = true;
        textOut("- mode set to appservice-push");
      }
    }

    if (!channelMode) {
      printer.header("A.2 Delivery Mode");
      printer.why("Delivery mode controls how fast channel input reaches the router.");
      printer.how("sync uses long-poll, poll is low-overhead fallback, appservice-push enables global input with fallback.");
      printer.examples("sync | appservice-push | poll");
      while (!channelMode) {
        const enteredMode = normalizeMatrixMode(
          await ask("Channel mode", normalizeMatrixMode(prior.mode || "", DEFAULT_MATRIX_CHANNEL_MODE)),
          ""
        );
        if (!enteredMode || !MATRIX_CHANNEL_MODES.includes(enteredMode)) {
          textOut(`- invalid: mode must be ${MATRIX_CHANNEL_MODES.join(", ")}`);
          continue;
        }
        channelMode = enteredMode;
      }
    }
    if (isAppserviceMode(channelMode)) {
      printer.header("A.3 Appservice Registration");
      printer.why("Registration file contains service tokens and sender namespace for Matrix push routing.");
      printer.how("Put the file at configure/secret/matrix.yaml (recommended) or provide another local YAML path.");
      printer.examples("configure/secret/matrix.yaml");
      let validated = false;
      if (appserviceRegistration) {
        try {
          const loaded = await readMatrixAppserviceRegistration({
            rootDir,
            registrationPath: appserviceRegistration
          });
          appserviceLoaded = loaded;
          textOut(`- appservice registration loaded (${loaded.path})`);
          textOut(`- appservice sender localpart ${loaded.senderLocalpart}`);
          validated = true;
          if (!appserviceDetectedAccepted) {
            textOut("- using appservice registration path");
          }
        } catch {
          appserviceRegistration = "";
        }
      }
      while (!validated) {
        appserviceRegistration = String(await ask(
          "Appservice registration path",
          appserviceRegistration || DEFAULT_MATRIX_APPSERVICE_REGISTRATION
        )).trim();
        try {
          const loaded = await readMatrixAppserviceRegistration({
            rootDir,
            registrationPath: appserviceRegistration
          });
          appserviceLoaded = loaded;
          textOut(`- appservice registration loaded (${loaded.path})`);
          textOut(`- appservice sender localpart ${loaded.senderLocalpart}`);
          validated = true;
        } catch (err) {
          textOut(`- invalid: ${String(err?.message || err)}`);
          const retry = await askYesNo("Retry appservice registration path", true);
          if (!retry) throw err;
          appserviceRegistration = "";
        }
      }
    }

    let userId = ensureMatrixUserServer(prior.userId || "", host);
    let agentName = normalizeChannelAgentName(explicitAgentName || prior.agentName || DEFAULT_CHANNEL_AGENT_NAME) || DEFAULT_CHANNEL_AGENT_NAME;
    let token = prior.token || "";
    let password = "";
    let registrationSharedSecret = prior.registrationSharedSecret || "";
    let adminToken = prior.adminToken || "";
    let authMode = "";
    let useAppserviceRegistrationAuth = false;
    if (isAppserviceMode(channelMode) && appserviceLoaded) {
      printer.header("B.1 Appservice Auth");
      printer.why("Appservice registration already includes sender identity and channel token.");
      printer.how("Pyash will use registration auth automatically for channel setup.");
      printer.examples("sender_localpart + as_token from configure/secret/matrix.yaml");
      useAppserviceRegistrationAuth = true;
      authMode = "token";
      token = String(appserviceLoaded.asToken || "").trim();
      const derivedUserId = matrixUserIdFromLocalpart(appserviceLoaded.senderLocalpart, homeserver);
      userId = derivedUserId || userId;
      textOut("- auth mode set to token (appservice-push)");
      if (userId) textOut(`- sender user id ${userId}`);
    }

    if (!authMode) {
      printer.header("B.1 Matrix Auth");
      printer.why("The caterer needs credentials to verify and send.");
      const supportsSharedSecret = matrixSupportsSharedSecret(homeserver);
      const allowedAuthModes = supportsSharedSecret
        ? ["password", "token", "shared-secret"]
        : ["password", "token"];
      printer.how(supportsSharedSecret
        ? "Choose password for easiest setup, token for existing access token, shared-secret for self-hosted Synapse."
        : "Choose password for easiest setup, or token for existing access token.");
      printer.examples(allowedAuthModes.join(" | "));
      while (!authMode) {
        const defaultAuth = allowedAuthModes.includes(String(prior.authMode || "").trim().toLowerCase())
          ? String(prior.authMode || "").trim().toLowerCase()
          : "password";
        const picked = String(await ask("Auth mode", defaultAuth)).trim().toLowerCase();
        if (!allowedAuthModes.includes(picked)) {
          textOut(`- invalid: auth mode must be ${allowedAuthModes.join(", ")}`);
          continue;
        }
        authMode = picked;
      }
    }

    let authOk = false;
    while (!authOk) {
      if (useAppserviceRegistrationAuth) {
        // Appservice token + sender id already selected from registration.
      } else if (authMode === "password") {
        printer.header("B.2 Password Flow");
        printer.why("Password can be exchanged for token automatically.");
        printer.how("Use your bot/service account user id and password.");
        printer.examples("@pyash-agent:matrix.org");
        userId = ensureMatrixUserServer(await ask("Agent Matrix user id", userId || "@pyash-agent"), host);
        password = "";
        while (!password) {
          password = await askSecret("Matrix password");
          if (!password) textOut("- invalid: password is required for password mode");
        }
        token = "";
        registrationSharedSecret = "";
        adminToken = "";
      } else if (authMode === "token") {
        printer.header("B.2 Token Flow");
        printer.why("Use existing access token without password exchange.");
        printer.how("Get from Matrix client session export or login API response.");
        printer.examples("POST /_matrix/client/v3/login and copy access_token");
        token = "";
        while (!token) {
          token = await askSecret("Access token", token);
          if (!token) textOut("- invalid: access token is required for token mode");
        }
        userId = ensureMatrixUserServer(await ask("Agent Matrix user id (optional)", userId), host);
        registrationSharedSecret = "";
        adminToken = "";
      } else {
        printer.header("B.2 Shared-Secret Flow");
        printer.why("Self-hosted Synapse bootstrap can register agents via shared secret.");
        printer.how("Read registration_shared_secret from homeserver.yaml (Synapse).");
        printer.examples("registration_shared_secret: <value>");
        textOut("This step configures the default agent account for this channel setup.");
        textOut("Other agents should use their own Matrix user identities in their own setup flows.");
        registrationSharedSecret = registrationSharedSecret || prior.registrationSharedSecret || "";
        while (!registrationSharedSecret) {
          registrationSharedSecret = await askSecret(
            "Registration shared secret",
            registrationSharedSecret,
            { noChange: true }
          );
          if (!registrationSharedSecret) textOut("- invalid: registration shared secret is required for shared-secret mode");
        }
        userId = ensureMatrixUserServer(await ask("Default agent Matrix user id", userId || "@pyash-agent"), host);
        adminToken = "";
        // Keep existing token so reruns are idempotent for already-registered users.
        token = token || prior.token || "";
        password = "";
      }

      try {
        let authCfg = {
          homeserver,
          userId,
          authMode,
          token,
          password,
          registrationSharedSecret,
          adminToken,
          agentName,
          mode: channelMode
        };
        if (authMode === "password" && !authCfg.token && authCfg.userId && authCfg.password) {
          const login = await loginMatrixWithPassword({
            homeserver: authCfg.homeserver,
            userId: authCfg.userId,
            password: authCfg.password
          });
          authCfg = { ...authCfg, token: login.token, userId: login.userId || authCfg.userId };
        }
        authCfg = await ensureSharedSecretToken({ cfg: authCfg, rootDir });
        const live = await matrixLiveTest(authCfg);
        if (!live.ok) throw new Error((live.checks || []).filter((c) => !c.ok).map((c) => c.error || c.name).join("; ") || "auth check failed");
        token = authCfg.token;
        userId = authCfg.userId || userId;
        textOut("- auth check passed");
        authOk = true;
      } catch (err) {
        textOut(`- auth check failed (${String(err?.message || err)})`);
        const retry = await askYesNo("Retry authentication step", true);
        if (!retry) throw err;
      }
    }

    printer.header("C.1 Channel");
    printer.why("The agent should join a target room and send a greeting test.");
    printer.how("Use room id (!...) for reliability, alias (#...) is acceptable.");
    printer.examples("!roomid:matrix.liberit.ca | #pyash:matrix.liberit.ca");
    let room = "";
    while (!room) {
      const roomDefault = rewriteMatrixIdServer(prior.room || "#pyash", host);
      const enteredRoom = await ask("Room id or alias (!room:server or #alias:server)", roomDefault);
      const normalizedRoom = ensureMatrixIdServer(enteredRoom, host);
      if (!normalizedRoom.startsWith("#") && !normalizedRoom.startsWith("!")) {
        textOut("- invalid: room must start with # or !");
        continue;
      }
      room = normalizedRoom;
    }

    let executiveUsername = ensureMatrixUserServer(prior.executiveUsername || "", host);
    let writeAgentPolicy = true;
    let publicTagAnswer = prior.publicTagAnswer !== false;

    printer.header("D.1 Executive Test");
    printer.why("Optional executive user can receive a DM greeting test.");
    printer.how("Set a user id to test direct messaging; leave blank to skip.");
    printer.examples("@andrii:matrix.liberit.ca");
    executiveUsername = ensureMatrixUserServer(await ask("Executive user (optional DM target)", executiveUsername), host);
    const executiveUsernames = Array.from(new Set(
      [
        executiveUsername,
        ...(Array.isArray(prior.executiveUsernames) ? prior.executiveUsernames : [])
      ]
        .map((value) => ensureMatrixUserServer(value, host))
        .filter(Boolean)
    ));
    if (executiveUsername) {
      try {
        const dmRoomId = await ensureMatrixExecutiveDmRoom({
          agentHouse: resolveConfiguredAgentHouseFromRoot(rootDir, agentName),
          homeserver,
          token,
          user: userId,
          executiveUser: executiveUsername
        });
        await matrixSendRoomMessage({
          homeserver,
          token,
          roomId: dmRoomId,
          content: "Pyash configure DM test greeting. Executive messaging is working."
        });
        textOut("- executive DM test passed");
      } catch (err) {
        textOut(`- executive DM test failed (${String(err?.message || err)})`);
      }
    }

    if (!quickstart) {
      printer.header("E.1 Agent Conduct Files");
      printer.why("Optional local channel conduct file can be generated per agent.");
      printer.how("Enable when you want the declared agent house conduct/channels.pya written.");
      printer.examples(`agent=${DEFAULT_CHANNEL_AGENT_NAME}`);
      writeAgentPolicy = await askYesNo("Write agent channel conduct file", true);
      if (writeAgentPolicy) {
        agentName = normalizeChannelAgentName(await ask("Agent name", agentName)) || agentName;
      }
    }
    if (quickstart && !String(explicitAgentName || "").trim()) {
      const inferred = sanitizeMatrixLocalpart(matrixLocalpartFromUserId(userId));
      if (inferred) agentName = inferred;
    }

    return {
      homeserver,
      room,
      executiveUsername,
      executiveUsernames,
      userId,
      authMode,
      token,
      password,
      registrationSharedSecret,
      adminToken,
      mode: channelMode,
      appserviceRegistration,
      writeAgentPolicy,
      agentName,
      publicTagAnswer,
      configureMode: quickstart ? "quickstart" : "advanced"
    };
  } finally {
    rl.close();
  }
}

function normalizeMatrixCollected(cfg) {
  const homeserver = normalizeHomeserver(cfg.homeserver);
  const host = homeserverHost(homeserver);
  const room = ensureMatrixIdServer(cfg.room, host);
  const executiveUsernames = Array.from(new Set(
    [
      ...(Array.isArray(cfg.executiveUsernames) ? cfg.executiveUsernames : []),
      cfg.executiveUsername
    ]
      .map((value) => ensureMatrixUserServer(value, host))
      .filter(Boolean)
  ));
  const mode = normalizeMatrixMode(cfg.mode || "", DEFAULT_MATRIX_CHANNEL_MODE);
  const appserviceRegistration = String(cfg.appserviceRegistration || "").trim();
  const inferredFromUserId = sanitizeMatrixLocalpart(matrixLocalpartFromUserId(cfg.userId || ""));
  const normalizedAgentName = normalizeChannelAgentName(cfg.agentName)
    || inferredFromUserId
    || DEFAULT_CHANNEL_AGENT_NAME;
  return {
    ...cfg,
    homeserver,
    room,
    mode,
    appserviceRegistration,
    executiveUsername: executiveUsernames[0] || "",
    executiveUsernames,
    userId: ensureMatrixUserServer(cfg.userId, host),
    authMode: String(cfg.authMode || "password").trim().toLowerCase(),
    agentName: normalizedAgentName
  };
}

function applyAppserviceAuthDefaults(cfg, appserviceLoaded) {
  if (!cfg || !isAppserviceMode(cfg.mode)) return cfg;
  if (!appserviceLoaded) return cfg;
  const next = { ...cfg };
  const currentAuthMode = String(next.authMode || "").trim().toLowerCase();
  if (!currentAuthMode || currentAuthMode === "password" || currentAuthMode === "shared-secret") {
    next.authMode = "token";
  }
  if (!next.token) next.token = String(appserviceLoaded.asToken || "").trim();
  const expectedUserId = matrixUserIdFromLocalpart(appserviceLoaded.senderLocalpart, next.homeserver);
  const currentLocalpart = sanitizeMatrixLocalpart(matrixLocalpartFromUserId(next.userId));
  const expectedLocalpart = sanitizeMatrixLocalpart(appserviceLoaded.senderLocalpart);
  if (!next.userId || (expectedLocalpart && currentLocalpart !== expectedLocalpart)) {
    next.userId = expectedUserId;
  }
  return next;
}

async function createMatrixWritePlan({ rootDir, cfg }) {
  const secretPath = path.join(rootDir, "configure", "secret.pya");
  const secretExisting = await readText(secretPath);

  const matrixBlockPlan = planManagedUpsert({
    existing: secretExisting,
    blockName: MATRIX_BLOCK_NAME,
    content: buildMatrixMapBlock(cfg)
  });

  const channelBlockPlan = planManagedUpsert({
    existing: matrixBlockPlan.nextText,
    blockName: CHANNEL_CONFIG_BLOCK_NAME,
    content: buildChannelConfigureBlock()
  });

  const writes = [{
    path: secretPath,
    changed: channelBlockPlan.changed || matrixBlockPlan.changed,
    action: channelBlockPlan.action,
    preview: [MATRIX_BLOCK_NAME, CHANNEL_CONFIG_BLOCK_NAME],
    nextText: channelBlockPlan.nextText
  }];

  const worldChannelPath = path.join(rootDir, "world", "conduct", "channels.pya");
  const worldChannelExisting = await readText(worldChannelPath);
  const worldChannelScrubbed = scrubLegacyMatrixChannelSeed(worldChannelExisting);
  const worldChannelSeedChanged = worldChannelScrubbed !== worldChannelExisting;
  const worldPolicyPlan = planManagedUpsert({
    existing: worldChannelScrubbed,
    blockName: MATRIX_WORLD_POLICY_BLOCK_NAME,
    content: buildChannelConductBlock({
      room: cfg.room,
      executiveUsernames: Array.isArray(cfg.executiveUsernames) ? cfg.executiveUsernames : [],
      publicTagAnswer: cfg.publicTagAnswer,
      toolSummary: false,
      dmToolSummary: true,
      mode: cfg.mode
    })
  });
  writes.push({
    path: worldChannelPath,
    changed: worldPolicyPlan.changed || worldChannelSeedChanged,
    action: worldPolicyPlan.action,
    preview: [MATRIX_WORLD_POLICY_BLOCK_NAME],
    nextText: worldPolicyPlan.nextText
  });

  if (cfg.writeAgentPolicy && cfg.agentName && cfg.agentName.trim()) {
    const configuredAgentHouse = resolveConfiguredAgentHouseFromRoot(rootDir, cfg.agentName);
    const channelPath = path.join(configuredAgentHouse, "conduct", "channels.pya");
    const channelExisting = await readText(channelPath);
    const channelSeedScrubbed = scrubLegacyMatrixChannelSeed(channelExisting);
    const channelSeedChanged = channelSeedScrubbed !== channelExisting;
    const policyPlan = planManagedUpsert({
      existing: channelSeedScrubbed,
      blockName: MATRIX_POLICY_BLOCK_NAME,
      content: buildAgentChannelConductBlock({
        userId: cfg.userId,
        authMode: cfg.authMode,
        token: cfg.token,
        password: cfg.password
      })
    });
    writes.push({
      path: channelPath,
      changed: policyPlan.changed || channelSeedChanged,
      action: policyPlan.action,
      preview: [MATRIX_POLICY_BLOCK_NAME],
      nextText: policyPlan.nextText
    });

  }

  if (cfg.agentName && cfg.agentName.trim()) {
    const configuredAgentHouse = resolveConfiguredAgentHouseFromRoot(rootDir, cfg.agentName);
    const worldCalendarPath = path.join(rootDir, "world", "conduct", "calendar.pya");
    const worldCalendarExisting = await readText(worldCalendarPath);
    const worldLegacyCleaned = stripLegacySingleChannelScheduleText({
      existing: worldCalendarExisting,
      channelType: MATRIX_CATERER_NAME,
      scheduleNames: ["probe", "input", "produce"]
    });
    const worldWithoutPoll = stripAgentChannelScheduleText({
      existing: worldLegacyCleaned,
      agentName: cfg.agentName,
      scheduleName: "poll"
    });
    const worldWithoutInput = stripAgentChannelScheduleText({
      existing: worldWithoutPoll,
      agentName: cfg.agentName,
      scheduleName: "input"
    });
    const worldWithoutProduce = stripAgentChannelScheduleText({
      existing: worldWithoutInput,
      agentName: cfg.agentName,
      scheduleName: "produce"
    });
    const worldPollPlan = planManagedUpsert({
      existing: worldWithoutProduce,
      blockName: "channel poll schedule",
      content: buildChannelPollCalendarBlock({
        channelType: MATRIX_CATERER_NAME,
        intervalSeconds: DEFAULT_CHANNEL_POLL_INTERVAL_SECONDS
      })
    });
    const worldInputPlan = planManagedUpsert({
      existing: worldPollPlan.nextText,
      blockName: "channel input schedule",
      content: buildChannelInputCalendarBlock({
        channels: [MATRIX_CATERER_NAME],
        intervalSeconds: 1
      })
    });
    const worldProducePlan = planManagedUpsert({
      existing: worldInputPlan.nextText,
      blockName: "channel produce schedule",
      content: buildChannelProduceCalendarBlock({
        channels: [MATRIX_CATERER_NAME],
        intervalSeconds: 1
      })
    });
    writes.push({
      path: worldCalendarPath,
      changed: worldPollPlan.changed
        || worldInputPlan.changed
        || worldProducePlan.changed
        || (worldLegacyCleaned !== worldCalendarExisting),
      action: worldProducePlan.action,
      preview: ["channel poll schedule", "channel input schedule", "channel produce schedule"],
      nextText: worldProducePlan.nextText
    });

    const calendarPath = path.join(configuredAgentHouse, "conduct", "calendar.pya");
    const calendarExisting = await readText(calendarPath);
    const calendarWithoutPoll = stripAgentChannelScheduleText({
      existing: calendarExisting,
      agentName: cfg.agentName,
      scheduleName: "poll"
    });
    const calendarWithoutInput = stripAgentChannelScheduleText({
      existing: calendarWithoutPoll,
      agentName: cfg.agentName,
      scheduleName: "input"
    });
    const calendarWithoutProduce = stripAgentChannelScheduleText({
      existing: calendarWithoutInput,
      agentName: cfg.agentName,
      scheduleName: "produce"
    });
    writes.push({
      path: calendarPath,
      changed: calendarWithoutProduce !== calendarExisting,
      action: "replace",
      preview: ["channel poll calendar cleanup", "channel input calendar cleanup", "channel produce calendar cleanup"],
      nextText: calendarWithoutProduce
    });
  }

  return {
    writes,
    changed: writes.some((item) => item.changed)
  };
}

async function applyWritePlan(plan) {
  for (const write of plan.writes) {
    if (!write.changed) continue;
    await ensureDirForFile(write.path);
    await fs.writeFile(write.path, write.nextText, "utf8");
  }
}

function writePlanSummary(plan) {
  return plan.writes.map((write) => ({
    path: write.path,
    changed: write.changed,
    action: write.action,
    blocks: write.preview
  }));
}

async function configureChannelList({ json }) {
  const payload = {
    ok: true,
    caterers: [{
      name: MATRIX_CATERER_NAME,
      supports: ["configure", "test", "doctor"]
    }]
  };
  if (json) jsonOut(payload);
  else {
    textOut("Available caterers:");
    textOut("- matrix (configure, test, doctor)");
  }
}

async function configureMatrix({ args }) {
  const rootDir = await resolveRootDirFromArgs(args);
  const ephemeralRoot = isEphemeralRootDir(rootDir);
  const json = hasFlag(args, "--json");
  const print = hasFlag(args, "--print");
  const dryRun = hasFlag(args, "--dry-run");
  const nonInteractive = hasFlag(args, "--non-interactive");
  const mode = hasFlag(args, "--advanced") ? "advanced" : "quickstart";
  const testNowFlag = parseArgValue(args, "--test-now");
  const startNowFlag = parseArgValue(args, "--start-now");
  const explicitAgentName = parseArgValue(args, "--agent");
  const configureAgentName = explicitAgentName ?? DEFAULT_CHANNEL_AGENT_NAME;

  const prior = await loadMatrixConfigureDefaults({ rootDir, agentName: configureAgentName });
  const collected = nonInteractive
    ? collectMatrixFromFlags({ args, prior })
    : await collectMatrixInteractive({ prior, mode, rootDir, explicitAgentName });

  let cfg = normalizeMatrixCollected(collected);
  if (cfg.userId || cfg.token || cfg.password || cfg.authMode) {
    cfg = { ...cfg, writeAgentPolicy: true };
  }

  let verification = matrixVerification(cfg);
  let appservice = null;
  let appserviceLoaded = null;
  if (isAppserviceMode(cfg.mode) && cfg.appserviceRegistration) {
    try {
      appserviceLoaded = await readMatrixAppserviceRegistration({
        rootDir,
        registrationPath: cfg.appserviceRegistration
      });
      cfg = applyAppserviceAuthDefaults(cfg, appserviceLoaded);
      verification = matrixVerification(cfg);
      appservice = {
        path: appserviceLoaded.path,
        id: appserviceLoaded.id || "",
        senderLocalpart: appserviceLoaded.senderLocalpart,
        url: appserviceLoaded.url,
        hasAsToken: Boolean(appserviceLoaded.asToken),
        hasHsToken: Boolean(appserviceLoaded.hsToken)
      };
    } catch (err) {
      verification.errors.push({
        code: "invalid_appservice_registration",
        message: String(err?.message || err)
      });
      verification.ok = false;
    }
  }
  if (!verification.ok) {
    const payload = {
      ok: false,
      stage: "verification",
      verification,
      appservice,
      config: redactMatrixConfig(cfg)
    };
    if (json) jsonOut(payload);
    else {
      textOut("verification failed:");
      for (const err of verification.errors) textOut(`- ${err.code}: ${err.message}`);
      for (const warn of verification.warnings) textOut(`- warning ${warn.code}: ${warn.message}`);
    }
    process.exit(1);
  }

  if (cfg.authMode === "password" && !cfg.token && cfg.userId && cfg.password) {
    const login = await loginMatrixWithPassword({
      homeserver: cfg.homeserver,
      userId: cfg.userId,
      password: cfg.password
    });
    cfg = { ...cfg, token: login.token, userId: login.userId || cfg.userId };
  }
  cfg = await ensureSharedSecretToken({ cfg, rootDir });

  if (!dryRun && cfg.writeAgentPolicy && cfg.userId && cfg.token) {
    const agentNameForAuth = String(cfg.agentName || DEFAULT_CHANNEL_AGENT_NAME).trim() || DEFAULT_CHANNEL_AGENT_NAME;
    const agentHouseForAuth = resolveConfiguredAgentHouseFromRoot(rootDir, agentNameForAuth);
    const cachedAuth = await readMatrixAuthCache(agentHouseForAuth);
    await writeMatrixAuthCache(agentHouseForAuth, {
      ...(cachedAuth ?? {}),
      homeserver: cfg.homeserver,
      user: cfg.userId,
      accessToken: cfg.token,
      executiveDmRooms: cachedAuth?.executiveDmRooms ?? {}
    });
  }

  const runTestNow = testNowFlag == null ? !nonInteractive : parseTruthy(testNowFlag, false);
  const startSchedulerDefault = ephemeralRoot ? false : !nonInteractive;
  const startSchedulerNow = startNowFlag == null
    ? startSchedulerDefault
    : parseTruthy(startNowFlag, startSchedulerDefault);
  let live = null;
  if (runTestNow) {
    live = await matrixPostSetupTest(cfg, { rootDir });
  }

  const plan = await createMatrixWritePlan({ rootDir, cfg });
  const worldRoot = path.join(rootDir, "world");
  let establish = null;
  if (!dryRun && cfg.agentName && String(cfg.agentName).trim()) {
    establish = await establishAgent({
      worldRoot,
      agentName: cfg.agentName,
      writePolicy: true
    });
  }
  if (!dryRun) {
    await applyWritePlan(plan);
  }
  let runtime = null;
  if (!dryRun && cfg.writeAgentPolicy && startSchedulerNow) {
    runtime = await schedulerRestart({ worldRoot });
  }

  const out = {
    ok: true,
    route: "configure channel matrix",
    rootDir,
    mode: nonInteractive ? "non-interactive" : cfg.mode || mode,
    dryRun,
    changed: Boolean(plan.changed || establish?.changed),
    writes: writePlanSummary(plan),
    establish,
    verification,
    live,
    startSchedulerNow,
    runtime,
    appservice,
    config: redactMatrixConfig(cfg)
  };

  if (json) {
    jsonOut(out);
    return;
  }

  textOut("configure channel matrix complete");
  for (const w of out.writes) {
    textOut(`- ${w.path} (${w.changed ? "changed" : "unchanged"}, ${w.action})`);
  }
  if (runTestNow) {
    textOut(`post-config test ${live?.ok ? "passed" : "failed"}`);
    for (const check of live?.checks || []) {
      textOut(`- ${check.ok ? "ok" : "fail"}: ${check.name}${check.error ? ` (${check.error})` : ""}`);
    }
  }
  if (runtime) {
    textOut(`scheduler reload ${runtime.running ? "running" : "stopped"}`);
  }
  if (print) {
    textOut("");
    textOut("planned blocks:");
    for (const w of plan.writes) {
      textOut(`## ${w.path}`);
      textOut(renderShortPreview(w.nextText));
    }
  }
}

function renderShortPreview(text) {
  const trimmed = String(text || "").trimEnd();
  const lines = trimmed.split("\n");
  if (lines.length <= 30) return trimmed;
  return `${lines.slice(0, 30).join("\n")}\n... (${lines.length - 30} more lines)`;
}

function sanitizeLogName(raw, fallback = "log") {
  const text = String(raw ?? "").trim().toLowerCase();
  const cleaned = text
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || fallback;
}

function normalizeTailCount(raw, fallback = 80) {
  const num = Number(raw);
  if (!Number.isFinite(num) || num <= 0) return fallback;
  return Math.max(1, Math.min(1000, Math.floor(num)));
}

async function readChannelLog({ worldRoot, agentName, channelType, tailCount }) {
  const newspaperDir = path.join(worldRoot, "newspaper");
  const suffix = `-channel-${sanitizeLogName(channelType)}-${sanitizeLogName(agentName)}.pya`;
  let names = [];
  try {
    names = await fs.readdir(newspaperDir);
  } catch (err) {
    if (err?.code !== "ENOENT") throw err;
    names = [];
  }
  const matches = names
    .filter((name) => name.endsWith(suffix))
    .sort((a, b) => a.localeCompare(b, "en"));
  const fileName = matches[matches.length - 1] || null;
  if (!fileName) {
    return {
      found: false,
      filePath: null,
      totalLines: 0,
      lines: []
    };
  }
  const filePath = path.join(newspaperDir, fileName);
  const text = await readText(filePath);
  const lines = text.split("\n");
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  return {
    found: true,
    filePath,
    totalLines: lines.length,
    lines: lines.slice(-tailCount)
  };
}

async function readTailFile(filePath, tailCount) {
  const text = await readText(filePath);
  if (!text) {
    return {
      found: false,
      path: filePath,
      totalLines: 0,
      lines: []
    };
  }
  const lines = text.split("\n");
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  return {
    found: true,
    path: filePath,
    totalLines: lines.length,
    lines: lines.slice(-tailCount)
  };
}

async function readSchedulerNewspaperLog({ worldRoot, tailCount }) {
  const newspaperDir = path.join(worldRoot, "newspaper");
  const suffix = "-calendar.pya";
  let names = [];
  try {
    names = await fs.readdir(newspaperDir);
  } catch (err) {
    if (err?.code !== "ENOENT") throw err;
  }
  const matches = names
    .filter((name) => name.endsWith(suffix))
    .sort((a, b) => a.localeCompare(b, "en"));
  const fileName = matches[matches.length - 1] || null;
  const filePath = fileName
    ? path.join(newspaperDir, fileName)
    : path.join(newspaperDir, `${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-calendar.pya`);
  const log = await readTailFile(filePath, tailCount);
  return {
    ...log,
    expectedPattern: path.join(worldRoot, "newspaper", "YYYYMMDD-calendar.pya")
  };
}

async function readSchedulerCalendarDebug({ worldRoot, tailCount }) {
  const schedulerNewspaper = await readSchedulerNewspaperLog({ worldRoot, tailCount });
  const schedulerDaemonLog = await readTailFile(path.join(worldRoot, "conduct", "scheduler.log"), tailCount);
  return {
    schedulerNewspaper,
    schedulerDaemonLog
  };
}

async function collectCalendarSentences(worldRoot) {
  const files = [];
  const globalPath = path.join(worldRoot, "conduct", "calendar.pya");
  files.push({ path: globalPath, scope: "world", agentName: null });

  const declared = listWorldDeclaredAgentHouses({ worldRoot });
  for (const entry of declared) {
    const agentName = String(entry?.agentName ?? "").trim();
    const housePath = String(entry?.path ?? "").trim();
    if (!agentName || !housePath) continue;
    files.push({
      path: path.join(housePath, "conduct", "calendar.pya"),
      scope: "agent",
      agentName
    });
  }

  const out = [];
  for (const file of files) {
    const text = await readText(file.path);
    if (!text) continue;
    const lines = splitSentences(text);
    for (const line of lines) {
      let sentence;
      try {
        sentence = parse(line);
      } catch {
        continue;
      }
      if (!sentence || sentence.mood !== "ya" || sentence.be !== "calendar") continue;
      const jobName = String(sentence?.su?.name ?? "").trim();
      if (!jobName) continue;
      out.push({
        sourcePath: file.path,
        scope: file.scope,
        agentName: sentence?.for?.name ?? file.agentName ?? null,
        jobName,
        sentence: sentenceToPyash(sentence)
      });
    }
  }
  return out;
}

function intervalMsToCase(intervalMs) {
  const ms = Math.max(1, Math.floor(Number(intervalMs) || 0));
  const second = 1000;
  const minute = 60 * second;
  const hour = 60 * minute;
  const day = 24 * hour;
  const week = 7 * day;
  if (ms % week === 0) return { during: { week: ms / week } };
  if (ms % day === 0) return { during: { day: ms / day } };
  if (ms % hour === 0) return { during: { hour: ms / hour } };
  if (ms % minute === 0) return { during: { minute: ms / minute } };
  if (ms % second === 0) return { during: { second: ms / second } };
  return { during: { second: Math.max(1, Math.round(ms / second)) } };
}

function renderCalendarSentenceFromJob(job) {
  const intervalCase = intervalMsToCase(job?.intervalMs);
  const withCase = job?.withCase && typeof job.withCase === "object"
    ? job.withCase
    : { wo: "tools" };
  return sentenceToPyash({
    mood: "ya",
    su: { name: String(job?.jobName ?? "").trim() },
    be: "calendar",
    for: { name: String(job?.agentName ?? "").trim() },
    vyah: { habit: true },
    ...intervalCase,
    with: withCase
  });
}

function renderServiceMap(name, items) {
  const lines = [`su name ${name} be map def`];
  for (const item of items) {
    lines.push(`  su name ${item.key} ob text ${quoteText(item.sentence)} ya`);
  }
  lines.push("prah");
  return lines.join("\n");
}

function hasCalendarHealthFailure(result) {
  if (!result || result.running !== true) return true;
  const jobs = Array.isArray(result?.status?.jobs) ? result.status.jobs : [];
  for (const job of jobs) {
    const errorCount = Number(job?.errorCount ?? 0);
    const consecutiveErrors = Number(job?.consecutiveErrors ?? 0);
    const lastError = String(job?.lastError ?? "").trim();
    if (errorCount > 0 || consecutiveErrors > 0 || lastError) return true;
  }
  return false;
}

function renderCalendarDebugLog(name, log) {
  const filePath = String(log?.path ?? "").trim() || "(unknown)";
  textOut(`- ${name} ${filePath}`);
  if (!log?.found) {
    textOut("  (not found)");
    return;
  }
  const lines = Array.isArray(log?.lines) ? log.lines : [];
  const totalLines = Number(log?.totalLines ?? 0) || 0;
  textOut(`  total lines ${totalLines}`);
  textOut(`  showing ${lines.length}`);
  for (const line of lines) {
    textOut(`  ${line}`);
  }
}

async function calendarCommand(args) {
  const sub = (args[0] ?? "health").toLowerCase();
  const rootDir = await resolveRootDirFromArgs(args);
  const worldRoot = path.join(rootDir, "world");
  const json = hasFlag(args, "--json");
  const agentFilter = parseArgValue(args, "--agent") ?? "";

  let result;
  if (sub === "health") result = await schedulerHealth({ worldRoot });
  else if (sub === "begin") result = await schedulerBegin({ worldRoot });
  else if (sub === "stop") result = await schedulerStop({ worldRoot });
  else if (sub === "restart") result = await schedulerRestart({ worldRoot });
  else if (sub === "list") result = await schedulerList({ worldRoot });
  else throw new Error(`unknown calendar command: ${sub}`);

  const payload = {
    ok: true,
    route: `calendar ${sub}`,
    worldRoot,
    result
  };
  if (sub === "list") {
    const jobsAll = await discoverScheduledJobs({ worldRoot });
    const jobs = agentFilter
      ? jobsAll.filter((job) => String(job?.agentName ?? "") === agentFilter)
      : jobsAll;
    const serviceRows = [];
    for (const job of jobs) {
      const enabled = await isServiceEnabled({ worldRoot, serviceName: job.jobName });
      const key = `${String(job.agentName || "").trim()} ${String(job.jobName || "").trim()}`.trim();
      serviceRows.push({
        key,
        agentName: job.agentName,
        jobName: job.jobName,
        active: enabled !== false,
        sentence: renderCalendarSentenceFromJob(job)
      });
    }
    const services = [...new Set(jobs.map((job) => String(job.jobName ?? "").trim()).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, "en"));
    const available = serviceRows.filter((row) => row.active);
    const stopped = serviceRows.filter((row) => !row.active);
    payload.services = services;
    payload.agent = agentFilter || null;
    payload.available = available;
    payload.stopped = stopped;
    payload.calendar = serviceRows;
  }
  if (json) {
    jsonOut(payload);
    return;
  }
  textOut(`calendar ${sub} complete`);
  textOut(`- scheduler ${result?.running ? "running" : "stopped"}`);
  if (result?.pid) textOut(`- pid ${result.pid}`);
  if (sub === "health") {
    const failure = hasCalendarHealthFailure(result);
    const debugLogs = await readSchedulerCalendarDebug({ worldRoot, tailCount: 80 });
    textOut(`- scheduler newspaper ${debugLogs.schedulerNewspaper.path}`);
    if (!debugLogs.schedulerNewspaper.found && debugLogs.schedulerNewspaper.expectedPattern) {
      textOut(`  expected pattern ${debugLogs.schedulerNewspaper.expectedPattern}`);
    }
    if (failure) {
      textOut("- calendar debug tail");
      renderCalendarDebugLog("scheduler newspaper", debugLogs.schedulerNewspaper);
      renderCalendarDebugLog("scheduler daemon log", debugLogs.schedulerDaemonLog);
    }
  }
  if (sub === "list") {
    const services = Array.isArray(payload?.services) ? payload.services : [];
    textOut(`- services ${services.length}`);
    for (const service of services) textOut(`  ${service}`);
    if (agentFilter) textOut(`- agent ${agentFilter}`);
    const available = Array.isArray(payload.available) ? payload.available : [];
    const stopped = Array.isArray(payload.stopped) ? payload.stopped : [];
    textOut(renderServiceMap("available calendar services", available));
    textOut(renderServiceMap("stopped calendar services", stopped));
  }
}

async function channelPollCommand(args) {
  const rootDir = await resolveRootDirFromArgs(args);
  const json = hasFlag(args, "--json");
  const agentName = parseArgValue(args, "--agent") ?? DEFAULT_CHANNEL_AGENT_NAME;
  const channelType = parseArgValue(args, "--channel") ?? "matrix";
  const runArgs = [
    "--agent", agentName,
    "--channel", channelType,
    "--once"
  ];
  if (String(channelType).toLowerCase() === "cli") runArgs.push("--ingest-only");
  const code = await runNodeScript(path.join(installRoot, "command", "channel_run.mjs"), runArgs, { cwd: rootDir });
  const payload = {
    ok: code === 0,
    route: "channel poll",
    rootDir,
    agentName,
    channelType,
    code
  };
  if (json) {
    jsonOut(payload);
  } else {
    textOut(`channel poll ${code === 0 ? "passed" : "failed"} (code=${code})`);
  }
  if (code !== 0) process.exit(code);
}

async function channelLogCommand(args) {
  const rootDir = await resolveRootDirFromArgs(args);
  const worldRoot = path.join(rootDir, "world");
  const json = hasFlag(args, "--json");
  const agentName = parseArgValue(args, "--agent") ?? DEFAULT_CHANNEL_AGENT_NAME;
  const channelType = parseArgValue(args, "--channel") ?? "matrix";
  const tailCount = normalizeTailCount(parseArgValue(args, "--tail"), 80);
  const log = await readChannelLog({ worldRoot, agentName, channelType, tailCount });
  const payload = {
    ok: true,
    route: "channel log",
    worldRoot,
    agentName,
    channelType,
    tailCount,
    log
  };
  if (json) {
    jsonOut(payload);
    return;
  }
  if (!log.found) {
    textOut("channel log not found");
    return;
  }
  textOut(`channel log ${log.filePath}`);
  textOut(`- total lines ${log.totalLines}`);
  textOut(`- showing ${log.lines.length}`);
  for (const line of log.lines) textOut(line);
}

async function channelBootstrapCommand(args) {
  const rootDir = await resolveRootDirFromArgs(args);
  const worldRoot = path.join(rootDir, "world");
  const json = hasFlag(args, "--json");
  const agentName = parseArgValue(args, "--agent") ?? DEFAULT_CHANNEL_AGENT_NAME;
  const channelType = (parseArgValue(args, "--channel") ?? "matrix").toLowerCase();
  const executiveUsername = String(parseArgValue(args, "--executive") ?? "").trim();
  if (channelType !== "matrix") {
    throw new Error(`unsupported channel bootstrap type: ${channelType}`);
  }
  const bootstrap = await bootstrapAgentMatrixChannelConnection({
    rootDir,
    worldRoot,
    agentName,
    executiveUsernameOverride: executiveUsername
  });
  const payload = {
    ok: bootstrap?.ok === true,
    route: "channel bootstrap",
    rootDir,
    worldRoot,
    agentName,
    channelType,
    bootstrap
  };
  if (json) {
    jsonOut(payload);
  } else if (payload.ok) {
    textOut("channel bootstrap complete");
    textOut(`- agent ${agentName}`);
    if (bootstrap?.joinedRoomId) textOut(`- room joined ${bootstrap.joinedRoomId}`);
    if (bootstrap?.executiveDm?.attempted) {
      textOut(`- executive dm room ${bootstrap.executiveDm.roomId || "resolved"}`);
    }
  } else {
    textOut("channel bootstrap failed");
    textOut(`- agent ${agentName}`);
    if (bootstrap?.reason) textOut(`- reason ${bootstrap.reason}`);
    if (bootstrap?.step && bootstrap?.error) textOut(`- ${bootstrap.step}: ${bootstrap.error}`);
  }
  if (!payload.ok) process.exit(1);
}

async function channelCliSendCommand(args) {
  const rootDir = await resolveRootDirFromArgs(args);
  const worldRoot = path.join(rootDir, "world");
  const json = hasFlag(args, "--json");
  const agentName = normalizeChannelAgentName(parseArgValue(args, "--agent") ?? DEFAULT_CHANNEL_AGENT_NAME);
  const channelId = String(parseArgValue(args, "--room") ?? "cli").trim() || "cli";
  const sender = String(parseArgValue(args, "--sender") ?? "cli").trim() || "cli";
  const text = String(parseArgValue(args, "--text") ?? "").trim();
  if (!text) {
    throw new Error("channel cli send requires --text");
  }
  const enqueue = await enqueueCliInbound({
    worldRoot,
    agentName,
    channelId,
    sender,
    text
  });
  const payload = {
    ok: true,
    route: "channel cli send",
    worldRoot,
    agentName,
    channelId,
    sender,
    eventId: enqueue.eventId,
    filePath: enqueue.filePath
  };
  if (json) {
    jsonOut(payload);
    return;
  }
  textOut("channel cli send complete");
  textOut(`- agent ${agentName}`);
  textOut(`- room ${channelId}`);
  textOut(`- sender ${sender}`);
  textOut(`- event ${enqueue.eventId}`);
}

async function channelCliReadCommand(args) {
  const rootDir = await resolveRootDirFromArgs(args);
  const worldRoot = path.join(rootDir, "world");
  const json = hasFlag(args, "--json");
  const agentName = normalizeChannelAgentName(parseArgValue(args, "--agent") ?? DEFAULT_CHANNEL_AGENT_NAME);
  const maxItems = normalizeTailCount(parseArgValue(args, "--tail"), 20);
  const rows = [];

  function parseChannelIdFromEndpoint(endpoint) {
    const text = String(endpoint ?? "").trim();
    const match = text.match(/^channel\s+\S+\s+room\s+(.+)$/i);
    if (!match) return "cli";
    return String(match[1] ?? "").trim() || "cli";
  }

  for (let i = 0; i < maxItems; i += 1) {
    const claim = await claimOldestProduceEnvelope(worldRoot, {
      workerTag: `${agentName}-cli-read`,
      channelType: "cli",
      agentName
    });
    if (!claim) break;
    try {
      const payloadSentence = claim?.envelope?.payloadSentence ?? {};
      const text = String(payloadSentence?.ob?.text ?? "").trim();
      const channelId = parseChannelIdFromEndpoint(payloadSentence?.to?.name);
      rows.push({
        channelId,
        eventId: String(claim?.envelope?.eventId ?? "").trim(),
        payloadId: String(claim?.envelope?.payloadId ?? "").trim(),
        queuedAt: String(claim?.envelope?.queuedAt ?? "").trim(),
        text
      });
      await ackRuntimeEnvelopeSuccess(worldRoot, { runtimePath: claim.path });
    } catch {
      await ackRuntimeEnvelopeFail(worldRoot, {
        runtimePath: claim.path,
        retryCount: 1,
        maxRetries: 1,
        requeuePhase: "produce"
      });
    }
  }

  const payload = {
    ok: true,
    route: "channel cli read",
    worldRoot,
    agentName,
    consumed: rows.length,
    rows
  };
  if (json) {
    jsonOut(payload);
    return;
  }
  if (!rows.length) {
    textOut("channel cli read no pending messages");
    return;
  }
  textOut(`channel cli read consumed ${rows.length}`);
  for (const row of rows) {
    const prefix = row.queuedAt ? `[${row.queuedAt}]` : "[message]";
    textOut(`${prefix} room=${row.channelId} ${row.text}`);
  }
}

async function channelCliCommand(args) {
  const sub = (args[0] ?? "read").toLowerCase();
  if (sub === "send") {
    await channelCliSendCommand(args.slice(1));
    return;
  }
  if (sub === "read") {
    await channelCliReadCommand(args.slice(1));
    return;
  }
  throw new Error(`unknown channel cli command: ${sub}`);
}

async function channelCommand(args) {
  const sub = (args[0] ?? "poll").toLowerCase();
  if (sub === "poll") {
    await channelPollCommand(args.slice(1));
    return;
  }
  if (sub === "bootstrap") {
    await channelBootstrapCommand(args.slice(1));
    return;
  }
  if (sub === "log") {
    await channelLogCommand(args.slice(1));
    return;
  }
  if (sub === "cli") {
    await channelCliCommand(args.slice(1));
    return;
  }
  throw new Error(`unknown channel command: ${sub}`);
}

async function configureMatrixTest({ args }) {
  const rootDir = await resolveRootDirFromArgs(args);
  const json = hasFlag(args, "--json");
  const agentName = parseArgValue(args, "--agent") ?? DEFAULT_CHANNEL_AGENT_NAME;
  const loaded = await loadMatrixConfigureDefaults({ rootDir, agentName });
  const resolved = await ensureSharedSecretToken({ cfg: { ...loaded, agentName }, rootDir });
  const verification = matrixVerification(resolved);
  if (!verification.ok) {
    const payload = { ok: false, stage: "verification", verification, config: redactMatrixConfig(resolved) };
    if (json) jsonOut(payload);
    else {
      textOut("matrix test failed (verification):");
      for (const err of verification.errors) textOut(`- ${err.code}: ${err.message}`);
    }
    process.exit(1);
  }

  const live = await matrixPostSetupTest(resolved, { rootDir });
  const payload = {
    ok: live.ok,
    route: "configure channel matrix test",
    checks: live.checks,
    config: redactMatrixConfig(resolved)
  };
  if (json) jsonOut(payload);
  else {
    textOut(`matrix test ${live.ok ? "passed" : "failed"}`);
    for (const check of live.checks) {
      textOut(`- ${check.ok ? "ok" : "fail"}: ${check.name}${check.error ? ` (${check.error})` : ""}`);
    }
  }
  if (!live.ok) process.exit(1);
}

async function configureMatrixDoctor({ args }) {
  const rootDir = await resolveRootDirFromArgs(args);
  const json = hasFlag(args, "--json");
  const report = await matrixDoctor({ rootDir });
  if (json) jsonOut(report);
  else {
    textOut(`matrix doctor ${report.ok ? "ok" : "needs attention"}`);
    if (report.issues?.length) {
      textOut("issues:");
      for (const issue of report.issues) {
        textOut(`- ${issue.kind} ${issue.code}: ${issue.message}`);
      }
    }
    if (report.remedies?.length) {
      textOut("remedies:");
      for (const remedy of report.remedies) textOut(`- ${remedy}`);
    }
  }
  if (!report.ok) process.exit(1);
}

function normalizePort(raw, fallback = 59652) {
  const num = Number(raw);
  if (!Number.isFinite(num)) return fallback;
  const whole = Math.floor(num);
  if (whole < 1 || whole > 65535) return fallback;
  return whole;
}

function normalizePositiveInt(raw, fallback = 1) {
  const num = Number(raw);
  if (!Number.isFinite(num) || num <= 0) return fallback;
  return Math.floor(num);
}

function collectOrchestratorFromFlags({ args, prior }) {
  return {
    mode: String(parseArgValue(args, "--mode") ?? prior.mode ?? "container").trim().toLowerCase(),
    host: String(parseArgValue(args, "--host") ?? prior.host ?? "127.0.0.1").trim(),
    port: normalizePort(parseArgValue(args, "--port") ?? prior.port ?? 59652, 59652),
    autostart: parseTruthy(parseArgValue(args, "--autostart"), parseTruthy(prior.autostart, true)),
    healthMinute: normalizePositiveInt(parseArgValue(args, "--health-rhythm-minute") ?? prior.healthMinute ?? 1, 1)
  };
}

async function collectOrchestratorInteractive({ prior }) {
  const printer = sectionPrinter();
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const ask = async (label, fallback = "") => {
      const shown = fallback ? ` [${fallback}]` : "";
      const v = (await rl.question(`${label}${shown}: `)).trim();
      return v || fallback;
    };
    const askYesNo = async (label, fallback = true) => {
      const shown = fallback ? "Y/n" : "y/N";
      const v = (await rl.question(`${label} [${shown}]: `)).trim().toLowerCase();
      if (!v) return fallback;
      return v === "y" || v === "yes";
    };

    printer.header("A.1 Orchestrator Endpoint");
    printer.why("Host and port define where host-side pyash reaches the running orchestrator.");
    printer.how("Use container mode for Docker setups. Default port 59652.");
    printer.examples("mode=container host=127.0.0.1 port=59652");
    let mode = "";
    while (!mode) {
      const picked = String(await ask("Mode (container/local)", prior.mode || "container")).trim().toLowerCase();
      if (picked !== "container" && picked !== "local") {
        textOut("- invalid: mode must be container or local");
        continue;
      }
      mode = picked;
    }
    const host = String(await ask("Host", prior.host || "127.0.0.1")).trim() || "127.0.0.1";
    const port = normalizePort(await ask("Port", String(prior.port || 59652)), 59652);

    printer.header("B.1 Service Behavior");
    printer.why("Autostart controls whether scheduler supervision starts automatically.");
    printer.how("Keep autostart on for normal operation.");
    printer.examples("autostart=yes");
    const autostart = await askYesNo("Autostart services", parseTruthy(prior.autostart, true));
    let healthMinute = normalizePositiveInt(String(prior.healthMinute || 1), 1);
    const showAdvanced = await askYesNo("Show advanced orchestrator options", false);
    if (showAdvanced) {
      printer.header("C.1 Advanced Health Update Cadence");
      printer.why("This controls how often scheduler writes health state to health.pya.");
      printer.how("Set in minutes. Lower means more frequent health updates.");
      printer.examples("1");
      healthMinute = normalizePositiveInt(await ask("Health update rhythm (minutes)", String(prior.healthMinute || 1)), 1);
    }

    return { mode, host, port, autostart, healthMinute };
  } finally {
    rl.close();
  }
}

function orchestratorVerification(cfg) {
  const errors = [];
  const mode = String(cfg.mode ?? "").trim().toLowerCase();
  if (mode !== "container" && mode !== "local") {
    errors.push({ code: "invalid_mode", message: "mode must be container or local" });
  }
  if (!String(cfg.host ?? "").trim()) {
    errors.push({ code: "missing_host", message: "host is required" });
  }
  const port = Number(cfg.port);
  if (!Number.isFinite(port) || port < 1 || port > 65535) {
    errors.push({ code: "invalid_port", message: "port must be between 1 and 65535" });
  }
  return { ok: errors.length === 0, errors, warnings: [] };
}

async function createOrchestratorWritePlan({ rootDir, cfg }) {
  const secretPath = path.join(rootDir, "configure", "secret.pya");
  const secretExisting = await readText(secretPath);
  const plan = planManagedUpsert({
    existing: secretExisting,
    blockName: ORCHESTRATOR_CONFIG_BLOCK_NAME,
    content: buildOrchestratorConfigureBlock(cfg)
  });
  return {
    writes: [{
      path: secretPath,
      changed: plan.changed,
      action: plan.action,
      preview: [ORCHESTRATOR_CONFIG_BLOCK_NAME],
      nextText: plan.nextText
    }],
    changed: plan.changed
  };
}

async function configureOrchestrator({ args }) {
  const rootDir = await resolveRootDirFromArgs(args);
  const ephemeralRoot = isEphemeralRootDir(rootDir);
  const worldRoot = path.join(rootDir, "world");
  const json = hasFlag(args, "--json");
  const print = hasFlag(args, "--print");
  const dryRun = hasFlag(args, "--dry-run");
  const nonInteractive = hasFlag(args, "--non-interactive");
  const prior = await loadOrchestratorConfigFromSecret(rootDir);
  let cfg = nonInteractive
    ? collectOrchestratorFromFlags({ args, prior })
    : await collectOrchestratorInteractive({ prior });
  if (ephemeralRoot && parseArgValue(args, "--autostart") == null) {
    cfg = { ...cfg, autostart: false };
  }

  const verification = orchestratorVerification(cfg);
  if (!verification.ok) {
    const out = { ok: false, stage: "verification", verification, config: cfg };
    if (json) jsonOut(out);
    else {
      textOut("verification failed:");
      for (const err of verification.errors) textOut(`- ${err.code}: ${err.message}`);
    }
    process.exit(1);
  }

  const plan = await createOrchestratorWritePlan({ rootDir, cfg });
  if (!dryRun) await applyWritePlan(plan);
  let runtime = null;
  if (!dryRun) {
    runtime = cfg.autostart
      ? await schedulerBegin({ worldRoot })
      : await schedulerStop({ worldRoot });
  }

  const out = {
    ok: true,
    route: "configure orchestrator",
    rootDir,
    worldRoot,
    dryRun,
    changed: plan.changed,
    writes: writePlanSummary(plan),
    verification,
    runtime,
    config: cfg
  };
  if (json) {
    jsonOut(out);
    return;
  }
  textOut("configure orchestrator complete");
  for (const w of out.writes) {
    textOut(`- ${w.path} (${w.changed ? "changed" : "unchanged"}, ${w.action})`);
  }
  if (runtime) {
    textOut(`- scheduler ${runtime.running ? "running" : "stopped"}`);
  }
  if (print) {
    textOut("");
    textOut("planned blocks:");
    for (const w of plan.writes) {
      textOut(`## ${w.path}`);
      textOut(renderShortPreview(w.nextText));
    }
  }
}

function collectMindFromFlags({ args, prior }) {
  const backendInput = parseArgValue(args, "--backend") ?? prior.source ?? prior.backend ?? "ollama";
  const source = resolveMindBackendSource(backendInput, prior.backend ?? "ollama command mind");
  const backend = canonicalizeMindBackend(backendInput ?? prior.backend ?? "ollama command mind");
  const priorSource = resolveMindBackendSource(prior.source ?? prior.backend ?? "ollama", prior.backend ?? "ollama command mind");
  const defaultHost = defaultMindHostForSource(source);
  const defaultModel = defaultMindModelForSource(source);
  const hostFallback = priorSource === source && prior.host ? prior.host : defaultHost;
  const modelFallback = priorSource === source && prior.model ? prior.model : defaultModel;
  const reasoningFallback = priorSource === source ? String(prior.reasoningEffort || "").trim() : "";
  const relayName = String(parseArgValue(args, "--relay") ?? prior.defaultRelay ?? DEFAULT_MIND_RELAY_NAME).trim();
  const setDefaultRaw = parseArgValue(args, "--set-default");
  const setDefault = setDefaultRaw == null
    ? (!prior.defaultRelay || relayName === prior.defaultRelay)
    : parseTruthy(setDefaultRaw, true);
  const codexLogin = source === "openai-codex"
    ? parseTruthy(parseArgValue(args, "--codex-login"), false)
    : false;
  const codexBin = String(parseArgValue(args, "--codex-bin") ?? "").trim();
  return {
    relayName,
    setDefault,
    source,
    backend,
    host: normalizeHomeserver(parseArgValue(args, "--host") ?? hostFallback),
    model: String(parseArgValue(args, "--model") ?? modelFallback).trim(),
    reasoningEffort: String(parseArgValue(args, "--reasoning-effort") ?? reasoningFallback).trim(),
    codexLogin,
    codexBin
  };
}

async function collectMindInteractive({ prior, rootDir }) {
  const printer = sectionPrinter();
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const ask = async (label, fallback = "") => {
      const shown = fallback ? ` [${fallback}]` : "";
      const v = (await rl.question(`${label}${shown}: `)).trim();
      return v || fallback;
    };
    const askYesNo = async (label, fallback = true) => {
      const shown = fallback ? "Y/n" : "y/N";
      const v = (await rl.question(`${label} [${shown}]: `)).trim().toLowerCase();
      if (!v) return fallback;
      return v === "y" || v === "yes";
    };

    const priorRelays = prior?.relays ?? {};
    const relayNames = Object.keys(priorRelays).sort((a, b) => a.localeCompare(b));
    printer.header("A.0 Existing Relays");
    printer.why("This shows what is already configured so you can add or adjust relays without guessing.");
    printer.how("Default relay is listed first, then each configured relay in Pyash-style sentence form.");
    printer.examples("su name local fromstate text \"ollama\" from text \"http://localhost:11434\" as text \"gpt-oss:latest\" be relay ya");
    if (relayNames.length === 0) {
      textOut("su name mind relays ob text \"none configured\" ya");
    } else {
      const defaultRelay = String(prior?.defaultRelay || relayNames[0] || DEFAULT_MIND_RELAY_NAME).trim();
      textOut(`su name default relay ob text ${quoteText(defaultRelay)} ya`);
      for (const name of relayNames) {
        const relay = priorRelays[name] ?? {};
        textOut(
          `su name ${name} fromstate text ${quoteText(displayMindBackendKey(relay.backend, relay.source || ""))} from text ${quoteText(relay.host || "")} as text ${quoteText(relay.model || "")} be relay ya`
        );
      }
    }

    printer.header("A.1 Mind Relay");
    printer.why("Channel and agent responses require a configured mind relay backend.");
    printer.how("Choose a provider by number or short name; Pyash maps it to the full backend command.");
    printer.examples("1 | ollama | openai-api | openai-codex | openrouter");
    textOut("- providers:");
    for (const line of formatNumberedRows(MIND_BACKEND_CHOICES.map((item) => `${item.key} (${item.label})`), { columns: 2 })) {
      textOut(`  ${line}`);
    }
    const backendFallback = backendChoiceKey(prior.backend || "ollama command mind");
    const backendInput = await ask("Mind backend", backendFallback);
    const selectedChoice = findMindBackendChoice(backendInput) ?? findMindBackendChoice(backendFallback);
    const source = selectedChoice?.key || resolveMindBackendSource(backendInput, prior.backend || "ollama command mind");
    const backend = resolveMindBackendSelection(backendInput, prior.backend || "ollama command mind");
    if (selectedChoice?.key === "openai-api") {
      textOut("- auth note: openai-api expects OPENAI_API_KEY in runtime environment.");
    }
    if (selectedChoice?.key === "openai-codex") {
      textOut("- auth note: openai-codex can run Codex OAuth now via codex app-server.");
    }

    printer.header("B.1 Provider Endpoint");
    printer.why("Mind backend uses this host for model calls.");
    printer.how("Use full URL; protocol defaults to https when omitted.");
    const priorSource = resolveMindBackendSource(prior.source ?? prior.backend ?? "ollama", prior.backend ?? "ollama command mind");
    const defaultHost = priorSource === source && prior.host
      ? prior.host
      : defaultMindHostForSource(source);
    const hostExample = source === "openai-api" || source === "openai-codex"
      ? "https://api.openai.com"
      : defaultHost;
    printer.examples(hostExample);
    const host = normalizeHomeserver(await ask("Mind host", defaultHost));

    const discoveredModels = [];
    const codexModelById = new Map();
    let codexBin = "";
    let discoveredDefaultModel = "";
    let codexLogin = false;
    let codexLoginDone = false;
    let codexAuth = null;
    if (looksLikeOllamaBackend(backend)) {
      printer.header("C.1 Ollama Models");
      printer.why("Listing local tags helps choose a valid default model.");
      printer.how("Pyash queries /api/tags on the configured host.");
      printer.examples("gpt-oss:latest");
      const discovered = await fetchOllamaModels(host);
      if (discovered.ok && discovered.models.length > 0) {
        textOut(`- found ${discovered.models.length} model(s):`);
        for (let i = 0; i < discovered.models.length; i += 1) {
          discoveredModels.push(discovered.models[i]);
        }
        for (const line of formatNumberedRows(discoveredModels, { columns: 2 })) {
          textOut(`  ${line}`);
        }
      } else if (discovered.ok) {
        textOut("- no models reported by host");
      } else {
        textOut(`- model listing unavailable (${discovered.error})`);
      }
    } else if (source === "openai-codex") {
      printer.header("C.0 Codex Login");
      printer.why("Codex auth enables model discovery so you can choose from available models.");
      printer.how("Run login now unless you already authenticated this runtime recently.");
      printer.examples("login truth");
      codexBin = String(await ask("Codex binary path (optional)", "")).trim();
      codexLogin = await askYesNo("Run Codex OAuth login now", true);
      if (codexLogin) {
        const codexRun = await runCodexAccountCommand({
          action: "login",
          codexBin,
          cwd: rootDir,
          json: false,
          codexAccountPath
        });
        if (codexRun.code !== 0) {
          textOut("- codex auth failed");
          const continueWithoutLogin = await askContinueWithoutCodexLogin();
          if (!continueWithoutLogin) process.exit(1);
          codexAuth = { ok: false, skipped: true, reason: "login failed and user chose continue" };
        } else {
          textOut("- codex auth passed");
          codexLoginDone = true;
          codexAuth = { ok: true, interactive: true };
        }
      } else {
        codexAuth = { ok: false, skipped: true, reason: "user skipped login" };
      }

      printer.header("C.1 Codex Models");
      printer.why("Listing Codex models lets you choose a valid model id for this relay.");
      printer.how("Pyash calls codex app-server model/list using the current Codex auth state.");
      printer.examples("gpt-5-codex");
      const discovered = await fetchCodexModels({ rootDir, codexBin });
      if (discovered.ok && discovered.models.length > 0) {
        textOut(`- found ${discovered.models.length} model(s):`);
        const labels = [];
        for (const entry of discovered.models) {
          const id = String(entry?.id ?? "").trim();
          if (!id) continue;
          codexModelById.set(id, entry);
          if (!discoveredDefaultModel && entry?.isDefault) discoveredDefaultModel = id;
          discoveredModels.push(id);
          const displayName = String(entry?.displayName ?? "").trim();
          const defaultMark = entry?.isDefault ? " default" : "";
          const label = displayName ? `${id} (${displayName}${defaultMark ? `,${defaultMark}` : ""})` : `${id}${defaultMark ? ` (${defaultMark.trim()})` : ""}`;
          labels.push(label);
        }
        for (const line of formatNumberedRows(labels, { columns: 1 })) {
          textOut(`  ${line}`);
        }
      } else if (discovered.ok) {
        textOut("- no models reported by codex app-server");
      } else {
        textOut(`- model listing unavailable (${discovered.error})`);
      }
    }

    printer.header("D.1 Default Model");
    printer.why("Used when agent/mind facts do not specify an explicit model.");
    printer.how("Choose from listed models (number) or enter a model/refinery alias.");
    printer.examples(source === "openai-codex" ? "gpt-5-codex" : "gpt-oss:latest");
    const fallbackModel = defaultMindModelForSource(source);
    const priorModel = priorSource === source ? String(prior.model || "").trim() : "";
    const defaultModel = String(priorModel || discoveredDefaultModel || discoveredModels[0] || fallbackModel).trim();
    const modelInput = await ask("Mind model (name or number)", defaultModel);
    const model = resolveModelSelection(modelInput, { fallback: defaultModel, models: discoveredModels });
    textOut(`- selected model ${model}`);
    let reasoningEffort = "";
    if (source === "openai-codex") {
      const selectedModelInfo = codexModelById.get(model) ?? null;
      const optionsRaw = Array.isArray(selectedModelInfo?.reasoningEffort)
        ? selectedModelInfo.reasoningEffort
        : [];
      const options = Array.from(new Set(optionsRaw.map((item) => String(item ?? "").trim()).filter(Boolean)));
      if (options.length > 0) {
        printer.header("D.2 Reasoning Effort");
        printer.why("Some Codex models expose reasoning levels as submodel controls.");
        printer.how("Choose one of the listed levels by number or name.");
        printer.examples(options.join(" | "));
        textOut("- reasoning levels:");
        for (const line of formatNumberedRows(options, { columns: 2 })) {
          textOut(`  ${line}`);
        }
        const defaultReasoningEffort = String(
          selectedModelInfo?.defaultReasoningEffort
          || (priorSource === source ? prior.reasoningEffort : "")
          || options[0]
        ).trim();
        const reasoningInput = await ask("Reasoning effort (name or number)", defaultReasoningEffort);
        reasoningEffort = resolveReasoningEffortSelection(reasoningInput, {
          fallback: defaultReasoningEffort,
          options
        });
        textOut(`- selected reasoning effort ${reasoningEffort}`);
      }
    }
    printer.header("E.1 Relay Name");
    printer.why("Relay names let you store multiple mind sources and select one as default.");
    printer.how("Use a short stable name; suggestion is based on selected source and model.");
    printer.examples("default | codex gpt 5 | local ollama");
    const suggestedRelayName = suggestMindRelayName({
      source,
      model,
      fallback: prior.defaultRelay || DEFAULT_MIND_RELAY_NAME
    });
    textOut(`- suggested relay name ${suggestedRelayName}`);
    const relayName = String(await ask("Relay name", suggestedRelayName)).trim();
    const setDefaultFallback = !prior.defaultRelay || relayName === prior.defaultRelay;
    const setDefault = await askYesNo("Set this relay as default", setDefaultFallback);

    return {
      relayName,
      setDefault,
      source,
      backend,
      host,
      model,
      reasoningEffort,
      codexLogin,
      codexLoginDone,
      codexAuth,
      codexBin
    };
  } finally {
    rl.close();
  }
}

function mindVerification(cfg) {
  const errors = [];
  if (!String(cfg.relayName ?? "").trim()) errors.push({ code: "missing_relay", message: "relay is required" });
  if (!String(cfg.source ?? "").trim()) errors.push({ code: "missing_source", message: "source is required" });
  if (!String(cfg.backend ?? "").trim()) errors.push({ code: "missing_backend", message: "backend is required" });
  const host = normalizeHomeserver(cfg.host);
  if (!host) errors.push({ code: "missing_host", message: "host is required" });
  if (!/^https?:\/\//i.test(host)) errors.push({ code: "invalid_host", message: "host must start with http:// or https://" });
  if (!String(cfg.model ?? "").trim()) errors.push({ code: "missing_model", message: "model is required" });
  return { ok: errors.length === 0, errors, warnings: [] };
}

async function mindLiveTest(cfg) {
  const backend = canonicalizeMindBackend(cfg.backend);
  const checks = [];
  if (looksLikeOllamaBackend(backend)) {
    const tags = await fetchOllamaModels(cfg.host);
    if (!tags.ok) {
      checks.push({ name: "host reachable", ok: false, error: tags.error });
      return { ok: false, checks };
    }
    checks.push({ name: "host reachable", ok: true });
    checks.push({ name: "models listed", ok: true, count: tags.models.length });
    const selectedModel = String(cfg.model ?? "").trim();
    const available = tags.models.includes(selectedModel);
    checks.push({ name: "model available", ok: available, model: selectedModel });
    if (!available) return { ok: false, checks };
    return { ok: true, checks };
  }
  checks.push({
    name: "provider live check",
    ok: true,
    skipped: true,
    backend,
    reason: "non-ollama backend: host/model saved; run provider-specific smoke test separately"
  });
  return { ok: true, checks };
}

function buildMindConfigureBlock(cfg) {
  return [
    "su name mind configure be map def",
    `  su name source ob text ${quoteText(cfg.source || backendChoiceKey(cfg.backend || ""))} ya`,
    `  su name backend ob text ${quoteText(cfg.backend)} ya`,
    `  su name host ob text ${quoteText(cfg.host)} ya`,
    `  su name model ob text ${quoteText(cfg.model)} ya`,
    `  su name reasoning effort ob text ${quoteText(cfg.reasoningEffort || "")} ya`,
    "prah"
  ].join("\n");
}

function buildMindRelaysBlock({ relays = {}, defaultRelay = DEFAULT_MIND_RELAY_NAME }) {
  const names = Object.keys(relays).sort((a, b) => a.localeCompare(b));
  const lines = [
    "su name mind relays be map def",
    `  su name default relay ob text ${quoteText(defaultRelay)} ya`
  ];
  for (const relayName of names) {
    const relay = relays[relayName] ?? {};
    lines.push(`  su name relay ${relayName} source ob text ${quoteText(relay.source || backendChoiceKey(relay.backend || ""))} ya`);
    lines.push(`  su name relay ${relayName} backend ob text ${quoteText(relay.backend ?? "")} ya`);
    lines.push(`  su name relay ${relayName} host ob text ${quoteText(relay.host ?? "")} ya`);
    lines.push(`  su name relay ${relayName} model ob text ${quoteText(relay.model ?? "")} ya`);
    lines.push(`  su name relay ${relayName} reasoning effort ob text ${quoteText(relay.reasoningEffort ?? "")} ya`);
  }
  lines.push("prah");
  return lines.join("\n");
}

function buildMindDefaultsBlock(cfg, { defaultRelay = DEFAULT_MIND_RELAY_NAME } = {}) {
  return [
    `exists su name mind relay default ob text ${quoteText(defaultRelay)} be default ya`,
    `exists su name mind source ob text ${quoteText(cfg.source || backendChoiceKey(cfg.backend || ""))} be default ya`,
    `exists su name mind backend be default ob name ${cfg.backend} ya`,
    `exists su name ollama host ob text ${quoteText(cfg.host)} be default ya`,
    `exists su name ai host ob text ${quoteText(cfg.host)} be default ya`,
    `exists su name mind model ob text ${quoteText(cfg.model)} be default ya`,
    `exists su name mind reasoning effort ob text ${quoteText(cfg.reasoningEffort || "")} be default ya`
  ].join("\n");
}

async function createMindWritePlan({ rootDir, cfg, prior }) {
  const secretPath = path.join(rootDir, "configure", "secret.pya");
  const secretExisting = await readText(secretPath);
  const mergedRelays = { ...(prior?.relays ?? {}) };
  mergedRelays[cfg.relayName] = {
    source: cfg.source || backendChoiceKey(cfg.backend),
    backend: cfg.backend,
    host: cfg.host,
    model: cfg.model,
    reasoningEffort: cfg.reasoningEffort || ""
  };
  let defaultRelay = cfg.setDefault
    ? cfg.relayName
    : String(prior?.defaultRelay || "").trim();
  if (!defaultRelay) defaultRelay = cfg.relayName;
  if (!mergedRelays[defaultRelay]) defaultRelay = cfg.relayName;
  const selectedCfg = mergedRelays[defaultRelay];

  const relaysPlan = planManagedUpsert({
    existing: secretExisting,
    blockName: MIND_RELAYS_BLOCK_NAME,
    content: buildMindRelaysBlock({ relays: mergedRelays, defaultRelay })
  });
  const configPlan = planManagedUpsert({
    existing: relaysPlan.nextText,
    blockName: MIND_CONFIG_BLOCK_NAME,
    content: buildMindConfigureBlock(selectedCfg)
  });
  const defaultsPlan = planManagedUpsert({
    existing: configPlan.nextText,
    blockName: MIND_DEFAULTS_BLOCK_NAME,
    content: buildMindDefaultsBlock(selectedCfg, { defaultRelay })
  });
  return {
    writes: [{
      path: secretPath,
      changed: relaysPlan.changed || configPlan.changed || defaultsPlan.changed,
      action: defaultsPlan.action,
      preview: [MIND_RELAYS_BLOCK_NAME, MIND_CONFIG_BLOCK_NAME, MIND_DEFAULTS_BLOCK_NAME],
      nextText: defaultsPlan.nextText
    }],
    changed: relaysPlan.changed || configPlan.changed || defaultsPlan.changed,
    resolvedDefaultRelay: defaultRelay,
    resolvedDefaultConfig: selectedCfg,
    relays: mergedRelays
  };
}

async function askConfigureAnotherRelay() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const value = (await rl.question("Configure another relay [y/N]: ")).trim().toLowerCase();
    return value === "y" || value === "yes";
  } finally {
    rl.close();
  }
}

async function askContinueWithoutCodexLogin() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const value = (await rl.question("Continue without completed Codex login [y/N]: ")).trim().toLowerCase();
    return value === "y" || value === "yes";
  } finally {
    rl.close();
  }
}

async function configureMind({ args }) {
  const rootDir = await resolveRootDirFromArgs(args);
  const json = hasFlag(args, "--json");
  const print = hasFlag(args, "--print");
  const dryRun = hasFlag(args, "--dry-run");
  const nonInteractive = hasFlag(args, "--non-interactive");
  const testNowFlag = parseArgValue(args, "--test-now");
  const runTestNow = testNowFlag == null ? !nonInteractive : parseTruthy(testNowFlag, false);
  let workingPrior = await loadMindConfigFromSecret(rootDir);
  const runs = [];
  let lastPlan = null;

  while (true) {
    const cfg = nonInteractive
      ? collectMindFromFlags({ args, prior: workingPrior })
      : await collectMindInteractive({ prior: workingPrior, rootDir });

    const verification = mindVerification(cfg);
    if (!verification.ok) {
      const out = { ok: false, stage: "verification", verification, config: cfg };
      if (json) jsonOut(out);
      else {
        textOut("verification failed:");
        for (const err of verification.errors) textOut(`- ${err.code}: ${err.message}`);
      }
      process.exit(1);
    }

    let live = null;
    if (runTestNow) live = await mindLiveTest(cfg);
    let codexAuth = cfg.codexAuth ?? null;
    if (cfg.source === "openai-codex" && cfg.codexLogin && !cfg.codexLoginDone) {
      const codexJsonMode = nonInteractive || json;
      const codexRun = await runCodexAccountCommand({
        action: "login",
        codexBin: cfg.codexBin,
        cwd: rootDir,
        json: codexJsonMode,
        codexAccountPath
      });
      if (codexRun.code !== 0) {
        const errorText = codexJsonMode ? (codexRun.stderr || codexRun.stdout || "codex login failed") : "codex login failed";
        if (nonInteractive) {
          const out = { ok: false, stage: "codex auth", error: errorText.trim(), config: cfg };
          if (json) jsonOut(out);
          else textOut(`codex auth failed: ${out.error}`);
          process.exit(1);
        }
        textOut(`- codex auth failed: ${errorText.trim() || "unknown error"}`);
        const continueWithoutLogin = await askContinueWithoutCodexLogin();
        if (!continueWithoutLogin) process.exit(1);
        codexAuth = { ok: false, skipped: true, reason: "login failed and user chose continue" };
      } else if (codexJsonMode) {
        try {
          codexAuth = JSON.parse(codexRun.stdout || "{}");
        } catch {
          codexAuth = { ok: true };
        }
      } else {
        codexAuth = { ok: true };
      }
    }

    const plan = await createMindWritePlan({ rootDir, cfg, prior: workingPrior });
    if (!dryRun) await applyWritePlan(plan);
    lastPlan = plan;

    const runOut = {
      ok: true,
      route: "configure mind",
      rootDir,
      dryRun,
      changed: plan.changed,
      writes: writePlanSummary(plan),
      verification,
      live,
      config: {
        relayName: cfg.relayName,
        setDefault: cfg.setDefault,
        source: cfg.source,
        backend: cfg.backend,
        host: cfg.host,
        model: cfg.model,
        reasoningEffort: cfg.reasoningEffort || "",
        codexLogin: cfg.codexLogin,
        defaultRelay: plan.resolvedDefaultRelay,
        relays: plan.relays
      },
      codexAuth
    };
    runs.push(runOut);
    workingPrior = {
      source: plan.resolvedDefaultConfig?.source ?? cfg.source,
      backend: plan.resolvedDefaultConfig?.backend ?? cfg.backend,
      host: plan.resolvedDefaultConfig?.host ?? cfg.host,
      model: plan.resolvedDefaultConfig?.model ?? cfg.model,
      reasoningEffort: plan.resolvedDefaultConfig?.reasoningEffort ?? cfg.reasoningEffort ?? "",
      defaultRelay: plan.resolvedDefaultRelay ?? cfg.relayName,
      relays: plan.relays ?? {}
    };

    if (nonInteractive) break;
    const again = await askConfigureAnotherRelay();
    if (!again) break;
  }

  const out = runs[runs.length - 1];
  if (json) {
    jsonOut(runs.length > 1 ? { ...out, runs } : out);
    return;
  }
  const relayNames = runs.map((entry) => entry?.config?.relayName).filter(Boolean);
  textOut(`configure mind complete${relayNames.length > 1 ? ` (${relayNames.length} relays)` : ""}`);
  for (const w of out.writes || []) {
    textOut(`- ${w.path} (${w.changed ? "changed" : "unchanged"}, ${w.action})`);
  }
  if (relayNames.length > 0) {
    textOut(`- relays configured ${relayNames.join(", ")}`);
  }
  textOut(`- default relay ${out?.config?.defaultRelay ?? DEFAULT_MIND_RELAY_NAME}`);
  const defaultSource = out?.config?.relays?.[out?.config?.defaultRelay]?.source
    || out?.config?.source
    || backendChoiceKey(out?.config?.backend ?? "");
  textOut(`- default source ${defaultSource}`);
  if (runTestNow) {
    textOut(`mind test ${out?.live?.ok ? "passed" : "failed"}`);
    for (const check of out?.live?.checks || []) {
      textOut(`- ${check.ok ? "ok" : "fail"}: ${check.name}${check.error ? ` (${check.error})` : ""}`);
    }
  }
  if (print) {
    textOut("");
    textOut("planned blocks:");
    for (const w of lastPlan?.writes || []) {
      textOut(`## ${w.path}`);
      textOut(renderShortPreview(w.nextText));
    }
  }
}

function normalizeIntervalMinutes(raw, fallback = 24) {
  const num = Number(raw);
  if (!Number.isFinite(num) || num <= 0) return fallback;
  return Math.floor(num);
}

function buildAgentRuntimeBlock({ backend, model, toolsMap }) {
  return [
    "su name agent runtime be map def",
    `  su name backend ob text ${quoteText(backend)} ya`,
    `  su name model ob text ${quoteText(model)} ya`,
    `  su name tools map ob text ${quoteText(toolsMap)} ya`,
    "prah"
  ].join("\n");
}

function buildAgentChannelScheduleBlock({ agentName, intervalSeconds = DEFAULT_CHANNEL_POLL_INTERVAL_SECONDS }) {
  const everySecond = Math.max(1, Math.floor(Number(intervalSeconds) || DEFAULT_CHANNEL_POLL_INTERVAL_SECONDS));
  return buildChannelPollCalendarBlock({
    agentName,
    channels: [MATRIX_CATERER_NAME],
    intervalSeconds: everySecond
  });
}

async function upsertAgentRuntime({ worldRoot, agentName, backend, model, toolsMap, dryRun = false }) {
  const agentHouse = resolveConfiguredAgentHouse(worldRoot, agentName);
  const runtimePath = path.join(agentHouse, "conduct", "runtime.pya");
  const existing = await readText(runtimePath);
  const plan = planManagedUpsert({
    existing,
    blockName: "agent runtime",
    content: buildAgentRuntimeBlock({ backend, model, toolsMap })
  });
  if (!dryRun && plan.changed) {
    await ensureDirForFile(runtimePath);
    await fs.writeFile(runtimePath, plan.nextText, "utf8");
  }
  return {
    path: runtimePath,
    changed: plan.changed,
    action: plan.action
  };
}

async function bindAgentToDefaultChannel({ rootDir, worldRoot, agentName, dryRun = false }) {
  const matrix = await loadMatrixConfigureDefaults({ rootDir, agentName });
  if (!matrix?.homeserver || !matrix?.room) {
    return {
      ok: false,
      reason: "missing channel configure",
      path: null,
      changed: false,
      action: "none"
    };
  }
  const agentHouse = resolveConfiguredAgentHouse(worldRoot, agentName);
  const channelPath = path.join(agentHouse, "conduct", "channels.pya");
  const canProvisionPerAgent = Boolean(
    String(matrix.registrationSharedSecret || "").trim()
    || String(matrix.adminToken || "").trim()
  );
  const userId = canProvisionPerAgent
    ? resolveAgentMatrixUserId({
      agentName,
      homeserver: matrix.homeserver,
      defaultUserId: matrix.userId
    })
    : String(matrix.userId || "").trim();
  const existing = await readText(channelPath);
  const plan = planManagedUpsert({
    existing,
    blockName: MATRIX_POLICY_BLOCK_NAME,
    content: buildAgentChannelConductBlock({
      userId
    })
  });
  if (!dryRun && plan.changed) {
    await ensureDirForFile(channelPath);
    await fs.writeFile(channelPath, plan.nextText, "utf8");
  }
  return {
    ok: true,
    path: channelPath,
    changed: plan.changed,
    action: plan.action,
    homeserver: matrix.homeserver,
    room: matrix.room,
    mode: normalizeMatrixMode(matrix.mode || "", DEFAULT_MATRIX_CHANNEL_MODE)
  };
}

function orderedExecutiveUsernames({ override = "", channelConfig = {} } = {}) {
  const ordered = [];
  const seen = new Set();
  const pushValue = (value) => {
    const text = String(value ?? "").trim();
    if (!text || seen.has(text)) return;
    seen.add(text);
    ordered.push(text);
  };
  pushValue(override);
  for (const value of Array.isArray(channelConfig?.executiveUsernames) ? channelConfig.executiveUsernames : []) {
    pushValue(value);
  }
  if (channelConfig?.executiveUsername) pushValue(channelConfig.executiveUsername);
  return ordered;
}

async function bootstrapAgentMatrixChannelConnection({
  rootDir,
  worldRoot,
  agentName,
  executiveUsernameOverride = ""
}) {
  const matrix = await loadMatrixConfigureDefaults({ rootDir, agentName });
  if (!matrix?.homeserver || !matrix?.room) {
    return {
      ok: false,
      skipped: true,
      reason: "missing channel configure"
    };
  }

  const mode = normalizeMatrixMode(matrix.mode || "", DEFAULT_MATRIX_CHANNEL_MODE);
  const agentHouse = resolveConfiguredAgentHouse(worldRoot, agentName);
  const canProvisionPerAgent = Boolean(
    String(matrix.registrationSharedSecret || "").trim()
    || String(matrix.adminToken || "").trim()
  );
  const userId = canProvisionPerAgent
    ? resolveAgentMatrixUserId({
      agentName,
      homeserver: matrix.homeserver,
      defaultUserId: matrix.userId
    })
    : String(matrix.userId || "").trim();
  const reuseGlobalToken = Boolean(String(matrix.token || "").trim()) && (
    !canProvisionPerAgent
    || !String(matrix.userId || "").trim()
    || matrixUsersMatch(userId, matrix.userId, matrix.homeserver)
  );
  let credentials;
  try {
    credentials = await ensureMatrixCredentials({
      agentName,
      agentHouse,
      config: {
        homeserver: matrix.homeserver,
        user: userId || null,
        token: reuseGlobalToken ? (matrix.token || null) : null,
        mode,
        registrationSharedSecret: matrix.registrationSharedSecret || null,
        adminToken: matrix.adminToken || null
      }
    });
  } catch (err) {
    return {
      ok: false,
      skipped: false,
      step: "credentials",
      error: String(err?.message || err)
    };
  }

  const token = String(credentials?.token || (reuseGlobalToken ? matrix.token : "") || "").trim();
  const resolvedUserId = String(credentials?.user || userId || matrix.userId || "").trim();
  if (!token) {
    return {
      ok: false,
      skipped: true,
      reason: "missing token"
    };
  }

  let joinedRoomId = "";
  try {
    joinedRoomId = await matrixJoinRoom({
      homeserver: matrix.homeserver,
      token,
      room: matrix.room,
      mode,
      userId: resolvedUserId
    });
  } catch (err) {
    const joinMessage = String(err?.message || err);
    const inviterToken = String(matrix.token || "").trim();
    const inviterUserId = String(matrix.userId || "").trim();
    const canInviteFallback = /M_FORBIDDEN/i.test(joinMessage)
      && Boolean(inviterToken && inviterUserId)
      && !matrixUsersMatch(inviterUserId, resolvedUserId, matrix.homeserver);
    if (canInviteFallback) {
      try {
        const inviterRoomId = await matrixJoinRoom({
          homeserver: matrix.homeserver,
          token: inviterToken,
          room: matrix.room,
          mode,
          userId: inviterUserId
        });
        await matrixInviteRoomMember({
          homeserver: matrix.homeserver,
          token: inviterToken,
          roomId: inviterRoomId,
          inviteUserId: resolvedUserId,
          mode,
          userId: inviterUserId
        });
        joinedRoomId = await matrixJoinRoom({
          homeserver: matrix.homeserver,
          token,
          room: inviterRoomId,
          mode,
          userId: resolvedUserId
        });
      } catch (inviteErr) {
        return {
          ok: false,
          skipped: false,
          step: "join room",
          userId: resolvedUserId,
          error: `${joinMessage}; invite fallback failed: ${String(inviteErr?.message || inviteErr)}`
        };
      }
    } else {
    return {
      ok: false,
      skipped: false,
      step: "join room",
      userId: resolvedUserId,
      error: joinMessage
    };
    }
  }

  const allChannels = await loadChannelPolicyWithGlobal({ worldRoot, agentHouse });
  const executiveUsernames = orderedExecutiveUsernames({
    override: executiveUsernameOverride,
    channelConfig: allChannels?.matrix ?? {}
  });
  if (!executiveUsernames.length) {
    return {
      ok: true,
      mode,
      homeserver: matrix.homeserver,
      room: matrix.room,
      joinedRoomId,
      userId: resolvedUserId,
      executiveDm: {
        attempted: false
      }
    };
  }

  const dmRooms = [];
  let lastError = null;
  for (const executiveUsername of executiveUsernames) {
    try {
      const dmRoomId = await ensureMatrixExecutiveDmRoom({
        agentHouse,
        homeserver: matrix.homeserver,
        token,
        user: resolvedUserId,
        mode,
        executiveUser: executiveUsername
      });
      if (dmRoomId) dmRooms.push(dmRoomId);
    } catch (err) {
      lastError = {
        executiveUsername,
        error: String(err?.message || err)
      };
    }
  }
  if (!dmRooms.length && lastError) {
    return {
      ok: false,
      skipped: false,
      step: "executive dm",
      userId: resolvedUserId,
      joinedRoomId,
      error: `${lastError.executiveUsername}: ${lastError.error}`
    };
  }
  return {
    ok: true,
    mode,
    homeserver: matrix.homeserver,
    room: matrix.room,
    joinedRoomId,
    userId: resolvedUserId,
    executiveDm: {
      attempted: true,
      executiveUsernames,
      roomIds: dmRooms,
      roomId: dmRooms[0] || ""
    }
  };
}

function buildAgentDirectoryLicenseBlock({ rootDir, worldRoot, agentName }) {
  const declaredHouse = path.join("world", "house", agentName);
  const lines = [
    `su name ${agentName} house directory ob filename ${quoteText(declaredHouse)} ya`,
    `su name ${agentName} directory license be map def`,
    `  su name ${quoteText(declaredHouse)} ob ve text "read" "write" "command" ya`
  ];
  if (String(agentName).trim() === "parity coder") {
    lines.push(`  su name ${quoteText(path.resolve(rootDir))} ob ve text "read" "write" "command" ya`);
  }
  lines.push("prah");
  return lines.join("\n");
}

async function upsertAgentDirectoryLicense({ rootDir, worldRoot, agentName, dryRun = false }) {
  const policyPath = path.join(worldRoot, "conduct", "agent.pya");
  const existing = await readText(policyPath);
  const plan = planManagedUpsert({
    existing,
    blockName: `agent directory license ${agentName}`,
    content: buildAgentDirectoryLicenseBlock({ rootDir, worldRoot, agentName })
  });
  if (!dryRun && plan.changed) {
    await ensureDirForFile(policyPath);
    await fs.writeFile(policyPath, plan.nextText, "utf8");
  }
  return {
    ok: true,
    path: policyPath,
    changed: plan.changed,
    action: plan.action
  };
}

async function upsertAgentChannelSchedule({
  worldRoot,
  agentName,
  channelType = "matrix",
  intervalMinutes = 1,
  intervalSeconds = DEFAULT_CHANNEL_POLL_INTERVAL_SECONDS,
  dryRun = false
}) {
  if (String(channelType || "").trim().toLowerCase() !== "matrix") {
    return {
      ok: false,
      reason: "unsupported channel type",
      path: null,
      changed: false,
      action: "none"
    };
  }
  const agentHouse = resolveConfiguredAgentHouse(worldRoot, agentName);
  const calendarPath = path.join(agentHouse, "conduct", "calendar.pya");
  const existing = await readText(calendarPath);
  const calendarWithoutLegacyPoll = stripAgentChannelScheduleText({
    existing,
    agentName,
    scheduleName: "poll",
    includeManagedBlockLines: false
  });
  const plan = planManagedUpsert({
    existing: calendarWithoutLegacyPoll,
    blockName: "agent channel schedule",
    content: buildAgentChannelScheduleBlock({
      agentName,
      intervalSeconds: Number.isFinite(Number(intervalSeconds)) && Number(intervalSeconds) > 0
        ? Number(intervalSeconds)
        : Math.max(1, normalizeIntervalMinutes(intervalMinutes, 1) * 60)
    })
  });
  const changed = plan.changed || (calendarWithoutLegacyPoll !== existing);
  if (!dryRun && changed) {
    await ensureDirForFile(calendarPath);
    await fs.writeFile(calendarPath, plan.nextText, "utf8");
  }
  return {
    ok: true,
    path: calendarPath,
    changed,
    action: plan.action
  };
}

function parseManagedTextField(text, fieldName) {
  const pattern = new RegExp(`su name ${escapeRegex(fieldName)}\\s+ob text\\s+("(?:[^"\\\\]|\\\\.)*")`, "m");
  const match = String(text || "").match(pattern);
  if (!match) return "";
  return unquotePyashText(match[1]);
}

function parseManagedNumField(text, fieldName) {
  const pattern = new RegExp(`su name ${escapeRegex(fieldName)}\\s+ob num\\s+([0-9]+(?:\\.[0-9]+)?)`, "m");
  const match = String(text || "").match(pattern);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

async function loadAgentDefaults({ worldRoot, agentName }) {
  const normalizedAgentName = String(agentName || "").trim();
  const houseRoot = resolveConfiguredAgentHouse(worldRoot, normalizedAgentName);
  let exists = true;
  try {
    const stat = await fs.stat(houseRoot);
    exists = stat.isDirectory();
  } catch {
    exists = false;
  }

  const runtimePath = path.join(houseRoot, "conduct", "runtime.pya");
  const managedPath = path.join(houseRoot, "conduct", "managed.pya");
  const channelPath = path.join(houseRoot, "conduct", "channels.pya");
  const runtimeText = await readText(runtimePath);
  const runtimeBlock = extractManagedBlock(runtimeText, "agent runtime");
  const runtimeValues = parseMapBlock(runtimeBlock);
  const managedText = await readText(managedPath);
  const channelText = await readText(channelPath);
  const channelMarkers = blockMarkers(MATRIX_POLICY_BLOCK_NAME);
  const bindChannel = channelText.includes(channelMarkers.start);

  return {
    exists,
    agentName: normalizedAgentName,
    purpose: parseManagedTextField(managedText, "managed purpose") || "",
    intervalMinutes: normalizeIntervalMinutes(parseManagedNumField(managedText, "managed interval minutes"), 24),
    backend: canonicalizeMindBackend(runtimeValues.backend || ""),
    model: String(runtimeValues.model || "").trim(),
    toolsMap: String(runtimeValues["tools map"] || "").trim() || "tools",
    bindChannel
  };
}

async function listConfiguredAgents({ worldRoot }) {
  const names = await listAgents({ worldRoot });
  const configuredNames = [];
  for (const agentName of names) {
    const conductDir = path.join(resolveConfiguredAgentHouse(worldRoot, agentName), "conduct");
    const markerPaths = [
      path.join(conductDir, "managed.pya"),
      path.join(conductDir, "runtime.pya"),
      path.join(conductDir, "channels.pya")
    ];
    let configured = false;
    for (const markerPath of markerPaths) {
      if (await pathExists(markerPath)) {
        configured = true;
        break;
      }
    }
    if (configured) configuredNames.push(agentName);
  }
  const items = await Promise.all(configuredNames.map(async (agentName) => await loadAgentDefaults({ worldRoot, agentName })));
  return items.sort((a, b) => a.agentName.localeCompare(b.agentName, "en"));
}

async function promptExistingAgent({ worldRoot, title = "Agent", actionLabel = "use" }) {
  const items = await listConfiguredAgents({ worldRoot });
  if (items.length === 0) return "";
  textOut(`[${title}]`);
  textOut(`Choose agent to ${actionLabel}:`);
  for (const line of formatNumberedRows(items.map((item) => item.agentName), { columns: 1 })) {
    textOut(`  ${line}`);
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const fallback = items[0].agentName;
    while (true) {
      const input = String(await rl.question(`Agent (name or number) [${fallback}]: `)).trim();
      const selected = resolveModelSelection(input, {
        fallback,
        models: items.map((item) => item.agentName)
      });
      if (items.some((item) => item.agentName === selected)) return selected;
      textOut("- unknown agent; choose from the listed names or numbers.");
    }
  } finally {
    rl.close();
  }
}

function collectAgentFromFlags({ args, mindDefaults = {}, agentDefaults = {} }) {
  let defaultBackend = canonicalizeMindBackend(agentDefaults.backend || mindDefaults.backend || "ollama command mind");
  let defaultModel = String(agentDefaults.model || mindDefaults.model || "gpt-oss:latest").trim();
  const relays = mindDefaults?.relays ?? {};
  const relayNames = Object.keys(relays).sort((a, b) => a.localeCompare(b, "en"));
  const relayInputRaw = parseArgValue(args, "--relay");
  const relayInput = String(relayInputRaw ?? "").trim();
  const relayFallback = relayNames.includes(String(mindDefaults?.defaultRelay || "").trim())
    ? String(mindDefaults.defaultRelay).trim()
    : (relayNames[0] || "");
  let relayName = "";
  if (relayInput) {
    const selectedRelayName = resolveModelSelection(relayInput, {
      fallback: relayFallback,
      models: relayNames
    });
    const selectedRelay = relays[selectedRelayName];
    if (!selectedRelay) {
      throw new Error(`unknown relay: ${relayInput}`);
    }
    relayName = selectedRelayName;
    defaultBackend = canonicalizeMindBackend(selectedRelay.backend || defaultBackend);
    defaultModel = String(selectedRelay.model || defaultModel).trim();
  }
  const agentName = String(parseArgValue(args, "--agent") ?? agentDefaults.agentName ?? DEFAULT_CHANNEL_AGENT_NAME).trim();
  const purpose = String(parseArgValue(args, "--purpose") ?? agentDefaults.purpose ?? "Assist with scheduled automation tasks.").trim();
  const intervalMinutes = normalizeIntervalMinutes(parseArgValue(args, "--interval-minutes") ?? agentDefaults.intervalMinutes ?? 24, 24);
  const backend = canonicalizeMindBackend(parseArgValue(args, "--backend") ?? defaultBackend);
  const model = String(parseArgValue(args, "--model") ?? defaultModel).trim();
  const toolsMap = String(parseArgValue(args, "--tools-map") ?? agentDefaults.toolsMap ?? "tools").trim();
  const bindChannel = parseTruthy(parseArgValue(args, "--bind-channel"), agentDefaults.bindChannel ?? true);
  const smokeTest = parseTruthy(parseArgValue(args, "--smoke-test"), true);
  const startNow = parseTruthy(parseArgValue(args, "--start-now"), true);
  return {
    agentName,
    relayName,
    purpose,
    intervalMinutes,
    backend,
    model,
    toolsMap,
    bindChannel,
    smokeTest,
    startNow
  };
}

async function collectAgentInteractive({ rootDir, mindDefaults = {}, agentDefaults = {}, mode = "establish" }) {
  let defaultBackend = canonicalizeMindBackend(agentDefaults.backend || mindDefaults.backend || "ollama command mind");
  let defaultModel = String(agentDefaults.model || mindDefaults.model || "gpt-oss:latest").trim();
  const defaultAgentName = String(agentDefaults.agentName || DEFAULT_CHANNEL_AGENT_NAME).trim();
  const defaultPurpose = String(agentDefaults.purpose || "Assist with scheduled automation tasks.").trim();
  const defaultToolsMap = String(agentDefaults.toolsMap || "tools").trim();
  const defaultInterval = normalizeIntervalMinutes(agentDefaults.intervalMinutes ?? 24, 24);
  const defaultBindChannel = agentDefaults.bindChannel ?? true;
  const relays = mindDefaults?.relays ?? {};
  const relayNames = Object.keys(relays).sort((a, b) => a.localeCompare(b, "en"));
  const relayFallback = relayNames.includes(String(mindDefaults?.defaultRelay || "").trim())
    ? String(mindDefaults.defaultRelay).trim()
    : (relayNames[0] || "");
  let relayName = "";

  const printer = sectionPrinter();
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const ask = async (label, fallback = "") => {
      const shown = fallback ? ` [${fallback}]` : "";
      const v = (await rl.question(`${label}${shown}: `)).trim();
      return v || fallback;
    };
    const askYesNo = async (label, fallback = true) => {
      const shown = fallback ? "Y/n" : "y/N";
      const v = (await rl.question(`${label} [${shown}]: `)).trim().toLowerCase();
      if (!v) return fallback;
      return v === "y" || v === "yes";
    };

    printer.header("A.1 Agent Identity");
    printer.why("Agent name and purpose define house identity and managed state.");
    printer.how(mode === "improve"
      ? "Keep the current name and adjust purpose/runtime as needed."
      : "Choose a stable name and concise purpose sentence.");
    printer.examples(`${DEFAULT_CHANNEL_AGENT_NAME} | Respond on configured channels and scheduled jobs`);
    const agentName = await ask("Agent name", defaultAgentName);
    const purpose = await ask("Agent purpose", defaultPurpose);

    printer.header("B.1 Runtime Backend");
    printer.why("Backend/model determine response behavior for upcoming channel and schedule runs.");
    printer.how("Choose a provider first, then choose model from defaults or matching relay models.");
    printer.examples("1 | ollama | openai-codex");
    for (const line of formatNumberedRows(MIND_BACKEND_CHOICES.map((item) => `${item.key} (${item.label})`), { columns: 2 })) {
      textOut(`  ${line}`);
    }
    const backendFallback = backendChoiceKey(defaultBackend || "ollama command mind");
    const backendInput = await ask("Backend (name or number)", backendFallback);
    const selectedBackendChoice = findMindBackendChoice(backendInput) ?? findMindBackendChoice(backendFallback);
    const sourceKey = selectedBackendChoice?.key || resolveMindBackendSource(backendInput, defaultBackend || "ollama command mind");
    const backend = resolveMindBackendSelection(backendInput, defaultBackend || "ollama command mind");
    textOut(`- backend set to ${sourceKey}`);

    const backendRelayNames = relayNames.filter((name) => relayMatchesBackendSource(relays[name], sourceKey, backend));
    const backendRelayModels = Array.from(new Set(
      backendRelayNames
        .map((name) => String(relays[name]?.model || "").trim())
        .filter(Boolean)
    ));

    printer.header("B.2 Runtime Model");
    printer.why("Model controls output quality/cost and should match selected provider backend.");
    printer.how("Choose from listed relay models when available, or enter a model/refinery alias.");
    printer.examples("gpt-5.3-codex | qwen3-vl:8b-instruct");
    if (backendRelayModels.length > 0) {
      textOut(`- found ${backendRelayModels.length} model(s) from matching relay(s):`);
      for (const line of formatNumberedRows(backendRelayModels, { columns: 2 })) {
        textOut(`  ${line}`);
      }
    } else {
      textOut("- no matching relay models found for this backend; using current default model.");
    }
    const defaultModelForBackend =
      (canonicalizeMindBackend(agentDefaults.backend || "") === canonicalizeMindBackend(backend) && String(agentDefaults.model || "").trim())
      || (backendRelayModels[0] || "")
      || defaultModel;
    const modelInput = await ask("Model (name or number)", defaultModelForBackend);
    const model = resolveModelSelection(modelInput, { fallback: defaultModelForBackend, models: backendRelayModels });
    const matchedRelayName = backendRelayNames.find((name) => String(relays[name]?.model || "").trim() === String(model).trim()) || "";
    relayName = matchedRelayName || relayName;
    if (relayName) textOut(`- relay matched ${relayName}`);

    const toolsMap = await ask("Tools map", defaultToolsMap);

    printer.header("C.1 Channel Binding");
    printer.why("Most agents should inherit default channel routing.");
    printer.how("Enable to write channel conduct file from current channel configure.");
    printer.examples("yes");
    const bindChannel = await askYesNo("Bind default channel to this agent", defaultBindChannel);
    if (bindChannel) {
      const matrix = await loadMatrixConfigureDefaults({ rootDir, agentName });
      if (!matrix?.homeserver || !matrix?.room) {
        textOut("- warning: default channel configure missing; binding will be skipped unless channel is configured.");
      } else {
        textOut(`- channel source ${matrix.homeserver} ${matrix.room}`);
      }
    }

    printer.header("D.1 Schedule");
    printer.why("Schedule ensures the agent runs regularly.");
    printer.how("Set heartbeat interval in minutes.");
    printer.examples("24");
    const intervalRaw = await ask("Interval minutes", String(defaultInterval));
    const intervalMinutes = normalizeIntervalMinutes(intervalRaw, defaultInterval);

    printer.header("E.1 Smoke Test");
    printer.why("Quick begin/stop verifies the agent can be controlled.");
    printer.how("Enable for first setup; disable if you only want file writes.");
    printer.examples("yes");
    const smokeTest = await askYesNo("Run begin/stop smoke test", true);

    printer.header("F.1 Activation");
    printer.why("Activation enables agent services now so it can respond without extra commands.");
    printer.how("Keep enabled for normal use. Disable only when staging config without running.");
    printer.examples("yes");
    const startNow = await askYesNo("Start agent services now", true);

    return {
      agentName,
      relayName,
      purpose,
      intervalMinutes,
      backend,
      model,
      toolsMap,
      bindChannel,
      smokeTest,
      startNow
    };
  } finally {
    rl.close();
  }
}

async function configureAgentList({ args }) {
  const rootDir = await resolveRootDirFromArgs(args);
  const worldRoot = path.join(rootDir, "world");
  const json = hasFlag(args, "--json");
  const agents = await listConfiguredAgents({ worldRoot });
  const out = {
    ok: true,
    route: "configure agent list",
    rootDir,
    worldRoot,
    count: agents.length,
    agents
  };
  if (json) {
    jsonOut(out);
    return;
  }
  textOut("configure agent list complete");
  if (agents.length === 0) {
    textOut("- no agents configured");
    return;
  }
  textOut(`- agents ${agents.length}`);
  for (const item of agents) {
    textOut(`  su name ${item.agentName} fromstate text ${quoteText(displayMindBackendKey(item.backend))} as text ${quoteText(item.model)} be relay ya`);
  }
}

async function configureAgentDelete({ args }) {
  const rootDir = await resolveRootDirFromArgs(args);
  const worldRoot = path.join(rootDir, "world");
  const json = hasFlag(args, "--json");
  const nonInteractive = hasFlag(args, "--non-interactive");
  let agentName = String(parseArgValue(args, "--agent") || "").trim();
  if (!agentName && !nonInteractive) {
    agentName = await promptExistingAgent({
      worldRoot,
      title: "A.1 Agent Delete",
      actionLabel: "delete"
    });
    if (!agentName) {
      if (json) {
        jsonOut({ ok: true, route: "configure agent delete", rootDir, worldRoot, changed: false, skipped: "no agents configured" });
      } else {
        textOut("configure agent delete complete");
        textOut("- no agents configured");
      }
      return;
    }
  }
  if (!agentName) {
    throw new Error("configure agent delete requires --agent");
  }
  if (agentName === "base") {
    throw new Error("configure agent delete cannot remove base");
  }

  let confirmed = parseTruthy(parseArgValue(args, "--yes"), false);
  if (!nonInteractive) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    try {
      const raw = String(await rl.question(`Delete agent ${agentName} [y/N]: `)).trim().toLowerCase();
      confirmed = raw === "y" || raw === "yes";
    } finally {
      rl.close();
    }
  }

  const housePath = resolveConfiguredAgentHouse(worldRoot, agentName);
  let existed = true;
  try {
    const stat = await fs.stat(housePath);
    existed = stat.isDirectory();
  } catch {
    existed = false;
  }
  if (!confirmed || !existed) {
    const out = {
      ok: true,
      route: "configure agent delete",
      rootDir,
      worldRoot,
      changed: false,
      agentName,
      existed,
      confirmed
    };
    if (json) {
      jsonOut(out);
      return;
    }
    textOut("configure agent delete complete");
    if (!confirmed) textOut("- no changes made");
    if (!existed) textOut(`- agent ${agentName} not found`);
    return;
  }

  const stopResult = await stopAgent({ worldRoot, agentName }).catch(() => ({ disabledServices: [] }));
  await fs.rm(housePath, { recursive: true, force: true });
  const out = {
    ok: true,
    route: "configure agent delete",
    rootDir,
    worldRoot,
    changed: true,
    agentName,
    removedPath: housePath,
    disabledServices: stopResult.disabledServices ?? []
  };
  if (json) {
    jsonOut(out);
    return;
  }
  textOut("configure agent delete complete");
  textOut(`- agent ${agentName}`);
  textOut("- removed house");
}

async function configureAgentApply({ args, mode = "establish" }) {
  const rootDir = await resolveRootDirFromArgs(args);
  const ephemeralRoot = isEphemeralRootDir(rootDir);
  const worldRoot = path.join(rootDir, "world");
  const json = hasFlag(args, "--json");
  const print = hasFlag(args, "--print");
  const dryRun = hasFlag(args, "--dry-run");
  const nonInteractive = hasFlag(args, "--non-interactive");
  const mindDefaults = await loadMindConfigFromSecret(rootDir);

  let agentDefaults = {};
  if (mode === "improve") {
    let targetAgent = String(parseArgValue(args, "--agent") || "").trim();
    if (!targetAgent && !nonInteractive) {
      targetAgent = await promptExistingAgent({
        worldRoot,
        title: "A.0 Existing Agents",
        actionLabel: "improve"
      });
      if (!targetAgent) {
        throw new Error("no agents configured to improve");
      }
    }
    if (!targetAgent) {
      throw new Error("configure agent improve requires --agent");
    }
    agentDefaults = await loadAgentDefaults({ worldRoot, agentName: targetAgent });
    if (!agentDefaults.exists) {
      throw new Error(`agent not found: ${targetAgent}`);
    }
  }

  let cfg = nonInteractive
    ? collectAgentFromFlags({ args, mindDefaults, agentDefaults })
    : await collectAgentInteractive({ rootDir, mindDefaults, agentDefaults, mode });
  if (ephemeralRoot && parseArgValue(args, "--start-now") == null) {
    cfg = { ...cfg, startNow: false };
  }

  if (!cfg.agentName) {
    throw new Error("configure agent requires --agent");
  }
  if (!cfg.backend || !cfg.model) {
    throw new Error("configure agent requires backend and model");
  }

  let establishResult = {
    action: "establish",
    status: "dry-run",
    changed: false,
    changes: [],
    agentName: cfg.agentName
  };
  if (!dryRun) {
    establishResult = await establishAgent({
      worldRoot,
      agentName: cfg.agentName,
      purpose: cfg.purpose,
      intervalMinutes: cfg.intervalMinutes,
      writePolicy: false
    });
  }

  const runtimeWrite = await upsertAgentRuntime({
    worldRoot,
    agentName: cfg.agentName,
    backend: cfg.backend,
    model: cfg.model,
    toolsMap: cfg.toolsMap,
    dryRun
  });
  const directoryLicenseWrite = await upsertAgentDirectoryLicense({
    rootDir,
    worldRoot,
    agentName: cfg.agentName,
    dryRun
  });

  const channelWrite = cfg.bindChannel
    ? await bindAgentToDefaultChannel({
      rootDir,
      worldRoot,
      agentName: cfg.agentName,
      dryRun
    })
    : { ok: false, reason: "channel binding disabled", path: null, changed: false, action: "none" };

  const channelScheduleWrite = (cfg.bindChannel && channelWrite.ok)
    ? (channelWrite.mode === "appservice-push"
      ? {
        ok: false,
        reason: "channel schedule skipped (appservice-push uses global channel input)",
        path: null,
        changed: false,
        action: "none"
      }
      : await upsertAgentChannelSchedule({
        worldRoot,
        agentName: cfg.agentName,
        channelType: "matrix",
        intervalMinutes: 1,
        dryRun
      }))
    : { ok: false, reason: "channel schedule skipped", path: null, changed: false, action: "none" };

  const channelBootstrap = (!dryRun && cfg.bindChannel && channelWrite.ok && cfg.startNow)
    ? await bootstrapAgentMatrixChannelConnection({
      rootDir,
      worldRoot,
      agentName: cfg.agentName
    })
    : {
      ok: false,
      skipped: true,
      reason: (!cfg.bindChannel || !channelWrite.ok)
        ? "channel bootstrap skipped"
        : (cfg.startNow ? "channel bootstrap skipped" : "start skipped")
    };

  let smoke = null;
  let activation = null;
  if (cfg.smokeTest && !dryRun) {
    const beginRes = await beginAgent({ worldRoot, agentName: cfg.agentName, startScheduler: false });
    const stopRes = await stopAgent({ worldRoot, agentName: cfg.agentName });
    smoke = {
      ok: true,
      begin: beginRes.enabledServices ?? [],
      stop: stopRes.disabledServices ?? []
    };
  }
  if (!dryRun && cfg.startNow) {
    const beginRes = await beginAgent({ worldRoot, agentName: cfg.agentName, startScheduler: true });
    activation = {
      ok: true,
      enabled: beginRes.enabledServices ?? []
    };
  } else if (!dryRun) {
    activation = {
      ok: true,
      enabled: [],
      note: "start skipped"
    };
  }

  const changed = Boolean(
    establishResult.changed
    || runtimeWrite.changed
    || directoryLicenseWrite.changed
    || channelWrite.changed
    || channelScheduleWrite.changed
  );
  const out = {
    ok: true,
    route: "configure agent",
    action: mode,
    rootDir,
    worldRoot,
    dryRun,
    changed,
    config: {
      agentName: cfg.agentName,
      relayName: cfg.relayName || "",
      intervalMinutes: cfg.intervalMinutes,
      backend: cfg.backend,
      model: cfg.model,
      toolsMap: cfg.toolsMap,
      bindChannel: cfg.bindChannel,
      smokeTest: cfg.smokeTest,
      startNow: cfg.startNow
    },
    establish: {
      status: establishResult.status,
      changed: establishResult.changed,
      changes: establishResult.changes
    },
    runtimeWrite,
    directoryLicenseWrite,
    channelWrite,
    channelScheduleWrite,
    channelBootstrap,
    smoke,
    activation
  };

  if (json) {
    jsonOut(out);
    return;
  }

  textOut(`configure agent ${mode} complete`);
  textOut(`- agent ${cfg.agentName}`);
  textOut(`- establish ${establishResult.status}`);
  textOut(`- runtime ${runtimeWrite.path} (${runtimeWrite.changed ? "changed" : "unchanged"})`);
  textOut(`- directory license ${directoryLicenseWrite.path} (${directoryLicenseWrite.changed ? "changed" : "unchanged"})`);
  if (cfg.bindChannel) {
    if (channelWrite.ok) {
      textOut(`- channel ${channelWrite.path} (${channelWrite.changed ? "changed" : "unchanged"})`);
      if (channelScheduleWrite.ok) {
        textOut(`- channel schedule ${channelScheduleWrite.path} (${channelScheduleWrite.changed ? "changed" : "unchanged"})`);
      } else if (channelScheduleWrite.reason) {
        textOut(`- channel schedule ${channelScheduleWrite.reason}`);
      }
      if (!channelBootstrap.skipped) {
        textOut(`- channel bootstrap ${channelBootstrap.ok ? "ok" : "failed"}`);
        if (!channelBootstrap.ok && channelBootstrap.error) {
          textOut(`  ${channelBootstrap.step || "error"}: ${channelBootstrap.error}`);
        }
      } else if (cfg.startNow) {
        textOut(`- channel bootstrap skipped (${channelBootstrap.reason})`);
      }
    } else {
      textOut(`- channel skipped (${channelWrite.reason})`);
    }
  }
  if (smoke) {
    textOut(`- smoke test passed (begin=${smoke.begin.length} stop=${smoke.stop.length})`);
  }
  if (activation?.ok) {
    textOut(`- start now enabled services ${activation.enabled.length}`);
  }
  if (print) {
    const runtimePath = path.join(resolveConfiguredAgentHouse(worldRoot, cfg.agentName), "conduct", "runtime.pya");
    const runtimeText = await readText(runtimePath);
    if (runtimeText) {
      textOut("");
      textOut(`## ${runtimePath}`);
      textOut(renderShortPreview(runtimeText));
    }
  }
}

async function configureAgent({ args }) {
  const sub = String(args[0] || "");
  const hasSub = sub && !sub.startsWith("--");
  if (hasSub) {
    if (sub === "list") {
      await configureAgentList({ args: args.slice(1) });
      return;
    }
    if (sub === "establish") {
      await configureAgentApply({ args: args.slice(1), mode: "establish" });
      return;
    }
    if (sub === "improve") {
      await configureAgentApply({ args: args.slice(1), mode: "improve" });
      return;
    }
    if (sub === "delete") {
      await configureAgentDelete({ args: args.slice(1) });
      return;
    }
    throw new Error(`unknown configure agent action: ${sub}`);
  }

  if (hasFlag(args, "--non-interactive")) {
    await configureAgentApply({ args, mode: "establish" });
    return;
  }

  while (true) {
    let rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    try {
      textOut("Pyash Configure Agent");
      textOut("1. list");
      textOut("2. establish");
      textOut("3. improve");
      textOut("4. delete");
      textOut("5. exit");
      const choice = (await rl.question("Choose option [1]: ")).trim() || "1";
      if (choice === "1") {
        rl.close();
        rl = null;
        await configureAgentList({ args: [] });
        continue;
      }
      if (choice === "2") {
        rl.close();
        rl = null;
        await configureAgentApply({ args: [], mode: "establish" });
        continue;
      }
      if (choice === "3") {
        rl.close();
        rl = null;
        await configureAgentApply({ args: [], mode: "improve" });
        continue;
      }
      if (choice === "4") {
        rl.close();
        rl = null;
        await configureAgentDelete({ args: [] });
        continue;
      }
      textOut("No changes made.");
      return;
    } finally {
      try { rl?.close(); } catch {}
    }
  }
}

async function configureIntro({ args }) {
  const rootDir = await resolveRootDirFromArgs(args);
  const json = hasFlag(args, "--json");
  const loadStatus = async () => {
    const channel = await loadMatrixConfigureDefaults({ rootDir, agentName: DEFAULT_CHANNEL_AGENT_NAME });
    const mind = await loadMindConfigFromSecret(rootDir);
    const worldRoot = path.join(rootDir, "world");
    const configuredAgents = await listConfiguredAgents({ worldRoot });
    const agentConfigured = configuredAgents.length > 0;
    return {
      channel: Boolean(channel.homeserver && channel.room),
      mind: Boolean(mind.backend && mind.host && mind.model),
      agent: agentConfigured
    };
  };
  const status = await loadStatus();

  if (json) {
    jsonOut({ ok: true, route: "configure intro", rootDir, status });
    return;
  }

  while (true) {
    const current = await loadStatus();
    const defaultChoice = !current.channel ? "1"
      : !current.mind ? "2"
        : !current.agent ? "3"
          : "4";
    let rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    try {
      textOut("Pyash Configure Intro");
      textOut(`1. channel ${current.channel ? "(configured)" : "(pending)"}`);
      textOut(`2. mind ${current.mind ? "(configured)" : "(pending)"}`);
      textOut(`3. agent ${current.agent ? "(configured)" : "(pending)"}`);
      textOut("4. exit");
      const choice = (await rl.question(`Choose option [${defaultChoice}]: `)).trim() || defaultChoice;
      if (choice === "1") {
        rl.close();
        rl = null;
        await configureChannel([]);
        continue;
      }
      if (choice === "2") {
        rl.close();
        rl = null;
        await configureMind({ args: [] });
        continue;
      }
      if (choice === "3") {
        rl.close();
        rl = null;
        await configureAgent({ args: [] });
        continue;
      }
      textOut("No changes made.");
      return;
    } finally {
      try { rl?.close(); } catch {}
    }
  }
}

async function configureChannel(args) {
  const sub = args[0] ?? "";
  if (!sub) {
    while (true) {
      let rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      try {
      textOut("Pyash Configure Channel");
      textOut("1. matrix");
      textOut("2. exit");
      const choice = (await rl.question("Choose option [1]: ")).trim() || "1";
      if (choice === "2") {
        textOut("No changes made.");
        return;
      }
      // Close parent prompt before entering nested interactive flow.
      rl.close();
      rl = null;
      await configureMatrix({ args: [] });
      } finally {
        try { rl?.close(); } catch {}
      }
    }
  }

  if (sub === "list") {
    await configureChannelList({ json: hasFlag(args, "--json") });
    return;
  }

  if (sub !== MATRIX_CATERER_NAME) {
    throw new Error(`unknown caterer: ${sub}`);
  }

  const action = args[1] ?? "";
  if (action === "test") {
    await configureMatrixTest({ args: args.slice(2) });
    return;
  }
  if (action === "doctor") {
    await configureMatrixDoctor({ args: args.slice(2) });
    return;
  }
  await configureMatrix({ args: args.slice(1) });
}

async function configureMenu(args) {
  const first = args[0] ?? "";
  if (first === "intro") {
    await configureIntro({ args: args.slice(1) });
    return;
  }
  if (first === "orchestrator") {
    await configureOrchestrator({ args: args.slice(1) });
    return;
  }
  if (first === "channel") {
    await configureChannel(args.slice(1));
    return;
  }
  if (first === "mind") {
    await configureMind({ args: args.slice(1) });
    return;
  }
  if (first === "agent") {
    await configureAgent({ args: args.slice(1) });
    return;
  }

  while (true) {
    let rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    try {
    textOut("Pyash Configure");
    textOut("1. intro");
    textOut("2. channel");
    textOut("3. mind");
    textOut("4. agent");
    textOut("5. exit");
    const choice = (await rl.question("Choose option [1]: ")).trim() || "1";
    if (choice === "1") {
      // Close parent prompt before entering nested interactive flow.
      rl.close();
      rl = null;
      await configureIntro({ args: [] });
      continue;
    }
    if (choice === "2") {
      rl.close();
      rl = null;
      await configureChannel([]);
      continue;
    }
    if (choice === "3") {
      rl.close();
      rl = null;
      await configureMind({ args: [] });
      continue;
    }
    if (choice === "4") {
      rl.close();
      rl = null;
      await configureAgent({ args: [] });
      continue;
    }
    textOut("No changes made.");
    return;
    } finally {
      try { rl?.close(); } catch {}
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const first = args[0] ?? "";

  if (!first || first === "--help" || first === "-h" || first === "help") {
    textOut(usage());
    return;
  }

  if (first === "run") {
    const code = await runNodeScript(runProgramPath, args.slice(1));
    process.exit(code);
  }

  if (first === "repl") {
    const code = await runNodeScript(replPath, []);
    process.exit(code);
  }

  if (first === "configure") {
    await configureMenu(args.slice(1));
    return;
  }

  if (first === "calendar") {
    await calendarCommand(args.slice(1));
    return;
  }

  if (first === "channel") {
    await channelCommand(args.slice(1));
    return;
  }

  const code = await runNodeScript(runProgramPath, args);
  process.exit(code);
}

main().catch((err) => {
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
});
