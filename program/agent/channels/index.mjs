import fs from "node:fs/promises";
import path from "node:path";
import { sentenceToPyash } from "../../beautiful.mjs";
import { interpret as bridgeInterpret } from "../../bridge/index.mjs";
import { remember } from "../../remember/index.mjs";
import { mind_to_name_text } from "../../verbs/mind/mind.mjs";
import { worldRootFromAgentHouse, worldNewspaperLogPath } from "../newspaper_log.mjs";
import { resolveWorldAgentHouseDirectory } from "../../library/agent_command_policy.mjs";
import { routeChannelInput, routeChannelProduce } from "../router_runtime.mjs";
import { orchestrateRouterInput } from "../orchestrator_runtime.mjs";
import { loadImportPolicyWithGlobal } from "../import/policy.mjs";
import { buildRouterProduceRequestSentence } from "../channel_core/contract.mjs";
import {
  readChannelRuntimeState,
  writeChannelRuntimeState
} from "../channel_core/state.mjs";
import {
  enqueueInputEnvelope,
  enqueueProduceEnvelope,
  claimOldestInputEnvelope,
  claimOldestProduceEnvelope,
  ackRuntimeEnvelopeSuccess,
  ackRuntimeEnvelopeFail,
  queueDepth
} from "../channel_core/queue.mjs";

function nowIso() {
  return new Date().toISOString();
}

function sanitizeLaneName(raw) {
  return String(raw ?? "")
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "") || "session";
}

function channelInputLockPath({ worldRoot, agentName, channelType }) {
  const agent = sanitizeLaneName(agentName || "agent");
  const channel = sanitizeLaneName(channelType || "channel");
  return path.join(worldRoot, "presence", `${agent}-${channel}-channel-input.lock`);
}

function isPidAlive(pid) {
  const value = Number.parseInt(String(pid ?? ""), 10);
  if (!Number.isFinite(value) || value <= 0) return false;
  try {
    process.kill(value, 0);
    return true;
  } catch {
    return false;
  }
}

function parseLockPid(text) {
  const match = String(text ?? "").match(/(?:^|\n)pid=(\d+)(?:\n|$)/);
  if (!match) return null;
  const value = Number.parseInt(match[1], 10);
  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
}

async function acquireChannelInputLock({
  worldRoot,
  agentName,
  channelType,
  staleMs = 15 * 60 * 1000
} = {}) {
  const lockPath = channelInputLockPath({ worldRoot, agentName, channelType });
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  const staleAgeMs = Number.isFinite(Number(staleMs)) && Number(staleMs) > 0
    ? Math.trunc(Number(staleMs))
    : 15 * 60 * 1000;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await fs.open(lockPath, "wx");
      const payload = [
        `pid=${process.pid}`,
        `startedAt=${new Date().toISOString()}`,
        `agent=${String(agentName ?? "").trim()}`,
        `channel=${String(channelType ?? "").trim()}`
      ].join("\n");
      await handle.writeFile(`${payload}\n`, "utf8");
      return { lockPath, handle };
    } catch (err) {
      if (err?.code !== "EEXIST") return null;
      let stale = false;
      try {
        const raw = await fs.readFile(lockPath, "utf8");
        const ownerPid = parseLockPid(raw);
        if (ownerPid && !isPidAlive(ownerPid)) {
          stale = true;
        }
      } catch {
        // continue to mtime fallback check
      }
      if (!stale) {
        try {
          const stat = await fs.stat(lockPath);
          stale = (Date.now() - Number(stat.mtimeMs || 0)) > staleAgeMs;
        } catch {
          stale = false;
        }
      }
      if (!stale) return null;
      try {
        await fs.rm(lockPath, { force: true });
      } catch {
        return null;
      }
    }
  }
  return null;
}

async function releaseChannelInputLock(lock) {
  if (!lock) return;
  try {
    if (lock.handle?.close) await lock.handle.close();
  } catch {
    // best-effort close
  }
  try {
    if (lock.lockPath) await fs.rm(lock.lockPath, { force: true });
  } catch {
    // best-effort cleanup
  }
}

function defaultLane({ channelType, channelId }) {
  return sanitizeLaneName(`${channelType}_${channelId}`);
}

function channelTelemetryPath(agentHouse, { channelType, agentName } = {}) {
  const worldRoot = worldRootFromAgentHouse(agentHouse);
  const logName = `channel-${channelType}-${agentName}`;
  return worldNewspaperLogPath({ worldRoot, name: logName });
}

async function appendTelemetry(agentHouse, event, { channelType, agentName } = {}) {
  const target = channelTelemetryPath(agentHouse, { channelType, agentName });
  await fs.mkdir(path.dirname(target), { recursive: true });
  const payload = {
    ...(event && typeof event === "object" ? event : {}),
    pid: Number(event?.pid ?? process.pid)
  };
  const sentence = {
    mood: "ya",
    su: { name: payload?.channelType ?? "channel" },
    be: "channel telemetry",
    as: { name: payload?.event ?? "poll" },
    during: { date: payload?.timestamp ?? new Date().toISOString() },
    ob: { text: JSON.stringify(payload) }
  };
  await fs.appendFile(target, `${sentenceToPyash(sentence)}\n`, "utf8");
}

function shortText(value, limit = 180) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}...`;
}

function shortToolSummary(value, limit = 140) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}...`;
}

