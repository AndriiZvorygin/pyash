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
import { loadChannelPolicyWithGlobal } from "./channels/policy.mjs";
import { runChannelOnce } from "./channels/index.mjs";
import { createMatrixAdapter } from "./channels/matrix.mjs";
import { ensureMatrixCredentials, readMatrixAuthCache, ensureMatrixExecutiveDmRoom } from "./channels/bootstrap.mjs";
import { updateAgentPresence } from "./presence.mjs";
import { resolveConfigMapText } from "../configure/env.mjs";
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

function buildMindSentence({ job, prompt, outName }) {
  return {
    mood: "do",
    be: "write",
    ob: { text: prompt },
    for: { name: job.agentName },
    to: { name: outName },
    fromtext: { name: `session name ${job.laneName}` },
    with: job.withCase ?? { wo: "tools" }
  };
}

function readRememberText(name) {
  const fact = remember(name);
  const value = fact?.ob?.text ?? fact?.ob?.name ?? fact?.ob?.filename ?? null;
  if (value == null) return null;
  const text = String(value).trim();
  return text || null;
}

export function resolveMatrixConfigWithRemember(rawConfig = {}) {
  const mapName = "matrix channel";
  const mapHomeserver = resolveConfigMapText(mapName, "homeserver");
  const mapMode = resolveConfigMapText(mapName, "mode");
  const mapLongPollMs = resolveConfigMapText(mapName, "long poll ms");
  const mapAppserviceRegistration =
    resolveConfigMapText(mapName, "bridge service file") ??
    resolveConfigMapText(mapName, "appservice registration");
  const mapUser = resolveConfigMapText(mapName, "user");
  const mapExecutiveUsername = resolveConfigMapText(mapName, "executive username");
  const mapSharedSecret = resolveConfigMapText(mapName, "registration shared secret");
  const mapAdminToken = resolveConfigMapText(mapName, "admin token");
  const mapToken = resolveConfigMapText(mapName, "token");
  return {
    ...rawConfig,
    mode: rawConfig.mode ?? mapMode ?? null,
    longPollMs: rawConfig.longPollMs ?? mapLongPollMs ?? null,
    appserviceRegistration: rawConfig.appserviceRegistration ?? mapAppserviceRegistration ?? null,
    homeserver:
      rawConfig.homeserver ??
      mapHomeserver ??
      readRememberText("matrix homeserver") ??
      readRememberText("matrix server") ??
      null,
    user:
      rawConfig.user ??
      mapUser ??
      readRememberText("matrix user") ??
      null,
    executiveUsername:
      rawConfig.executiveUsername ??
      mapExecutiveUsername ??
      readRememberText("matrix executive username") ??
      null,
    registrationSharedSecret:
      rawConfig.registrationSharedSecret ??
      mapSharedSecret ??
      readRememberText("matrix registration shared secret") ??
      null,
    adminToken:
      rawConfig.adminToken ??
      mapAdminToken ??
      readRememberText("matrix admin token") ??
      null,
    token:
      rawConfig.token ??
      mapToken ??
      readRememberText("matrix access token") ??
      null
  };
}

function normalizeLaneName(raw) {
  return String(raw ?? "")
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "") || "session";
}

function laneFromRoomId(channelType, roomId) {
  return normalizeLaneName(`${channelType}_${roomId}`);
}

export function mergeMatrixDmRooms({ channelConfig, dmRoomIds = [], channelType }) {
  const dmRooms = Array.isArray(channelConfig?.dmRooms) ? [...channelConfig.dmRooms] : [];
  const rooms = Array.isArray(channelConfig?.rooms) ? [...channelConfig.rooms] : [];
  const knownDm = new Set(dmRooms.map((room) => String(room ?? "").trim()).filter(Boolean));
  const knownRoom = new Set(rooms.map((room) => String(room?.id ?? "").trim()).filter(Boolean));
  for (const value of dmRoomIds) {
    const roomId = String(value ?? "").trim();
    if (!roomId) continue;
    if (!knownDm.has(roomId)) {
      knownDm.add(roomId);
      dmRooms.push(roomId);
    }
    if (!knownRoom.has(roomId)) {
      knownRoom.add(roomId);
      rooms.push({
        id: roomId,
        lane: laneFromRoomId(channelType, roomId)
      });
    }
  }
  return {
    ...channelConfig,
    dmRooms,
    rooms
  };
}

