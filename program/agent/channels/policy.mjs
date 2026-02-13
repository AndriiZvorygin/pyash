import fs from "node:fs/promises";
import path from "node:path";

import { splitSentences } from "../../library/sentenceSplitter.mjs";
import { parse } from "../../understand/index.mjs";

function readBoolValue(sentence) {
  if (sentence?.ob?.boolean === true) return true;
  if (sentence?.ob?.boolean === false) return false;
  const text = String(sentence?.ob?.text ?? sentence?.ob?.name ?? sentence?.ob?.wo ?? "").toLowerCase().trim();
  if (text === "truth") return true;
  if (text === "lie") return false;
  return null;
}

function readTextValue(sentence) {
  const value = sentence?.ob?.text ?? sentence?.ob?.name ?? sentence?.ob?.filename ?? null;
  if (value == null) return null;
  const text = String(value).trim();
  return text || null;
}

function readNameVector(sentence) {
  const values = sentence?.ob?.ve?.values;
  if (!Array.isArray(values)) {
    const single = sentence?.ob?.name ?? sentence?.ob?.text ?? null;
    return single ? [String(single)] : [];
  }
  return values
    .map((value) => String(value ?? "").trim())
    .filter(Boolean);
}

function ensureChannel(channels, channelType) {
  if (!channels.has(channelType)) {
    channels.set(channelType, {
      type: channelType,
      enabled: undefined,
      mode: null,
      longPollMs: null,
      appserviceRegistration: null,
      homeserver: null,
      user: null,
      executiveUsernames: [],
      token: null,
      registrationSharedSecret: null,
      adminToken: null,
      debug: undefined,
      mentionGate: undefined,
      toolSummary: undefined,
      dmToolSummary: undefined,
      rooms: [],
      dmRooms: [],
      listeners: null,
      roomListeners: new Map(),
      roomLanes: new Map(),
      defaultLane: null
    });
  }
  return channels.get(channelType);
}

function parseSubject(subject) {
  const value = String(subject ?? "").trim();
  if (!value) return [];
  return value.split(/\s+/).filter(Boolean);
}

function laneFromRoomId(channelType, roomId) {
  const raw = `${channelType}_${roomId}`;
  return raw
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "") || "session";
}

export function parseChannelPolicyText(text) {
  const channels = new Map();
  const sentences = splitSentences(String(text ?? ""));
  for (const line of sentences) {
    let sentence;
    try {
      sentence = parse(line);
    } catch {
      continue;
    }
    if (!sentence || sentence.mood !== "ya") continue;
    const parts = parseSubject(sentence?.su?.name);
    if (parts.length < 2) continue;
    const channelType = parts[0].toLowerCase();
    const action = parts.slice(1).join(" ").toLowerCase();
    const cfg = ensureChannel(channels, channelType);

    if (action === "channel") {
      const enabled = readBoolValue(sentence);
      if (enabled != null) cfg.enabled = enabled;
      continue;
    }
    if (action === "homeserver") {
      cfg.homeserver = readTextValue(sentence) ?? cfg.homeserver;
      continue;
    }
    if (action === "mode") {
      cfg.mode = readTextValue(sentence) ?? cfg.mode;
      continue;
    }
    if (action === "long poll ms") {
      const raw = readTextValue(sentence);
      const num = Number(raw);
      if (Number.isFinite(num) && num > 0) cfg.longPollMs = Math.trunc(num);
      continue;
    }
    if (action === "bridge service file" || action === "appservice registration") {
      cfg.appserviceRegistration = readTextValue(sentence) ?? cfg.appserviceRegistration;
      continue;
    }
    if (action === "user") {
      cfg.user = readTextValue(sentence) ?? cfg.user;
      continue;
    }
    if (action === "executive username") {
      const executive = readTextValue(sentence);
      if (!executive) continue;
      if (!cfg.executiveUsernames.includes(executive)) cfg.executiveUsernames.push(executive);
      continue;
    }
    if (action === "executive usernames") {
      const executives = readNameVector(sentence);
      for (const executive of executives) {
        const value = String(executive ?? "").trim();
        if (!value) continue;
        if (!cfg.executiveUsernames.includes(value)) cfg.executiveUsernames.push(value);
      }
      continue;
    }
    if (action === "token") {
      cfg.token = readTextValue(sentence) ?? cfg.token;
      continue;
    }
    if (action === "registration shared secret") {
      cfg.registrationSharedSecret = readTextValue(sentence) ?? cfg.registrationSharedSecret;
      continue;
    }
    if (action === "admin token") {
      cfg.adminToken = readTextValue(sentence) ?? cfg.adminToken;
      continue;
    }
    if (action === "room") {
      const roomId = readTextValue(sentence);
      if (!roomId) continue;
      if (!cfg.rooms.includes(roomId)) cfg.rooms.push(roomId);
      continue;
    }
    if (action === "dm room") {
      const roomId = readTextValue(sentence);
      if (!roomId) continue;
      if (!cfg.dmRooms.includes(roomId)) cfg.dmRooms.push(roomId);
      if (!cfg.rooms.includes(roomId)) cfg.rooms.push(roomId);
      continue;
    }
    if (action === "room lane") {
      cfg.defaultLane = readTextValue(sentence) ?? cfg.defaultLane;
      continue;
    }
    if (action === "mention gate") {
      const enabled = readBoolValue(sentence);
      if (enabled != null) cfg.mentionGate = enabled;
      continue;
    }
    if (action === "debug") {
      const enabled = readBoolValue(sentence);
      if (enabled != null) cfg.debug = enabled;
      continue;
    }
    if (action === "tool summary") {
      const enabled = readBoolValue(sentence);
      if (enabled != null) cfg.toolSummary = enabled;
      continue;
    }
    if (action === "dm tool summary") {
      const enabled = readBoolValue(sentence);
      if (enabled != null) cfg.dmToolSummary = enabled;
      continue;
    }
    if (action === "listeners") {
      cfg.listeners = readNameVector(sentence);
      continue;
    }
    if (parts.length >= 3 && parts.at(-1)?.toLowerCase() === "lane") {
      const roomId = parts.slice(1, -1).join(" ");
      const lane = readTextValue(sentence);
      if (!roomId || !lane) continue;
      cfg.roomLanes.set(roomId, lane);
      continue;
    }
    if (parts.length >= 3 && parts.at(-1)?.toLowerCase() === "listeners") {
      const roomId = parts.slice(1, -1).join(" ");
      const listeners = readNameVector(sentence);
      if (!roomId || !listeners.length) continue;
      cfg.roomListeners.set(roomId, listeners);
    }
  }

  const result = {};
  for (const [channelType, cfg] of channels.entries()) {
    result[channelType] = {
      ...cfg,
      rooms: cfg.rooms.map((roomId) => ({
        id: roomId,
        lane: cfg.roomLanes.get(roomId) ?? cfg.defaultLane ?? laneFromRoomId(channelType, roomId)
      })),
      dmRooms: [...cfg.dmRooms],
      executiveUsernames: [...cfg.executiveUsernames],
      listeners: Array.isArray(cfg.listeners) ? [...cfg.listeners] : [],
      roomListeners: Object.fromEntries(cfg.roomListeners.entries()),
      roomLanes: Object.fromEntries(cfg.roomLanes.entries())
    };
  }
  return result;
}