function shortToolArgs(value, limit = 220) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}...`;
}

function extractToolCallArgs(toolCall) {
  const raw = toolCall?.function?.arguments ?? toolCall?.arguments;
  if (raw == null) return "";
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return "";
    try {
      return JSON.stringify(JSON.parse(trimmed));
    } catch {
      return trimmed;
    }
  }
  if (typeof raw === "object") {
    try {
      return JSON.stringify(raw);
    } catch {
      return String(raw);
    }
  }
  return String(raw);
}

function expectsToolActivity(text = "") {
  return /\b(tool|search|web\s*search|lookup|look\s+up|find)\b/i.test(String(text ?? ""));
}

function isDmEvent(event, dmRooms) {
  if (event?.dmRoom === true) return true;
  const channelId = String(event?.channelId ?? "").trim();
  if (!channelId) return false;
  return dmRooms?.has(channelId) === true;
}

function shouldIncludeToolSummary({ channelConfig, event, dmRooms }) {
  const isDmRoom = isDmEvent(event, dmRooms);
  const dmSetting = channelConfig?.dmToolSummary;
  if (isDmRoom && typeof dmSetting === "boolean") return dmSetting;
  if (typeof channelConfig?.toolSummary === "boolean") return channelConfig.toolSummary;
  return false;
}

function formatToolEventMessage({ stage, toolName, toolText, ratifySentence, toolCall }) {
  const name = String(toolName ?? "").trim();
  if (!name) return "";
  if (stage === "call") {
    const args = shortToolArgs(extractToolCallArgs(toolCall));
    return args ? `tool call: ${name} args: ${args}` : `tool call: ${name}`;
  }
  if (stage === "ratify") {
    const decision = ratifySentence?.ob?.boolean;
    if (decision === true) return `tool review: ${name} allowed`;
    if (decision === false) return `tool review: ${name} denied`;
    return `tool review: ${name}`;
  }
  if (stage === "result") {
    const summary = shortToolSummary(toolText);
    return summary ? `tool result: ${name}: ${summary}` : `tool result: ${name}: (empty)`;
  }
  return "";
}

function buildPrompt(event, { payloadId, importPolicy } = {}) {
  const header = `[channel ${event.channelType} channelId ${event.channelId} sender ${event.sender} eventId ${event.eventId}]`;
  const attachmentTask = buildAttachmentAutoTaskBlock(event, importPolicy);
  const attachmentBlock = buildAttachmentPromptBlock(event?.attachmentsSaved, importPolicy);
  const attachmentErrorBlock = buildAttachmentErrorPromptBlock(event?.attachmentErrors);
  const bodyText = String(event?.text ?? "");
  const combinedBody = [attachmentTask, bodyText].filter(Boolean).join("\n\n");
  if (payloadId) {
    return `${header} [payloadId ${payloadId}]\n${combinedBody}${attachmentBlock}${attachmentErrorBlock}`;
  }
  return `${header}\n${combinedBody}${attachmentBlock}${attachmentErrorBlock}`;
}

function dateStampFromIso(isoText) {
  const value = String(isoText ?? "").trim();
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) {
    const now = new Date();
    return `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}${String(now.getUTCDate()).padStart(2, "0")}`;
  }
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}${String(date.getUTCDate()).padStart(2, "0")}`;
}

function classifyAttachmentKind(entry) {
  if (isImageAttachment(entry)) return "photograph";
  const mime = String(entry?.mimeType ?? "").toLowerCase().trim();
  const filePath = String(entry?.path ?? "").toLowerCase();
  if (mime === "application/pdf" || filePath.endsWith(".pdf")) return "documentation";
  if (mime.startsWith("audio/")) return "audio";
  if (
    mime.startsWith("text/")
    || /\.((txt|md|csv|json|yaml|yml|log))$/.test(filePath)
  ) return "text";
  return "file";
}

function importActionForKind(kind, importPolicy = {}) {
  const policy = importPolicy ?? {};
  if (kind === "photograph") return String(policy.photographAction || policy.fileAction || policy.defaultAction || "").trim();
  if (kind === "documentation") return String(policy.documentationAction || policy.fileAction || policy.defaultAction || "").trim();
  if (kind === "audio") return String(policy.audioAction || policy.fileAction || policy.defaultAction || "").trim();
  if (kind === "text") return String(policy.textAction || policy.fileAction || policy.defaultAction || "").trim();
  return String(policy.fileAction || policy.defaultAction || "").trim();
}

function importToolGuidanceLines(importPolicy = {}) {
  const policy = importPolicy ?? {};
  const lines = [];
  const read = String(policy.readToolGuidance || "").trim();
  const see = String(policy.seeToolGuidance || "").trim();
  const command = String(policy.commandToolGuidance || "").trim();
  const repair = String(policy.repairToolGuidance || "").trim();
  if (read) lines.push(`- ${read}`);
  if (see) lines.push(`- ${see}`);
  if (command) lines.push(`- ${command}`);
  if (repair) lines.push(`- ${repair}`);
  return lines;
}

function buildAttachmentPromptBlock(attachmentsSaved, importPolicy = {}) {
  const files = Array.isArray(attachmentsSaved) ? attachmentsSaved : [];
  if (!files.length) return "";
  const lines = ["", "", "[channel files saved]"];
  const importSteps = [];
  for (const entry of files) {
    const filePath = String(entry?.path ?? "").trim();
    if (!filePath) continue;
    const mime = String(entry?.mimeType ?? "").trim();
    const size = Number(entry?.bytes);
    const meta = [
      mime ? `mime=${mime}` : "",
      Number.isFinite(size) ? `bytes=${Math.trunc(size)}` : ""
    ].filter(Boolean).join(" ");
    lines.push(meta ? `- ${filePath} (${meta})` : `- ${filePath}`);
    const kind = classifyAttachmentKind(entry);
    const action = importActionForKind(kind, importPolicy);
    if (action) {
      importSteps.push(`- ${filePath}: do ${action}`);
    }
  }
  if (importSteps.length) {
    lines.push("[import do]");
    lines.push(...importSteps);
  }
  const toolLines = importToolGuidanceLines(importPolicy);
  if (toolLines.length) {
    lines.push("[tools for files]");
    lines.push(...toolLines);
  }
  return lines.join("\n");
}

function buildAttachmentAutoTaskBlock(event, importPolicy = {}) {
  const saved = Array.isArray(event?.attachmentsSaved) ? event.attachmentsSaved : [];
  if (!saved.length) return "";
  const images = saved.filter((entry) => isImageAttachment(entry));
  if (!images.length) return "";
  const text = String(event?.text ?? "").trim();
  const imageNames = new Set(images.map((entry) => String(entry?.filename ?? path.basename(String(entry?.path ?? ""))).trim().toLowerCase()).filter(Boolean));
  const isLikelyNoCaption = !text || imageNames.has(text.toLowerCase());
  if (!isLikelyNoCaption) return "";
  const photographAction = String(importPolicy?.photographAction || importPolicy?.fileAction || importPolicy?.defaultAction || "").trim();
  if (!photographAction) return "";
  return [
    "[channel auto task]",
    "Photograph upload detected.",
    `For agent, do ${photographAction} using the saved photograph path.`
  ].join("\n");
}

function buildAttachmentErrorPromptBlock(attachmentErrors) {
  const errors = Array.isArray(attachmentErrors) ? attachmentErrors : [];
  if (!errors.length) return "";
  const lines = ["", "", "[channel file download defects]"];
  for (const entry of errors) {
    const name = String(entry?.name ?? "file").trim();
    const message = String(entry?.message ?? "").trim();
    lines.push(message ? `- ${name}: ${message}` : `- ${name}: download failed`);
  }
  return lines.join("\n");
}

