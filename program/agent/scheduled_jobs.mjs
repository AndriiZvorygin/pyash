import fs from "node:fs/promises";
import path from "node:path";

import { parse } from "../understand/index.mjs";
import { interpret } from "../bridge/index.mjs";
import { state } from "../bridge/state.mjs";
import { pushModuleDir, popModuleDir } from "../bridge/modules.mjs";
import { remember } from "../remember/index.mjs";
import { splitSentencesWithLines } from "../library/sentenceSplitter.mjs";
import { resolveAgentHouse, ensureAgentDirs } from "./session.mjs";
import { loadServiceDefinition, resolveServiceModulePath } from "./service_definition.mjs";
import {
  listWorldDeclaredAgentHouses,
  resolveWorldAgentHouseDirectory
} from "../library/agent_command_policy.mjs";
import { loadChannelPolicyWithGlobal } from "./channels/policy.mjs";
import {
  runChannelOnce,
  runChannelPollOnce,
  runChannelInputOnce,
  runChannelProduceOnce
} from "./channels/index.mjs";
import { createMatrixAdapter } from "./channels/matrix.mjs";
import { createCliAdapter } from "./channels/cli.mjs";
import {
  resolveMatrixConfigWithMap,
  mergeMatrixDmRooms as mergeMatrixDmRoomsFromRuntime,
  hydrateMatrixRuntimeConfig
} from "./channels/matrix_runtime.mjs";
import { updateAgentPresence } from "./presence.mjs";
import { writeRouterHealthState } from "./channel_core/state.mjs";

const HEARTBEAT_OK_TOKEN = "HEARTBEAT_OK";
const HEARTBEAT_PROMPT = `Read HEARTBEAT.md in your agent house.
Follow any instructions or tasks listed there.
If nothing needs attention, reply with just: ${HEARTBEAT_OK_TOKEN}`;
const loadedServiceModules = new Set();

function isHeartbeatEmpty(content) {
  if (!content) return true;
  const skipPatterns = new Set(["- [ ]", "* [ ]", "- [x]", "* [x]"]);
  for (const raw of content.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#")) continue;
    if (line.startsWith("<!--")) continue;
    if (skipPatterns.has(line)) continue;
    return false;
  }
  return true;
}

function normalizeOk(text) {
  return String(text ?? "").toUpperCase().replace(/[_\s]+/g, "");
}

function sanitizeName(raw, fallback = "value") {
  const text = String(raw ?? "").trim().toLowerCase();
  const cleaned = text.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return cleaned || fallback;
}

function buildMindSentence({ job, prompt, outName, agentHouse }) {
  return {
    mood: "do",
    be: "write",
    ob: { text: prompt },
    for: { name: job.agentName },
    to: { name: outName },
    fromtext: { name: `session name ${job.laneName}` },
    with: job.withCase ?? { wo: "tools" },
    at: { filename: String(agentHouse) }
  };
}

export function resolveMatrixConfigWithRemember(rawConfig = {}) {
  return resolveMatrixConfigWithMap(rawConfig);
}

export function mergeMatrixDmRooms(args = {}) {
  return mergeMatrixDmRoomsFromRuntime(args);
}

function parseChannelPollJob(jobName) {
  const text = String(jobName ?? "").trim().toLowerCase();
  const match = text.match(/^([a-z0-9_-]+)\s+(poll|probe|input|produce)$/);
  if (!match) return null;
  const source = match[1];
  const kind = match[2];
  if (source === "channel") {
    return { mode: "multi", kind };
  }
  return { mode: "single", channelType: source, kind };
}

function normalizeChannelOrder(values = []) {
  const ordered = [];
  const seen = new Set();
  for (const value of values) {
    const normalized = String(value ?? "").trim().toLowerCase();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    ordered.push(normalized);
  }
  return ordered;
}