export async function loadChannelPolicy(agentHouse) {
  const policyPath = path.join(agentHouse, "conduct", "channels.pya");
  return loadChannelPolicyFromPath(policyPath);
}

export async function loadChannelPolicyFromPath(policyPath) {
  let text = "";
  try {
    text = await fs.readFile(policyPath, "utf8");
  } catch (err) {
    if (err?.code === "ENOENT") return {};
    throw err;
  }
  return parseChannelPolicyText(text);
}

function mergeChannelEntry(base = {}, override = {}) {
  const mergedRoomLaneMap = {
    ...(base.roomLanes ?? {}),
    ...(override.roomLanes ?? {})
  };
  const mergedRoomListeners = {
    ...(base.roomListeners ?? {}),
    ...(override.roomListeners ?? {})
  };
  const mergedRoomsById = new Map();
  for (const room of base.rooms ?? []) {
    if (!room?.id) continue;
    mergedRoomsById.set(room.id, { ...room });
  }
  for (const room of override.rooms ?? []) {
    if (!room?.id) continue;
    const prior = mergedRoomsById.get(room.id) ?? { id: room.id, lane: null };
    mergedRoomsById.set(room.id, {
      ...prior,
      ...room
    });
  }
  return {
    ...base,
    ...override,
    enabled: override.enabled ?? base.enabled ?? false,
    mode: override.mode ?? base.mode ?? "sync",
    longPollMs: override.longPollMs ?? base.longPollMs ?? null,
    appserviceRegistration: override.appserviceRegistration ?? base.appserviceRegistration ?? null,
    homeserver: override.homeserver ?? base.homeserver ?? null,
    user: override.user ?? base.user ?? null,
    token: override.token ?? base.token ?? null,
    registrationSharedSecret: override.registrationSharedSecret ?? base.registrationSharedSecret ?? null,
    adminToken: override.adminToken ?? base.adminToken ?? null,
    executiveUsernames: Array.from(new Set([...(base.executiveUsernames ?? []), ...(override.executiveUsernames ?? [])])),
    defaultLane: override.defaultLane ?? base.defaultLane ?? null,
    mentionGate: override.mentionGate ?? base.mentionGate ?? false,
    debug: override.debug ?? base.debug ?? false,
    toolSummary: override.toolSummary ?? base.toolSummary ?? false,
    dmToolSummary: override.dmToolSummary ?? base.dmToolSummary ?? false,
    listeners: Array.from(new Set([...(base.listeners ?? []), ...(override.listeners ?? [])])),
    dmRooms: Array.from(new Set([...(base.dmRooms ?? []), ...(override.dmRooms ?? [])])),
    roomListeners: mergedRoomListeners,
    roomLanes: mergedRoomLaneMap,
    rooms: Array.from(mergedRoomsById.values())
  };
}

export function mergeChannelPolicies(basePolicy = {}, overridePolicy = {}) {
  const channelTypes = new Set([
    ...Object.keys(basePolicy ?? {}),
    ...Object.keys(overridePolicy ?? {})
  ]);
  const out = {};
  for (const channelType of channelTypes) {
    out[channelType] = mergeChannelEntry(basePolicy[channelType], overridePolicy[channelType]);
  }
  return out;
}

export async function loadChannelPolicyWithGlobal({
  worldRoot,
  agentHouse
} = {}) {
  const globalPath = worldRoot ? path.join(worldRoot, "conduct", "channels.pya") : null;
  const [globalPolicy, agentPolicy] = await Promise.all([
    globalPath ? loadChannelPolicyFromPath(globalPath) : Promise.resolve({}),
    agentHouse ? loadChannelPolicy(agentHouse) : Promise.resolve({})
  ]);
  return mergeChannelPolicies(globalPolicy, agentPolicy);
}
