import fs from "node:fs/promises";
import path from "node:path";
import { sentenceToPyash } from "../../beautiful.mjs";
import { interpret as bridgeInterpret } from "../../bridge/index.mjs";
import { remember } from "../../remember/index.mjs";
import { mind_to_name_text } from "../../verbs/mind/mind.mjs";
import { worldRootFromAgentHouse, worldNewspaperLogPath } from "../newspaper_log.mjs";
import { routeChannelInput, routeChannelProduce } from "../router_runtime.mjs";
import { orchestrateRouterInput } from "../orchestrator_runtime.mjs";
import {
  readChannelRuntimeState,
  writeChannelRuntimeState
} from "../channel_core/state.mjs";

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
  const sentence = {
    mood: "ya",
    su: { name: event?.channelType ?? "channel" },
    be: "channel telemetry",
    as: { name: event?.event ?? "poll" },
    during: { date: event?.timestamp ?? new Date().toISOString() },
    ob: { text: JSON.stringify(event ?? {}) }
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

function shouldIncludeToolSummary({ channelConfig, channelId, dmRooms }) {
  const isDmRoom = dmRooms?.has(channelId) === true;
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

function buildPrompt(event, { payloadId } = {}) {
  const header = `[channel ${event.channelType} channelId ${event.channelId} sender ${event.sender} eventId ${event.eventId}]`;
  const attachmentTask = buildAttachmentAutoTaskBlock(event);
  const attachmentBlock = buildAttachmentPromptBlock(event?.attachmentsSaved);
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

function buildAttachmentPromptBlock(attachmentsSaved) {
  const files = Array.isArray(attachmentsSaved) ? attachmentsSaved : [];
  if (!files.length) return "";
  const lines = ["", "", "[channel files saved]"];
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
  }
  lines.push("[tools for files]");
  lines.push("- image handling: if your model already has image capability, analyze attached images directly first; use be see only as fallback");
  lines.push("- be read from filename <path> ... : extract text from docs/audio/image via read auto");
  lines.push("- be see from filename <image> ... : ask a vision-capable mind directly");
  lines.push("- be command ... : inspect/process files");
  lines.push("- be repair ... : patch code/text files safely");
  return lines.join("\n");
}

function buildAttachmentAutoTaskBlock(event) {
  const saved = Array.isArray(event?.attachmentsSaved) ? event.attachmentsSaved : [];
  if (!saved.length) return "";
  const images = saved.filter((entry) => isImageAttachment(entry));
  if (!images.length) return "";
  const text = String(event?.text ?? "").trim();
  const imageNames = new Set(images.map((entry) => String(entry?.filename ?? path.basename(String(entry?.path ?? ""))).trim().toLowerCase()).filter(Boolean));
  const isLikelyNoCaption = !text || imageNames.has(text.toLowerCase());
  if (!isLikelyNoCaption) return "";
  return [
    "[channel auto task]",
    "Image upload detected without caption.",
    "First analyze the image directly with your own image capability if available.",
    "If direct image analysis is unavailable, call be see from filename on the saved image path."
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
  const roomScoped = channelConfig?.roomListeners?.[roomId];
  if (Array.isArray(roomScoped) && roomScoped.length) return roomScoped;
  const global = channelConfig?.listeners;
  if (Array.isArray(global) && global.length) return global;
  return [fallbackAgentName];
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
  dedupIds,
  dedupState,
  selfEventIds,
  selfState,
  dedupLimit,
  debug
}) {
  let received = 0;
  let handled = 0;
  let skippedDedup = 0;
  let skippedSelf = 0;
  let skippedMention = 0;
  let sent = 0;
  const dmRooms = new Set(Array.isArray(channelConfig?.dmRooms) ? channelConfig.dmRooms : []);
  const mentionGate = channelConfig?.mentionGate === true;
  const selfSenders = selfSenderCandidates({ channelConfig, agentName });
  const worldRoot = worldRootFromAgentHouse(agentHouse);

  for (const event of events) {
    received += 1;
    const listenerAgents = roomListenerAgents(channelConfig, event.channelId, agentName);
    const targetedByMention = resolveMentionTargets({
      text: event.text,
      listenerAgents,
      channelUser: channelConfig?.user
    });
    const repliedToSelf = Boolean(
      (event.inReplyToEventId && selfEventIds.has(event.inReplyToEventId))
      || (event.threadId && selfEventIds.has(event.threadId))
    );
    const listenersToRun = mentionGate && !dmRooms.has(event.channelId)
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
          mentionGate,
          dmRoom: dmRooms.has(event.channelId),
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
        mentionGate,
        dmRoom: dmRooms.has(event.channelId),
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
      const routedEvent = {
        ...event,
        text: orchestratorDirective.payloadText || event.text
      };
      if (typeof adapter?.downloadAttachments === "function" && event.attachments?.length) {
        const dayStamp = dateStampFromIso(event.timestamp);
        const targetDir = path.join(worldRoot, "house", orchestratorDirective.agentName || listener, "artifacts", dayStamp);
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
            listener: orchestratorDirective.agentName || listener,
            error: String(err?.stack ?? err?.message ?? err)
          }, { channelType, agentName });
        }
      }
      const sentence = buildChannelMindSentence({
        agentName: orchestratorDirective.agentName || listener,
        event: routedEvent,
        channelConfig,
        sessionName: orchestratorDirective.sessionName,
        payloadId: orchestratorDirective.payloadId,
        agentCwd: path.join(worldRoot, "house", orchestratorDirective.agentName || listener)
      });
      handled += 1;
      let responseText = "";
      const includeToolSummary = shouldIncludeToolSummary({
        channelConfig,
        channelId: event.channelId,
        dmRooms
      });
      const mindInputs = buildMindInputsFromAttachments(routedEvent.attachmentsSaved);
      const toolExpectation = includeToolSummary && expectsToolActivity(event.text);
      let toolEventCount = 0;
      const sendChannelMessage = async (content) => {
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
              listener: orchestratorDirective.agentName || listener,
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
          listener: orchestratorDirective.agentName || listener,
          payloadId: orchestratorDirective.payloadId,
          replied: Boolean(responseText),
          repliedToSelf
        }, { channelType, agentName });
      }
      if (!responseText) continue;
      await sendChannelMessage(responseText);
      await routeChannelProduce({
        routerInterpretFn,
        channelType,
        event,
        sourceAgentName: orchestratorDirective.agentName || listener,
        payloadId: orchestratorDirective.payloadId,
        responseText
      });
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
    ob: { text: buildPrompt(event, { payloadId }) },
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
    attachments: Array.isArray(rawEvent.attachments) ? rawEvent.attachments : []
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
}