function isImageAttachment(entry) {
  const mime = String(entry?.mimeType ?? "").toLowerCase().trim();
  if (mime.startsWith("image/")) return true;
  const filePath = String(entry?.path ?? "").toLowerCase();
  return /\.(png|jpe?g|webp|gif|bmp|tiff?|svg)$/.test(filePath);
}

function buildMindInputsFromAttachments(attachmentsSaved) {
  const files = Array.isArray(attachmentsSaved) ? attachmentsSaved : [];
  const out = [];
  for (const entry of files) {
    if (!isImageAttachment(entry)) continue;
    const filename = String(entry?.path ?? "").trim();
    if (!filename) continue;
    out.push({
      kind: "image",
      filename,
      mimeType: String(entry?.mimeType ?? "").trim()
    });
  }
  return out;
}

function noMindConfiguredFallback() {
  return "no mind configured yet, run pyash configure mind to set a mind relay";
}

function mindErrorFallback(err) {
  const message = String(err?.message ?? err ?? "").trim();
  if (!message) return "mind defective: run pyash configure mind to verify relay settings";
  return `mind defective: ${message}`;
}

function emptyMindFallback() {
  return "I received your message, but I could not generate a reply. Please retry.";
}

function isMindUnavailableError(err) {
  if (!err) return false;
  const sentenceName = String(err?.sentence?.su?.name ?? "").trim().toLowerCase();
  const message = String(err?.message ?? "").trim().toLowerCase();
  if (sentenceName === "mind backend missing") return true;
  if (sentenceName === "mind defective" && message.includes("mind backend missing")) return true;
  if (sentenceName === "variable as not exists" && message.includes("mind")) return true;
  return message.includes("mind backend missing");
}

function isMindConfigured() {
  const fact = remember("mind configure");
  if (!fact || fact.be !== "map") return false;
  const map = fact?.ob?.map;
  if (!map || typeof map !== "object") return false;
  const backend = String(map?.backend?.ob?.text ?? "").trim();
  const host = String(map?.host?.ob?.text ?? "").trim();
  const model = String(map?.model?.ob?.text ?? "").trim();
  return Boolean(backend && host && model);
}

function outputName(channelType) {
  return `${sanitizeLaneName(channelType)}_channel_out`;
}

function resolveEventLane(event, channelConfig) {
  const roomLane = channelConfig?.roomLanes?.[event.channelId] ?? null;
  const lane = event?.laneName ?? roomLane ?? channelConfig?.defaultLane ?? defaultLane(event);
  return sanitizeLaneName(lane);
}

function extractMentionCandidates(userId) {
  const values = new Set();
  const full = String(userId ?? "").trim().toLowerCase();
  if (!full) return [];
  values.add(full);
  if (full.startsWith("@")) {
    values.add(full.slice(1));
  }
  const colonIdx = full.indexOf(":");
  if (colonIdx > 1) {
    const localWithAt = full.slice(0, colonIdx);
    values.add(localWithAt);
    if (localWithAt.startsWith("@")) values.add(localWithAt.slice(1));
  }
  return [...values].filter(Boolean);
}