function parseChannelPollJob(jobName) {
  const text = String(jobName ?? "").trim().toLowerCase();
  const match = text.match(/^([a-z0-9_-]+)\s+(poll|probe|input)$/);
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

function normalizeLongPollMs(raw, fallback = 30000) {
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
  const agentHouse = resolveAgentHouse({ mindName: job.agentName, rememberFn: remember });
  await ensureAgentDirs(agentHouse);
  const allChannels = await loadChannelPolicyWithGlobal({ worldRoot, agentHouse });
  const availableChannelTypes = normalizeChannelOrder(Object.keys(allChannels));
  const channelTypes = parsed.mode === "multi"
    ? channelTypesFromJobWithCase(job.withCase, availableChannelTypes)
    : [parsed.channelType];
  if (!channelTypes.length) return { status: "skipped:no_channels" };

  let totalReceived = 0;
  let totalHandled = 0;
  let totalSent = 0;
  const channelStatus = [];

  for (const channelType of channelTypes) {
    const rawConfig = allChannels[channelType];
    if (!rawConfig?.enabled) {
      channelStatus.push(`${channelType}:disabled`);
      continue;
    }
    let channelConfig = { ...rawConfig };
    const channelMode = normalizeChannelMode(channelConfig.mode);
    const effectiveLongPollMs = channelMode === "poll"
      ? 1000
      : normalizeLongPollMs(channelConfig.longPollMs, 30000);
    channelConfig = { ...channelConfig, mode: channelMode, longPollMs: effectiveLongPollMs };
    if (channelMode === "appservice-push" && parsed.kind !== "input") {
      channelStatus.push(`${channelType}:skipped=push_mode`);
      continue;
    }
    if (channelType === "matrix") {
      channelConfig = resolveMatrixConfigWithRemember(channelConfig);
      const credentials = await ensureMatrixCredentials({
        agentName: job.agentName,
        agentHouse,
        config: channelConfig
      });
      channelConfig = {
        ...channelConfig,
        homeserver: credentials.homeserver,
        token: credentials.token,
        user: channelConfig.user ?? credentials.user
      };
      if (channelConfig.executiveUsername && channelConfig.token && channelConfig.user) {
        try {
          const dmRoomId = await ensureMatrixExecutiveDmRoom({
            agentHouse,
            homeserver: channelConfig.homeserver,
            token: channelConfig.token,
            user: channelConfig.user,
            executiveUser: channelConfig.executiveUsername
          });
          if (dmRoomId) {
            channelConfig = mergeMatrixDmRooms({
              channelConfig,
              dmRoomIds: [dmRoomId],
              channelType
            });
          }
        } catch {
          // DM bootstrap is best-effort; continue polling configured rooms.
        }
      }
      const authCache = await readMatrixAuthCache(agentHouse);
      const dmRoomIds = Object.values(authCache?.executiveDmRooms ?? {})
        .map((roomId) => String(roomId ?? "").trim())
        .filter((roomId) => roomId.startsWith("!"));
      if (dmRoomIds.length) {
        channelConfig = mergeMatrixDmRooms({ channelConfig, dmRoomIds, channelType });
      }
    }
    const adapter = channelType === "matrix" ? createMatrixAdapter() : null;
    if (!adapter) {
      channelStatus.push(`${channelType}:unsupported`);
      await writeRouterHealthState({
        worldRoot,
        channelType,
        activeMode: channelMode,
        fallbackActive: false,
        fallbackReason: "unsupported channel adapter",
        queueDepth: 0,
        lastInputAt: "",
        updatedAt: nowIso(),
        healthy: false,
        statusText: "defective"
      });
      continue;
    }
    let result = null;
    let activeMode = channelMode;
    let fallbackActive = false;
    let fallbackReason = "";
    try {
      result = await runChannelOnce({
        agentName: job.agentName,
        channelType,
        channelConfig,
        adapter,
        interpretFn: interpret,
        agentHouse
      });
    } catch (err) {
      if (channelMode === "appservice-push") {
        const configuredFallbackMode = normalizeChannelMode(
          channelConfig.fallbackMode || channelConfig.alternateMode || "sync"
        );
        if (configuredFallbackMode && configuredFallbackMode !== channelMode) {
          const fallbackConfig = { ...channelConfig, mode: configuredFallbackMode };
          try {
            result = await runChannelOnce({
              agentName: job.agentName,
              channelType,
              channelConfig: fallbackConfig,
              adapter,
              interpretFn: interpret,
              agentHouse
            });
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
        channelStatus.push(`${channelType}:error=${message}`);
        await writeRouterHealthState({
          worldRoot,
          channelType,
          activeMode,
          fallbackActive,
          fallbackReason: message,
          queueDepth: 0,
          lastInputAt: "",
          updatedAt: nowIso(),
          healthy: false,
          statusText: "defective"
        });
        continue;
      }
    }
    if (result) {
      totalReceived += Number(result?.received ?? 0);
      totalHandled += Number(result?.handled ?? 0);
      totalSent += Number(result?.sent ?? 0);
      const modeSuffix = `mode=${activeMode}`;
      const fallbackSuffix = fallbackActive ? ":fallback=active" : "";
      channelStatus.push(`${channelType}:received=${result.received}:handled=${result.handled}:sent=${result.sent}:${modeSuffix}`);
      if (fallbackSuffix) {
        channelStatus[channelStatus.length - 1] += `${fallbackSuffix}`;
      }
      await writeRouterHealthState({
        worldRoot,
        channelType,
        activeMode,
        fallbackActive,
        fallbackReason,
        queueDepth: Number(result?.queueDepth ?? 0) || 0,
        lastInputAt: String(result?.lastInputAt ?? ""),
        updatedAt: nowIso(),
        healthy: true,
        statusText: "ready"
      });
    }
  }

  if (!channelStatus.length) return { status: "skipped:no_enabled_channels" };
  return {
    status: `channel:received=${totalReceived}:handled=${totalHandled}:sent=${totalSent} [${channelStatus.join(", ")}]`
  };
}

async function runMindScheduledJob({ worldRoot, job }) {
  const isHeartbeat = String(job.jobName ?? "").toLowerCase() === "heartbeat";
  const agentHouse = path.join(worldRoot, "house", job.agentName);
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
  const sentence = buildMindSentence({ job, prompt, outName });
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
    const channelResult = await runChannelPollJob({ worldRoot, job });
    if (channelResult) {
      result = channelResult;
    } else {
      result = await runMindScheduledJob({ worldRoot, job });
    }
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
