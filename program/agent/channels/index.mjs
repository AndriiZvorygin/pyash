import fs from "node:fs/promises";
import path from "node:path";
import { sentenceToPyash } from "../../beautiful.mjs";
import { worldRootFromAgentHouse, worldNewspaperLogPath } from "../newspaper_log.mjs";

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

function checkpointPath(agentHouse, channelType) {
  return path.join(agentHouse, "conduct", `checkpoint-${channelType}.json`);
}

function dedupPath(agentHouse, channelType) {
  return path.join(agentHouse, "conduct", `dedup-${channelType}.json`);
}

function selfEventsPath(agentHouse, channelType) {
  return path.join(agentHouse, "conduct", `self-events-${channelType}.json`);
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

async function readJsonFile(filePath, fallback) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    if (err?.code === "ENOENT") return fallback;
    throw err;
  }
}

async function writeJsonFile(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(value, null, 2) + "\n", "utf8");
}

function buildPrompt(event) {
  const header = `[channel ${event.channelType} channelId ${event.channelId} sender ${event.sender} eventId ${event.eventId}]`;
  return `${header}\n${event.text}`;
}

function noMindConfiguredFallback() {
  return "mind is not configured yet, pyash configure mind to set the mind relays";
}

function isMindUnavailableError(err) {
  if (!err) return false;
  const sentenceName = String(err?.sentence?.su?.name ?? "").trim().toLowerCase();
  const message = String(err?.message ?? "").trim().toLowerCase();
  if (sentenceName === "mind backend missing") return true;
  return message.includes("mind backend missing");
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

    if (channelConfig?.user && event.sender === channelConfig.user) {
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
      const sentence = buildChannelMindSentence({ agentName: listener, event, channelConfig });
      handled += 1;
      let responseText = "";
      try {
        const result = await interpretFn(sentence);
        responseText = String(result?.ob?.text ?? "").trim();
      } catch (err) {
        if (!isMindUnavailableError(err)) throw err;
        responseText = noMindConfiguredFallback();
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
          listener,
          replied: Boolean(responseText),
          repliedToSelf
        }, { channelType, agentName });
      }
      if (!responseText) continue;
      const sendResult = await adapter.send({ config: channelConfig, event, content: responseText });
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

export function buildChannelMindSentence({ agentName, event, channelConfig }) {
  const lane = resolveEventLane(event, channelConfig);
  return {
    mood: "do",
    be: "write",
    ob: { text: buildPrompt(event) },
    for: { name: agentName },
    to: { name: outputName(event.channelType) },
    with: { wo: "tools" },
    fromtext: { name: `session name ${lane}` }
  };
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
    laneName: rawEvent.laneName ? String(rawEvent.laneName) : null
  };
}

export async function runChannelOnce({
  agentName,
  channelType,
  channelConfig,
  adapter,
  interpretFn,
  agentHouse,
  dedupLimit = 2000
}) {
  if (!agentName) throw new Error("runChannelOnce requires agentName");
  if (!channelType) throw new Error("runChannelOnce requires channelType");
  if (!adapter) throw new Error("runChannelOnce requires adapter");
  if (typeof interpretFn !== "function") throw new Error("runChannelOnce requires interpretFn");
  if (!agentHouse) throw new Error("runChannelOnce requires agentHouse");

  const cpPath = checkpointPath(agentHouse, channelType);
  const ddPath = dedupPath(agentHouse, channelType);
  const sePath = selfEventsPath(agentHouse, channelType);
  const checkpoint = await readJsonFile(cpPath, {});
  const dedupState = await readJsonFile(ddPath, { order: [], ids: {} });
  const selfState = await readJsonFile(sePath, { order: [] });
  const dedupIds = new Set(Array.isArray(dedupState.order) ? dedupState.order : []);
  const selfEventIds = new Set(Array.isArray(selfState.order) ? selfState.order : []);

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

  const dispatchResult = await dispatchChannelEvents({
    events,
    channelType,
    channelConfig,
    agentName,
    adapter,
    interpretFn,
    agentHouse,
    dedupIds,
    dedupState,
    selfEventIds,
    selfState,
    dedupLimit,
    debug
  });

  const newCheckpoint = recv?.checkpoint ?? checkpoint;
  await writeJsonFile(cpPath, newCheckpoint);
  await writeJsonFile(ddPath, dedupState);
  await writeJsonFile(sePath, selfState);

  const durationMs = Date.now() - startMs;
  await appendTelemetry(agentHouse, {
    timestamp: nowIso(),
    channelType,
    event: "poll",
    durationMs,
    ...dispatchResult
  }, { channelType, agentName });
  return { ...dispatchResult, durationMs };
}