function escapeRegex(value) {
  return String(value ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsMentionToken(body, token) {
  const normalizedBody = String(body ?? "").toLowerCase();
  const normalizedToken = String(token ?? "").trim().toLowerCase();
  if (!normalizedBody || !normalizedToken) return false;
  const pattern = new RegExp(`(^|[^a-z0-9_:@-])${escapeRegex(normalizedToken)}(?=$|[^a-z0-9_:@-])`, "i");
  return pattern.test(normalizedBody);
}

function isMentioned(text, userId) {
  const body = String(text ?? "").toLowerCase();
  if (!body) return false;
  for (const candidate of extractMentionCandidates(userId)) {
    if (containsMentionToken(body, candidate)) return true;
  }
  return false;
}

function agentMentionCandidates(agentName) {
  const name = String(agentName ?? "").trim().toLowerCase();
  if (!name) return [];
  const variants = new Set([
    name,
    `@${name}`,
    name.replace(/_/g, "-"),
    `@${name.replace(/_/g, "-")}`
  ]);
  return [...variants];
}

function homeserverHost(homeserver) {
  const value = String(homeserver ?? "").trim();
  if (!value) return "";
  try {
    const parsed = new URL(value.includes("://") ? value : `https://${value}`);
    return parsed.host.toLowerCase();
  } catch {
    return "";
  }
}

function deriveMatrixServer(channelConfig = {}) {
  const configuredUser = String(channelConfig?.user ?? "").trim();
  const idx = configuredUser.indexOf(":");
  if (configuredUser.startsWith("@") && idx > 1) {
    return configuredUser.slice(idx + 1).toLowerCase();
  }
  return homeserverHost(channelConfig?.homeserver);
}

function selfSenderCandidates({ channelConfig, agentName } = {}) {
  const out = new Set();
  const configuredUser = String(channelConfig?.user ?? "").trim().toLowerCase();
  if (configuredUser) out.add(configuredUser);
  const server = deriveMatrixServer(channelConfig);
  const normalizedAgent = String(agentName ?? "").trim().toLowerCase();
  if (server && normalizedAgent) {
    out.add(`@${normalizedAgent}:${server}`);
  }
  return out;
}

function roomListenerAgents(channelConfig, roomId, fallbackAgentName) {
  const normalize = (values) => {
    if (!Array.isArray(values)) return [];
    return values
      .map((value) => String(value ?? "").trim())
      .filter(Boolean);
  };
  const roomScoped = normalize(channelConfig?.roomListeners?.[roomId]);
  const global = normalize(channelConfig?.listeners);
  const configured = roomScoped.length ? roomScoped : global;
  if (!configured.length) return [fallbackAgentName];
  const fallback = String(fallbackAgentName ?? "").trim();
  if (fallback && configured.includes(fallback)) return [fallback];
  return configured;
}

function resolveTargetAgentHouse(worldRoot, agentName) {
  return resolveWorldAgentHouseDirectory({
    worldRoot,
    agentName,
    includeFallback: true
  }) ?? path.join(worldRoot, "house", String(agentName ?? "").trim());
}

function resolveMentionTargets({ text, listenerAgents, channelUser }) {
  const body = String(text ?? "").toLowerCase();
  if (!body) return [];
  const targeted = [];
  for (const agent of listenerAgents) {
    const matches = agentMentionCandidates(agent).some(token => containsMentionToken(body, token));
    if (matches) targeted.push(agent);
  }
  if (!targeted.length && channelUser && isMentioned(body, channelUser)) {
    return [...listenerAgents];
  }
  return targeted;
}

async function dispatchChannelEvents({
  events,
  channelType,
  channelConfig,
  agentName,
  adapter,
  interpretFn,
  routerInterpretFn,
  agentHouse,
  worldRoot = "",
  dedupIds,
  dedupState,
  selfEventIds,
  selfState,
  dedupLimit,
  debug,
  outputMode = "direct"
}) {
  let received = 0;
  let handled = 0;
  let skippedDedup = 0;
  let skippedSelf = 0;
  let skippedMention = 0;
  let sent = 0;
  const dmRooms = new Set(Array.isArray(channelConfig?.dmRooms) ? channelConfig.dmRooms : []);
  const publicTagAnswer = channelConfig?.publicTagAnswer === true;
  const selfSenders = selfSenderCandidates({ channelConfig, agentName });
  const worldRootResolved = worldRoot || worldRootFromAgentHouse(agentHouse);
  const importPolicyByAgent = new Map();

  const loadImportPolicyForAgent = async (targetAgent) => {
    const key = String(targetAgent ?? "").trim();
    if (!key) return {};
    if (importPolicyByAgent.has(key)) return importPolicyByAgent.get(key);
    const targetAgentHouse = resolveTargetAgentHouse(worldRootResolved, key);
    const policy = await loadImportPolicyWithGlobal({ worldRoot: worldRootResolved, agentHouse: targetAgentHouse });
    importPolicyByAgent.set(key, policy);
    return policy;
  };

  for (const event of events) {
    received += 1;
    const listenerAgents = roomListenerAgents(channelConfig, event.channelId, agentName);
    const eventIsDmRoom = isDmEvent(event, dmRooms);
    const targetedByMention = resolveMentionTargets({
      text: event.text,
      listenerAgents,
      channelUser: channelConfig?.user
    });
    const repliedToSelf = Boolean(
      (event.inReplyToEventId && selfEventIds.has(event.inReplyToEventId))
      || (event.threadId && selfEventIds.has(event.threadId))
    );
    const listenersToRun = publicTagAnswer && !eventIsDmRoom
      ? (repliedToSelf ? listenerAgents : targetedByMention)
      : (targetedByMention.length ? targetedByMention : listenerAgents);

    if (dedupIds.has(event.eventId)) {
      skippedDedup += 1;
      if (debug) {
        await appendTelemetry(agentHouse, {
          timestamp: nowIso(),
          channelType,
          event: "event",
          decision: "dedup_skip",
          eventId: event.eventId,
          sender: event.sender,
          channelId: event.channelId,
          text: shortText(event.text),
          listenerAgents,
          targetedByMention,
          listenersToRun
        }, { channelType, agentName });
      }
      continue;
    }
    dedupIds.add(event.eventId);
    dedupState.order.push(event.eventId);
    while (dedupState.order.length > dedupLimit) {
      const removed = dedupState.order.shift();
      if (!removed) break;
      dedupIds.delete(removed);
    }

    if (selfSenders.has(String(event.sender ?? "").trim().toLowerCase())) {
      selfEventIds.add(event.eventId);
      selfState.order.push(event.eventId);
      while (selfState.order.length > dedupLimit) {
        const removed = selfState.order.shift();
        if (!removed) break;
        selfEventIds.delete(removed);
      }
      skippedSelf += 1;
      if (debug) {
        await appendTelemetry(agentHouse, {
          timestamp: nowIso(),
          channelType,
          event: "event",
          decision: "self_skip",
          eventId: event.eventId,
          sender: event.sender,
          channelId: event.channelId,
          text: shortText(event.text),
          listenerAgents,
          targetedByMention,
          listenersToRun,
          repliedToSelf
        }, { channelType, agentName });
      }
      continue;
    }

    if (typeof adapter?.markSeen === "function") {
      try {
        const markSeenTask = adapter.markSeen({ config: channelConfig, event });
        if (markSeenTask && typeof markSeenTask.then === "function") {
          void markSeenTask.catch(async (err) => {
            if (!debug) return;
            await appendTelemetry(agentHouse, {
              timestamp: nowIso(),
              channelType,
              event: "event",
              decision: "mark_seen_error",
              eventId: event.eventId,
              sender: event.sender,
              channelId: event.channelId,
              error: String(err?.stack ?? err?.message ?? err)
            }, { channelType, agentName });
          });
        }
      } catch (err) {
        if (debug) {
          await appendTelemetry(agentHouse, {
            timestamp: nowIso(),
            channelType,
            event: "event",
            decision: "mark_seen_error",
            eventId: event.eventId,
            sender: event.sender,
            channelId: event.channelId,
            error: String(err?.stack ?? err?.message ?? err)
          }, { channelType, agentName });
        }
      }
    }

    if (!listenersToRun.length) {
      skippedMention += 1;
      if (debug) {
        await appendTelemetry(agentHouse, {
          timestamp: nowIso(),
          channelType,
          event: "event",
          decision: "mention_skip",
          eventId: event.eventId,
          sender: event.sender,
          channelId: event.channelId,
          text: shortText(event.text),
          listenerAgents,
          targetedByMention,
          listenersToRun,
          publicTagAnswer,
          dmRoom: eventIsDmRoom,
          repliedToSelf
        }, { channelType, agentName });
      }
      continue;
    }

    if (debug) {
      await appendTelemetry(agentHouse, {
        timestamp: nowIso(),
        channelType,
        event: "event",
        decision: "dispatch_begin",
        eventId: event.eventId,
        sender: event.sender,
        channelId: event.channelId,
        text: shortText(event.text),
        listenerAgents,
        targetedByMention,
        listenersToRun,
        publicTagAnswer,
        dmRoom: eventIsDmRoom,
        repliedToSelf
      }, { channelType, agentName });
    }

    for (const listener of listenersToRun) {
      const lane = resolveEventLane(event, channelConfig);
      const fallbackSessionName = `session name ${lane}`;
      const routedInput = await routeChannelInput({
        routerInterpretFn,
        channelType,
        event,
        targetAgentName: listener,
        sessionName: fallbackSessionName
      });
      const orchestratorDirective = orchestrateRouterInput({
        routerInput: routedInput,
        fallbackAgentName: listener,
        fallbackSessionName
      });
      const targetAgent = orchestratorDirective.agentName || listener;
      const importPolicy = await loadImportPolicyForAgent(targetAgent);
      const routedEvent = {
        ...event,
        text: orchestratorDirective.payloadText || event.text
      };
      if (typeof adapter?.downloadAttachments === "function" && event.attachments?.length) {
        const dayStamp = dateStampFromIso(event.timestamp);
        const targetAgentHouse = resolveTargetAgentHouse(worldRootResolved, targetAgent);
        const targetDir = path.join(targetAgentHouse, "artifacts", dayStamp);
        try {
          routedEvent.attachmentsSaved = await adapter.downloadAttachments({
            config: channelConfig,
            event,
            targetDir
          });
        } catch (err) {
          routedEvent.attachmentErrors = (routedEvent.attachmentErrors ?? []).concat([{
            name: event.attachments?.[0]?.body || "attachment",
            message: String(err?.message ?? err)
          }]);
          await appendTelemetry(agentHouse, {
            timestamp: nowIso(),
            channelType,
            event: "event",
            decision: "attachment_download_error",
            eventId: event.eventId,
            sender: event.sender,
            channelId: event.channelId,
            listener: targetAgent,
            error: String(err?.stack ?? err?.message ?? err)
          }, { channelType, agentName });
        }
      }
      const sentence = buildChannelMindSentence({
        agentName: targetAgent,
        event: routedEvent,
        importPolicy,
        channelConfig,
        sessionName: orchestratorDirective.sessionName,
        payloadId: orchestratorDirective.payloadId,
        agentCwd: resolveTargetAgentHouse(worldRootResolved, targetAgent)
      });
      handled += 1;
      let responseText = "";
      const includeToolSummary = shouldIncludeToolSummary({
        channelConfig,
        event,
        dmRooms
      });
      const mindInputs = buildMindInputsFromAttachments(routedEvent.attachmentsSaved);
      const toolExpectation = includeToolSummary && expectsToolActivity(event.text);
      let toolEventCount = 0;
      const sendChannelMessage = async (content) => {
        if (outputMode !== "direct") return;
        const sendResult = await adapter.send({ config: channelConfig, event, content });
        if (sendResult?.eventId) {
          selfEventIds.add(sendResult.eventId);
          selfState.order.push(sendResult.eventId);
          while (selfState.order.length > dedupLimit) {
            const removed = selfState.order.shift();
            if (!removed) break;
            selfEventIds.delete(removed);
          }
        }
        sent += 1;
      };
      const onToolCall = includeToolSummary
        ? async (payload) => {
          toolEventCount += 1;
          const content = formatToolEventMessage(payload);
          if (!content) return;
          await sendChannelMessage(content);
        }
        : null;
      try {
        const result = (interpretFn === bridgeInterpret)
          ? await mind_to_name_text(sentence, { onToolCall, inputs: mindInputs })
          : await interpretFn(sentence);
        responseText = String(result?.ob?.text ?? "").trim();
        if (!responseText && !isMindConfigured()) {
          responseText = noMindConfiguredFallback();
        }
      } catch (err) {
        if (isMindUnavailableError(err)) {
          responseText = noMindConfiguredFallback();
        } else {
          responseText = mindErrorFallback(err);
          if (debug) {
            await appendTelemetry(agentHouse, {
              timestamp: nowIso(),
              channelType,
              event: "event",
              decision: "mind_error",
              eventId: event.eventId,
              sender: event.sender,
              channelId: event.channelId,
              listener: targetAgent,
              payloadId: orchestratorDirective.payloadId,
              error: String(err?.stack ?? err?.message ?? err)
            }, { channelType, agentName });
          }
        }
      }
      if (toolExpectation && toolEventCount === 0) {
        await sendChannelMessage("tool call: none");
      }
      if (debug) {
        await appendTelemetry(agentHouse, {
          timestamp: nowIso(),
          channelType,
          event: "event",
          decision: "handled",
          eventId: event.eventId,
          sender: event.sender,
          channelId: event.channelId,
          text: shortText(event.text),
          listenerAgents,
          targetedByMention,
          listenersToRun,
          listener: targetAgent,
          payloadId: orchestratorDirective.payloadId,
          replied: Boolean(responseText),
          repliedToSelf
        }, { channelType, agentName });
      }
      if (!responseText) responseText = emptyMindFallback();
      const produceRequest = buildRouterProduceRequestSentence({
        channelType,
        event,
        sourceAgentName: targetAgent,
        payloadId: orchestratorDirective.payloadId,
        responseText
      });
      await routeChannelProduce({
        routerInterpretFn,
        channelType,
        event,
        sourceAgentName: targetAgent,
        payloadId: orchestratorDirective.payloadId,
        responseText
      });
      if (outputMode === "queue") {
        await enqueueProduceEnvelope(worldRootResolved, {
          channelType,
          identity: String(channelConfig?.user ?? "").trim(),
          agentName: targetAgent,
          roomName: event.channelId,
          payloadId: orchestratorDirective.payloadId,
          payloadSentence: produceRequest
        });
        sent += 1;
      } else {
        await sendChannelMessage(responseText);
      }
    }
  }

  return {
    received,
    handled,
    sent,
    skippedDedup,
    skippedSelf,
    skippedMention
  };
}

export function buildChannelMindSentence({
  agentName,
  event,
  importPolicy = {},
  channelConfig,
  sessionName,
  payloadId,
  agentCwd = ""
}) {
  const lane = resolveEventLane(event, channelConfig);
  const resolvedSessionName = sessionName || `session name ${lane}`;
  const sentence = {
    mood: "do",
    be: "write",
    ob: { text: buildPrompt(event, { payloadId, importPolicy }) },
    for: { name: agentName },
    to: { name: outputName(event.channelType) },
    with: { wo: "tools" },
    fromtext: { name: resolvedSessionName }
  };
  const cwdText = String(agentCwd ?? "").trim();
  if (cwdText) sentence.at = { filename: cwdText };
  return sentence;
}

function normalizeEvent(rawEvent, channelType) {
  if (!rawEvent || typeof rawEvent !== "object") return null;
  const eventId = String(rawEvent.eventId ?? "").trim();
  const channelId = String(rawEvent.channelId ?? "").trim();
  const sender = String(rawEvent.sender ?? "").trim();
  const text = String(rawEvent.text ?? "").trim();
  if (!eventId || !channelId || !sender || !text) return null;
  return {
    channelType,
    channelId,
    threadId: rawEvent.threadId ? String(rawEvent.threadId) : null,
    inReplyToEventId: rawEvent.inReplyToEventId ? String(rawEvent.inReplyToEventId) : null,
    eventId,
    sender,
    text,
    timestamp: rawEvent.timestamp ? String(rawEvent.timestamp) : nowIso(),
    laneName: rawEvent.laneName ? String(rawEvent.laneName) : null,
    attachments: Array.isArray(rawEvent.attachments) ? rawEvent.attachments : [],
    dmRoom: rawEvent.dmRoom === true || rawEvent.directRoom === true
  };
}

function eventToQueueSentence(event) {
  return {
    mood: "ya",
    su: { name: String(event?.eventId ?? "").trim() || "channel-event" },
    be: "channel queued event",
    ob: { text: JSON.stringify(event ?? {}) }
  };
}

function eventFromQueueSentence(sentence) {
  const text = String(sentence?.ob?.text ?? "").trim();
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function parseChannelIdFromEndpoint(endpoint) {
  const text = String(endpoint ?? "").trim();
  const match = text.match(/^channel\s+\S+\s+room\s+(.+)$/i);
  if (!match) return "";
  return String(match[1] ?? "").trim();
}

function parseAgentNameFromEndpoint(endpoint) {
  const text = String(endpoint ?? "").trim();
  const match = text.match(/^agent\s+(.+)$/i);
  if (!match) return "";
  return String(match[1] ?? "").trim();
}

export async function runChannelPollOnce({
  agentName,
  channelType,
  channelConfig,
  adapter,
  agentHouse,
  dedupLimit = 2000
}) {
  if (!agentName) throw new Error("runChannelPollOnce requires agentName");
  if (!channelType) throw new Error("runChannelPollOnce requires channelType");
  if (!adapter) throw new Error("runChannelPollOnce requires adapter");
  if (!agentHouse) throw new Error("runChannelPollOnce requires agentHouse");
  const worldRoot = worldRootFromAgentHouse(agentHouse);
  const lock = await acquireChannelInputLock({ worldRoot, agentName, channelType });
  if (!lock) return { received: 0, enqueued: 0, skippedDedup: 0, durationMs: 0, queueDepth: 0, locked: true };

  try {
    const runtimeState = await readChannelRuntimeState({ agentHouse, channelType });
    const checkpoint = runtimeState?.checkpoint && typeof runtimeState.checkpoint === "object"
      ? runtimeState.checkpoint
      : {};
    const selfState = { order: Array.isArray(runtimeState?.selfOrder) ? [...runtimeState.selfOrder] : [] };
    const startMs = Date.now();
    const recv = await adapter.receive({ config: channelConfig, checkpoint });
    const rawEvents = Array.isArray(recv?.events) ? recv.events : [];
    const events = rawEvents.map(event => normalizeEvent(event, channelType)).filter(Boolean);
    const newCheckpoint = recv?.checkpoint ?? checkpoint;
    const checkpointText = String(checkpoint?.nextBatch ?? "").trim();
    const shouldWarmStart = channelConfig?.warmStart === true
      && !checkpointText
      && Array.isArray(runtimeState?.dedupOrder)
      && runtimeState.dedupOrder.length === 0
      && Array.isArray(runtimeState?.selfOrder)
      && runtimeState.selfOrder.length === 0;
    let enqueued = 0;
    let skippedDedup = 0;
    const debug = channelConfig?.debug === true;

    if (shouldWarmStart) {
      await writeChannelRuntimeState({
        agentHouse,
        channelType,
        checkpoint: newCheckpoint,
        dedupOrder: Array.isArray(runtimeState?.dedupOrder) ? runtimeState.dedupOrder : [],
        selfOrder: selfState.order,
        removeLegacy: true
      });
      const depth = await queueDepth(worldRoot);
      const durationMs = Date.now() - startMs;
      await appendTelemetry(agentHouse, {
        timestamp: nowIso(),
        channelType,
        event: "poll_enqueue",
        decision: "warm_start",
        durationMs,
        received: 0,
        enqueued: 0,
        skippedDedup: 0,
        queueDepth: depth.total
      }, { channelType, agentName });
      return {
        received: 0,
        enqueued: 0,
        skippedDedup: 0,
        durationMs,
        queueDepth: depth.total,
        warmed: true
      };
    }

    for (const event of events) {
      if (typeof adapter?.markSeen === "function") {
        try {
          const seenTask = adapter.markSeen({ config: channelConfig, event });
          if (seenTask && typeof seenTask.then === "function") void seenTask.catch(() => {});
        } catch {
          // best-effort only
        }
      }
      await enqueueInputEnvelope(worldRoot, {
        channelType,
        identity: String(channelConfig?.user ?? "").trim(),
        agentName,
        roomName: event.channelId,
        eventId: event.eventId,
        payloadSentence: eventToQueueSentence(event)
      });
      enqueued += 1;
    }

    await writeChannelRuntimeState({
      agentHouse,
      channelType,
      checkpoint: newCheckpoint,
      dedupOrder: Array.isArray(runtimeState?.dedupOrder) ? runtimeState.dedupOrder : [],
      selfOrder: selfState.order,
      removeLegacy: true
    });
    const depth = await queueDepth(worldRoot);
    const durationMs = Date.now() - startMs;
    await appendTelemetry(agentHouse, {
      timestamp: nowIso(),
      channelType,
      event: "poll_enqueue",
      durationMs,
      received: events.length,
      enqueued,
      skippedDedup,
      queueDepth: depth.total
    }, { channelType, agentName });
    if (debug && recv?.diagnostics) {
      await appendTelemetry(agentHouse, {
        timestamp: nowIso(),
        channelType,
        event: "poll_debug",
        diagnostics: recv.diagnostics
      }, { channelType, agentName });
    }
    return {
      received: events.length,
      enqueued,
      skippedDedup,
      durationMs,
      queueDepth: depth.total
    };
  } finally {
    await releaseChannelInputLock(lock);
  }
}

export async function runChannelInputOnce({
  agentName,
  channelType,
  channelConfig,
  adapter = null,
  interpretFn,
  routerInterpretFn = bridgeInterpret,
  agentHouse,
  dedupLimit = 2000,
  maxItems = 10,
  concurrency = 2
}) {
  if (!agentName) throw new Error("runChannelInputOnce requires agentName");
  if (!channelType) throw new Error("runChannelInputOnce requires channelType");
  if (typeof interpretFn !== "function") throw new Error("runChannelInputOnce requires interpretFn");
  if (!agentHouse) throw new Error("runChannelInputOnce requires agentHouse");
  const worldRoot = worldRootFromAgentHouse(agentHouse);
  const runtimeState = await readChannelRuntimeState({ agentHouse, channelType });
  const checkpoint = runtimeState?.checkpoint && typeof runtimeState.checkpoint === "object"
    ? runtimeState.checkpoint
    : {};
  const dedupState = { order: Array.isArray(runtimeState?.dedupOrder) ? [...runtimeState.dedupOrder] : [] };
  const selfState = { order: Array.isArray(runtimeState?.selfOrder) ? [...runtimeState.selfOrder] : [] };
  const dedupIds = new Set(dedupState.order);
  const selfEventIds = new Set(selfState.order);
  const claims = [];
  const limit = Math.max(1, Math.trunc(Number(maxItems) || 10));
  for (let i = 0; i < limit; i += 1) {
    const claimed = await claimOldestInputEnvelope(worldRoot, {
      workerTag: `${agentName}-input`,
      channelType,
      agentName
    });
    if (!claimed) break;
    claims.push(claimed);
  }
  if (!claims.length) {
    const depth = await queueDepth(worldRoot);
    return {
      received: 0,
      handled: 0,
      sent: 0,
      skippedDedup: 0,
      skippedSelf: 0,
      skippedMention: 0,
      durationMs: 0,
      queueDepth: depth.total
    };
  }
  const startMs = Date.now();
  const workerCount = Math.max(1, Math.trunc(Number(concurrency) || 2));
  let cursor = 0;
  const totals = {
    received: 0,
    handled: 0,
    sent: 0,
    skippedDedup: 0,
    skippedSelf: 0,
    skippedMention: 0
  };
  const processClaim = async (claim) => {
    const queuedEvent = eventFromQueueSentence(claim?.envelope?.payloadSentence);
    const event = normalizeEvent(queuedEvent, channelType);
    const retryCount = Math.max(0, Math.trunc(Number(claim?.envelope?.retryCount) || 0));
    if (!event) {
      await ackRuntimeEnvelopeFail(worldRoot, {
        runtimePath: claim.path,
        retryCount,
        maxRetries: 0,
        requeuePhase: "input"
      });
      return;
    }
    try {
      const dispatchResult = await dispatchChannelEvents({
        events: [event],
        channelType,
        channelConfig,
        agentName,
        adapter,
        interpretFn,
        routerInterpretFn,
        agentHouse,
        worldRoot,
        dedupIds,
        dedupState,
        selfEventIds,
        selfState,
        dedupLimit,
        debug: channelConfig?.debug === true,
        outputMode: "queue"
      });
      totals.received += Number(dispatchResult?.received ?? 0);
      totals.handled += Number(dispatchResult?.handled ?? 0);
      totals.sent += Number(dispatchResult?.sent ?? 0);
      totals.skippedDedup += Number(dispatchResult?.skippedDedup ?? 0);
      totals.skippedSelf += Number(dispatchResult?.skippedSelf ?? 0);
      totals.skippedMention += Number(dispatchResult?.skippedMention ?? 0);
      await ackRuntimeEnvelopeSuccess(worldRoot, { runtimePath: claim.path });
    } catch {
      await ackRuntimeEnvelopeFail(worldRoot, {
        runtimePath: claim.path,
        retryCount: retryCount + 1,
        maxRetries: 2,
        requeuePhase: "input"
      });
    }
  };
  const workers = Array.from({ length: Math.min(workerCount, claims.length) }, async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= claims.length) return;
      await processClaim(claims[index]);
    }
  });
  await Promise.all(workers);
  await writeChannelRuntimeState({
    agentHouse,
    channelType,
    checkpoint,
    dedupOrder: dedupState.order,
    selfOrder: selfState.order,
    removeLegacy: true
  });
  const depth = await queueDepth(worldRoot);
  const durationMs = Date.now() - startMs;
  await appendTelemetry(agentHouse, {
    timestamp: nowIso(),
    channelType,
    event: "input_dispatch",
    durationMs,
    ...totals,
    queueDepth: depth.total
  }, { channelType, agentName });
  return {
    ...totals,
    durationMs,
    queueDepth: depth.total
  };
}