function channelTypesFromJobWithCase(withCase, fallback = []) {
  const values = withCase?.ve?.values;
  if (!Array.isArray(values) || values.length === 0) return normalizeChannelOrder(fallback);
  return normalizeChannelOrder(values);
}

function normalizeChannelMode(raw) {
  const text = String(raw ?? "").trim().toLowerCase();
  if (text === "appservice") return "appservice-push";
  if (text === "poll" || text === "sync" || text === "appservice-push") return text;
  return "sync";
}

function normalizeLongPollMs(raw, fallback = 10000) {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  const rounded = Math.trunc(value);
  if (rounded < 1000) return 1000;
  if (rounded > 120000) return 120000;
  return rounded;
}

function nowIso() {
  return new Date().toISOString();
}

function shortError(err) {
  return String(err?.message ?? err ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

async function runChannelPollJob({ worldRoot, job }) {
  const parsed = parseChannelPollJob(job.jobName);
  if (!parsed) return null;
  const declared = listWorldDeclaredAgentHouses({ worldRoot });
  const agentNames = Array.from(new Set(
    declared.map((entry) => String(entry?.agentName ?? "").trim()).filter(Boolean)
  )).sort((a, b) => a.localeCompare(b, "en"));
  if (!agentNames.length) return { status: "skipped:no_agents" };

  let totalReceived = 0;
  let totalHandled = 0;
  let totalSent = 0;
  const channelStatus = [];

  for (const targetAgentName of agentNames) {
    const agentHouse = resolveWorldAgentHouseDirectory({
      worldRoot,
      agentName: targetAgentName,
      includeFallback: true
    }) ?? resolveAgentHouse({ mindName: targetAgentName, rememberFn: remember });
    await ensureAgentDirs(agentHouse);
    const allChannels = await loadChannelPolicyWithGlobal({ worldRoot, agentHouse });
    const availableChannelTypes = normalizeChannelOrder(Object.keys(allChannels));
    const channelTypes = parsed.mode === "multi"
      ? channelTypesFromJobWithCase(job.withCase, availableChannelTypes)
      : [parsed.channelType];
    if (!channelTypes.length) continue;

    for (const channelType of channelTypes) {
      const rawConfig = allChannels[channelType];
      if (!rawConfig?.enabled) continue;
      let channelConfig = { ...rawConfig };
      const channelMode = normalizeChannelMode(channelConfig.mode);
      const effectiveLongPollMs = normalizeLongPollMs(channelConfig.longPollMs, 10000);
      channelConfig = { ...channelConfig, mode: channelMode, longPollMs: effectiveLongPollMs };
    if (channelConfig.warmStart == null) {
      channelConfig = { ...channelConfig, warmStart: true };
    }
      if (channelMode === "appservice-push" && (parsed.kind === "poll" || parsed.kind === "probe")) continue;
      let dmBootstrapDefect = "";
      if (channelType === "matrix") {
        const hydrated = await hydrateMatrixRuntimeConfig({
          channelConfig,
          agentName: targetAgentName,
          agentHouse,
          channelType
        });
        channelConfig = hydrated.channelConfig;
        if (hydrated.dmBootstrapErrors.length > 0) {
          const first = hydrated.dmBootstrapErrors[0];
          dmBootstrapDefect = `executive_dm_bootstrap_failed:${String(first.executiveUser ?? "").trim()}:${shortError(first.error)}`;
          channelStatus.push(`${targetAgentName}/${channelType}:dm_bootstrap_error=${hydrated.dmBootstrapErrors.length}`);
        }
      }
      const adapter = channelType === "matrix"
        ? createMatrixAdapter()
        : (channelType === "cli" ? createCliAdapter({ worldRoot, agentName: targetAgentName }) : null);
      if (!adapter) continue;
      let result = null;
      let activeMode = channelMode;
      let fallbackActive = false;
      let fallbackReason = "";
      const runChannelPhase = async (configToRun) => {
        if (parsed.kind === "poll" || parsed.kind === "probe") {
          return runChannelPollOnce({
            agentName: targetAgentName,
            channelType,
            channelConfig: configToRun,
            adapter,
            agentHouse
          });
        }
        if (parsed.kind === "input") {
          return runChannelInputOnce({
            agentName: targetAgentName,
            channelType,
            channelConfig: configToRun,
            adapter,
            interpretFn: interpret,
            agentHouse,
            maxItems: 10,
            concurrency: 2
          });
        }
        if (parsed.kind === "produce") {
          return runChannelProduceOnce({
            agentName: targetAgentName,
            channelType,
            channelConfig: configToRun,
            adapter,
            agentHouse,
            maxItems: 10
          });
        }
        return runChannelOnce({
          agentName: targetAgentName,
          channelType,
          channelConfig: configToRun,
          adapter,
          interpretFn: interpret,
          agentHouse
        });
      };
      try {
        result = await runChannelPhase(channelConfig);
      } catch (err) {
        if (channelMode === "appservice-push") {
          const configuredFallbackMode = normalizeChannelMode(
            channelConfig.fallbackMode || channelConfig.alternateMode || "poll"
          );
          if (configuredFallbackMode && configuredFallbackMode !== channelMode) {
            const fallbackConfig = { ...channelConfig, mode: configuredFallbackMode };
            try {
              result = await runChannelPhase(fallbackConfig);
              activeMode = configuredFallbackMode;
              fallbackActive = true;
              fallbackReason = `primary ${channelMode} defective: ${shortError(err)}`;
            } catch (fallbackErr) {
              const message = shortError(fallbackErr);
              fallbackReason = `primary ${channelMode} defective: ${shortError(err)}; fallback ${configuredFallbackMode} defective: ${message}`;
            }
          } else {
            fallbackReason = `primary ${channelMode} defective: ${shortError(err)}`;
          }
        }
        if (!result) {
          const message = fallbackReason || shortError(err);
          channelStatus.push(`${targetAgentName}/${channelType}:error=${message}`);
          continue;
        }
      }
      if (!result) continue;
      totalReceived += Number(result?.received ?? 0);
      totalHandled += Number(result?.handled ?? 0);
      totalSent += Number(result?.sent ?? 0);
      const modeSuffix = `mode=${activeMode}`;
      const fallbackSuffix = fallbackActive ? ":fallback=active" : "";
      channelStatus.push(`${targetAgentName}/${channelType}:received=${result.received}:handled=${result.handled}:sent=${result.sent}:${modeSuffix}${fallbackSuffix}`);
      const healthReason = [fallbackReason, dmBootstrapDefect].filter(Boolean).join("; ");
      const healthy = !dmBootstrapDefect;
      await writeRouterHealthState({
        worldRoot,
        channelType,
        activeMode,
        fallbackActive,
        fallbackReason: healthReason,
        queueDepth: Number(result?.queueDepth ?? 0) || 0,
        lastInputAt: String(result?.lastInputAt ?? ""),
        updatedAt: nowIso(),
        healthy,
        statusText: healthy ? "ready" : "degraded"
      });
    }
  }
  if (!channelStatus.length) return { status: "skipped:no_enabled_channels" };
  return { status: `channel:received=${totalReceived}:handled=${totalHandled}:sent=${totalSent} [${channelStatus.join(", ")}]` };
}

async function runMindScheduledJob({ worldRoot, job }) {
  const isHeartbeat = String(job.jobName ?? "").toLowerCase() === "heartbeat";
  const agentHouse = resolveAgentHouse({ mindName: job.agentName, rememberFn: remember });
  await ensureAgentDirs(agentHouse);
  let prompt = job.prompt;
  if (isHeartbeat) {
    const heartbeatPath = path.join(agentHouse, "HEARTBEAT.md");
    let content = "";
    try {
      content = await fs.readFile(heartbeatPath, "utf8");
    } catch (err) {
      if (err?.code === "ENOENT") return { status: "skipped:missing_heartbeat" };
      throw err;
    }
    if (isHeartbeatEmpty(content)) return { status: "skipped:empty_heartbeat" };
    prompt = HEARTBEAT_PROMPT;
  }
  if (!prompt || !prompt.trim()) return { status: "skipped:empty_prompt" };

  const outName = `${sanitizeName(job.jobName, "job")}_out`;
  const sentence = buildMindSentence({ job, prompt, outName, agentHouse });
  const result = await interpret(sentence);
  const responseText = String(result?.ob?.text ?? "");
  if (isHeartbeat) {
    const ok = normalizeOk(responseText).includes(normalizeOk(HEARTBEAT_OK_TOKEN));
    return { status: ok ? "heartbeat_ok" : "heartbeat_done" };
  }
  return { status: "ok" };
}

async function loadServiceModuleFile({ modulePath, interpretFn = interpret } = {}) {
  const resolved = path.resolve(String(modulePath ?? ""));
  if (!resolved || loadedServiceModules.has(resolved)) return;
  let raw = "";
  try {
    raw = await fs.readFile(resolved, "utf8");
  } catch (err) {
    if (err?.code === "ENOENT") return;
    throw err;
  }
  const lines = splitSentencesWithLines(raw, { includeThen: true });
  pushModuleDir(path.dirname(resolved));
  try {
    for (const entry of lines) {
      const trimmed = entry.text.trim();
      if (!trimmed) continue;
      state.currentSourceFilename = resolved;
      state.currentSourceLine = entry.line;
      const sentence = parse(trimmed);
      state.currentSourceSentence = sentence;
      await interpretFn(sentence);
    }
  } finally {
    popModuleDir();
    state.currentSourceFilename = null;
    state.currentSourceLine = null;
    state.currentSourceSentence = null;
  }
  loadedServiceModules.add(resolved);
}

async function runServiceDefinitionJob({ worldRoot, job }) {
  const definition = await loadServiceDefinition({ worldRoot, serviceName: job?.jobName });
  if (!definition) return null;
  for (const moduleRef of definition.modules) {
    const modulePath = resolveServiceModulePath({
      worldRoot,
      serviceFilePath: definition.filePath,
      moduleRef
    });
    await loadServiceModuleFile({ modulePath, interpretFn: interpret });
  }
  if (definition.execStart) {
    await interpret({
      mood: "do",
      be: "command",
      ob: { text: definition.execStart }
    });
    return { status: "service:execstart_ok" };
  }
  if (!definition.runText) return { status: "skipped:service_missing_run" };
  const sentence = parse(definition.runText);
  await interpret(sentence);
  return { status: "service:ok" };
}

export async function runScheduledJob({ worldRoot, job }) {
  const channelResult = await runChannelPollJob({ worldRoot, job });
  if (channelResult) return channelResult;
  if (!job?.agentName) return { status: "skipped:missing_agent" };
  const nowIso = new Date().toISOString();
  await updateAgentPresence({
    worldRoot,
    agentName: job.agentName,
    latestIso: nowIso,
    touchedFiles: [
      `house/${job.agentName}/conduct/calendar.pya`,
      `house/${job.agentName}/session`
    ]
  });
  await interpret(parse(`exists su name ${job.agentName} be mind ya`));
  let result = null;
  const serviceResult = await runServiceDefinitionJob({ worldRoot, job });
  if (serviceResult) {
    result = serviceResult;
  } else {
    result = await runMindScheduledJob({ worldRoot, job });
  }
  await updateAgentPresence({
    worldRoot,
    agentName: job.agentName,
    latestIso: new Date().toISOString(),
    touchedFiles: [
      `house/${job.agentName}/conduct/calendar.pya`,
      `house/${job.agentName}/session`,
      `house/${job.agentName}/artifacts`
    ]
  });
  return result;
}