export async function runChannelProduceOnce({
  agentName,
  channelType,
  channelConfig,
  adapter,
  agentHouse,
  dedupLimit = 2000,
  maxItems = 10
}) {
  if (!agentName) throw new Error("runChannelProduceOnce requires agentName");
  if (!channelType) throw new Error("runChannelProduceOnce requires channelType");
  if (!adapter) throw new Error("runChannelProduceOnce requires adapter");
  if (!agentHouse) throw new Error("runChannelProduceOnce requires agentHouse");
  const worldRoot = worldRootFromAgentHouse(agentHouse);
  const runtimeState = await readChannelRuntimeState({ agentHouse, channelType });
  const checkpoint = runtimeState?.checkpoint && typeof runtimeState.checkpoint === "object"
    ? runtimeState.checkpoint
    : {};
  const dedupState = { order: Array.isArray(runtimeState?.dedupOrder) ? [...runtimeState.dedupOrder] : [] };
  const selfState = { order: Array.isArray(runtimeState?.selfOrder) ? [...runtimeState.selfOrder] : [] };
  const limit = Math.max(1, Math.trunc(Number(maxItems) || 10));
  let sent = 0;
  let failed = 0;
  const startMs = Date.now();

  for (let i = 0; i < limit; i += 1) {
    const claim = await claimOldestProduceEnvelope(worldRoot, {
      workerTag: `${agentName}-produce`,
      channelType,
      agentName
    });
    if (!claim) break;
    const retryCount = Math.max(0, Math.trunc(Number(claim?.envelope?.retryCount) || 0));
    const payloadSentence = claim?.envelope?.payloadSentence ?? {};
    const roomId = parseChannelIdFromEndpoint(payloadSentence?.to?.name);
    const sourceAgent = parseAgentNameFromEndpoint(payloadSentence?.from?.name) || agentName;
    const content = String(payloadSentence?.ob?.text ?? "").trim();
    if (!roomId || !content) {
      failed += 1;
      await ackRuntimeEnvelopeFail(worldRoot, {
        runtimePath: claim.path,
        retryCount,
        maxRetries: 0,
        requeuePhase: "produce"
      });
      continue;
    }
    try {
      const sendResult = await adapter.send({
        config: channelConfig,
        event: { channelType, channelId: roomId },
        content
      });
      if (sendResult?.eventId) {
        selfState.order.push(sendResult.eventId);
        while (selfState.order.length > dedupLimit) selfState.order.shift();
      }
      sent += 1;
      await ackRuntimeEnvelopeSuccess(worldRoot, { runtimePath: claim.path });
      await appendTelemetry(agentHouse, {
        timestamp: nowIso(),
        channelType,
        event: "produce_sent",
        sourceAgent,
        roomId,
        eventId: sendResult?.eventId ?? ""
      }, { channelType, agentName });
    } catch {
      failed += 1;
      await ackRuntimeEnvelopeFail(worldRoot, {
        runtimePath: claim.path,
        retryCount: retryCount + 1,
        maxRetries: 2,
        requeuePhase: "produce"
      });
    }
  }

  await writeChannelRuntimeState({
    agentHouse,
    channelType,
    checkpoint,
    dedupOrder: dedupState.order,
    selfOrder: selfState.order,
    removeLegacy: true
  });
  const depth = await queueDepth(worldRoot);
  const durationMs = Date.now() - startMs;
  await appendTelemetry(agentHouse, {
    timestamp: nowIso(),
    channelType,
    event: "produce_dispatch",
    durationMs,
    sent,
    failed,
    queueDepth: depth.total
  }, { channelType, agentName });
  return {
    received: sent + failed,
    handled: sent,
    sent,
    failed,
    durationMs,
    queueDepth: depth.total
  };
}

export async function runChannelOnce({
  agentName,
  channelType,
  channelConfig,
  adapter,
  interpretFn,
  routerInterpretFn = bridgeInterpret,
  agentHouse,
  dedupLimit = 2000
}) {
  if (!agentName) throw new Error("runChannelOnce requires agentName");
  if (!channelType) throw new Error("runChannelOnce requires channelType");
  if (!adapter) throw new Error("runChannelOnce requires adapter");
  if (typeof interpretFn !== "function") throw new Error("runChannelOnce requires interpretFn");
  if (!agentHouse) throw new Error("runChannelOnce requires agentHouse");

  const worldRoot = worldRootFromAgentHouse(agentHouse);
  const lock = await acquireChannelInputLock({ worldRoot, agentName, channelType });
  if (!lock) {
    await appendTelemetry(agentHouse, {
      timestamp: nowIso(),
      channelType,
      event: "poll",
      decision: "lock_skip",
      durationMs: 0,
      received: 0,
      handled: 0,
      sent: 0,
      skippedDedup: 0,
      skippedSelf: 0,
      skippedMention: 0
    }, { channelType, agentName });
    return {
      received: 0,
      handled: 0,
      sent: 0,
      skippedDedup: 0,
      skippedSelf: 0,
      skippedMention: 0,
      durationMs: 0,
      lastInputAt: "",
      queueDepth: 0,
      locked: true
    };
  }

  try {
  const runtimeState = await readChannelRuntimeState({ agentHouse, channelType });
  const checkpoint = runtimeState?.checkpoint && typeof runtimeState.checkpoint === "object"
    ? runtimeState.checkpoint
    : {};
  const dedupState = { order: Array.isArray(runtimeState?.dedupOrder) ? [...runtimeState.dedupOrder] : [] };
  const selfState = { order: Array.isArray(runtimeState?.selfOrder) ? [...runtimeState.selfOrder] : [] };
  const dedupIds = new Set(dedupState.order);
  const selfEventIds = new Set(selfState.order);

  const startMs = Date.now();
  const recv = await adapter.receive({ config: channelConfig, checkpoint });
  const rawEvents = Array.isArray(recv?.events) ? recv.events : [];
  const events = rawEvents
    .map(event => normalizeEvent(event, channelType))
    .filter(Boolean);

  const debug = channelConfig?.debug === true;
  if (debug && recv?.diagnostics) {
    await appendTelemetry(agentHouse, {
      timestamp: nowIso(),
      channelType,
      event: "poll_debug",
      diagnostics: recv.diagnostics
    }, { channelType, agentName });
  }

  const checkpointText = String(checkpoint?.nextBatch ?? "").trim();
  const shouldWarmStart = channelConfig?.warmStart === true
    && !checkpointText
    && dedupState.order.length === 0
    && selfState.order.length === 0;
  const newCheckpoint = recv?.checkpoint ?? checkpoint;
  if (shouldWarmStart) {
    await writeChannelRuntimeState({
      agentHouse,
      channelType,
      checkpoint: newCheckpoint,
      dedupOrder: dedupState.order,
      selfOrder: selfState.order,
      removeLegacy: true
    });
    const durationMs = Date.now() - startMs;
    await appendTelemetry(agentHouse, {
      timestamp: nowIso(),
      channelType,
      event: "poll",
      decision: "warm_start",
      durationMs,
      received: 0,
      handled: 0,
      sent: 0,
      skippedDedup: 0,
      skippedSelf: 0,
      skippedMention: 0
    }, { channelType, agentName });
    return {
      received: 0,
      handled: 0,
      sent: 0,
      skippedDedup: 0,
      skippedSelf: 0,
      skippedMention: 0,
      durationMs,
      lastInputAt: "",
      queueDepth: 0,
      warmed: true
    };
  }

  const dispatchResult = await dispatchChannelEvents({
    events,
    channelType,
    channelConfig,
    agentName,
    adapter,
    interpretFn,
    routerInterpretFn,
    agentHouse,
    dedupIds,
    dedupState,
    selfEventIds,
    selfState,
    dedupLimit,
    debug
  });
  await writeChannelRuntimeState({
    agentHouse,
    channelType,
    checkpoint: newCheckpoint,
    dedupOrder: dedupState.order,
    selfOrder: selfState.order,
    removeLegacy: true
  });

  const durationMs = Date.now() - startMs;
  const lastInputAt = events.length ? String(events[events.length - 1]?.timestamp ?? "") : "";
  await appendTelemetry(agentHouse, {
    timestamp: nowIso(),
    channelType,
    event: "poll",
    durationMs,
    ...dispatchResult
  }, { channelType, agentName });
    return {
      ...dispatchResult,
      durationMs,
      lastInputAt,
      queueDepth: 0
    };
  } finally {
    await releaseChannelInputLock(lock);
  }
}
