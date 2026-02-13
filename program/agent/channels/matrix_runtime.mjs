import { resolveConfigMapText } from "../../configure/env.mjs";
import {
  ensureMatrixCredentials,
  ensureMatrixExecutiveDmRoom,
  readMatrixAuthCache
} from "./bootstrap.mjs";
import { worldRootFromAgentHouse } from "../newspaper_log.mjs";
import {
  loadChannelCalendarPolicyWithGlobal,
  resolveChannelCalendarSetting
} from "./calendar_policy.mjs";

function homeserverHost(homeserver) {
  const text = String(homeserver ?? "").trim();
  if (!text) return "";
  try {
    return new URL(text).host.toLowerCase();
  } catch {
    return text.replace(/^https?:\/\//i, "").replace(/\/.*$/g, "").toLowerCase();
  }
}

function normalizeMatrixLocalpart(raw) {
  return String(raw ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9._=-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizeMatrixUserIdentity(raw, homeserver = "") {
  const text = String(raw ?? "").trim();
  if (!text) return "";
  const host = homeserverHost(homeserver);
  const withAt = text.startsWith("@") ? text : `@${text}`;
  const lower = withAt.toLowerCase();
  const body = lower.slice(1);
  const idx = body.indexOf(":");
  const localpart = normalizeMatrixLocalpart(idx === -1 ? body : body.slice(0, idx));
  if (!localpart) return "";
  const server = idx === -1 ? host : body.slice(idx + 1).trim().toLowerCase();
  return server ? `@${localpart}:${server}` : `@${localpart}`;
}

function matrixUsersMatch(a, b, homeserver = "") {
  const left = normalizeMatrixUserIdentity(a, homeserver);
  const right = normalizeMatrixUserIdentity(b, homeserver);
  return Boolean(left && right && left === right);
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

export function resolveMatrixConfigWithMap(rawConfig = {}) {
  const mapName = "matrix channel";
  const mapHomeserver = resolveConfigMapText(mapName, "homeserver");
  const mapAppserviceRegistration =
    resolveConfigMapText(mapName, "bridge service file")
    ?? resolveConfigMapText(mapName, "appservice registration");
  const mapUser = resolveConfigMapText(mapName, "user");
  const mapSharedSecret = resolveConfigMapText(mapName, "registration shared secret");
  const mapAdminToken = resolveConfigMapText(mapName, "admin token");
  const mapToken = resolveConfigMapText(mapName, "token");

  const homeserver = rawConfig.homeserver ?? mapHomeserver ?? null;
  const user = rawConfig.user ?? mapUser ?? null;
  const allowGlobalToken = !mapToken
    ? false
    : !mapUser || matrixUsersMatch(user, mapUser, homeserver || "");
  return {
    ...rawConfig,
    mode: rawConfig.mode ?? null,
    longPollMs: rawConfig.longPollMs ?? null,
    appserviceRegistration: rawConfig.appserviceRegistration ?? mapAppserviceRegistration ?? null,
    homeserver,
    user,
    registrationSharedSecret: rawConfig.registrationSharedSecret ?? mapSharedSecret ?? null,
    adminToken: rawConfig.adminToken ?? mapAdminToken ?? null,
    token: rawConfig.token ?? (allowGlobalToken ? mapToken : null) ?? null
  };
}

export function normalizeExecutiveUsernames(channelConfig = {}) {
  const ordered = [];
  const seen = new Set();
  const pushValue = (value) => {
    const text = String(value ?? "").trim();
    if (!text || seen.has(text)) return;
    seen.add(text);
    ordered.push(text);
  };
  for (const value of Array.isArray(channelConfig?.executiveUsernames) ? channelConfig.executiveUsernames : []) {
    pushValue(value);
  }
  if (channelConfig?.executiveUsername) pushValue(channelConfig.executiveUsername);
  return ordered;
}

export function mergeMatrixDmRooms({ channelConfig, dmRoomIds = [], channelType = "matrix" }) {
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

export async function hydrateMatrixRuntimeConfig({
  channelConfig = {},
  agentName,
  agentHouse,
  channelType = "matrix",
  includeAuthCache = true
} = {}) {
  let nextConfig = resolveMatrixConfigWithMap(channelConfig);
  if (channelType === "matrix" && agentHouse) {
    try {
      const worldRoot = worldRootFromAgentHouse(agentHouse);
      const calendarPolicy = await loadChannelCalendarPolicyWithGlobal({
        worldRoot,
        agentHouse,
        agentName
      });
      const calendarSetting = resolveChannelCalendarSetting(calendarPolicy, {
        channelType,
        agentName
      });
      if (calendarSetting.hasLongPollMs) {
        nextConfig = {
          ...nextConfig,
          longPollMs: calendarSetting.longPollMs
        };
      }
    } catch {
      // Keep runtime resilient if calendar policy parsing fails.
    }
  }
  const credentials = await ensureMatrixCredentials({
    agentName,
    agentHouse,
    config: nextConfig
  });
  nextConfig = {
    ...nextConfig,
    homeserver: credentials.homeserver,
    token: credentials.token,
    user: nextConfig.user ?? credentials.user
  };

  const executiveUsers = normalizeExecutiveUsernames(nextConfig);
  const dmBootstrapErrors = [];
  const discoveredDmRoomIds = [];
  if (executiveUsers.length && nextConfig.token && nextConfig.user) {
    for (const executiveUser of executiveUsers) {
      try {
        const dmRoomId = await ensureMatrixExecutiveDmRoom({
          agentHouse,
          homeserver: nextConfig.homeserver,
          token: nextConfig.token,
          user: nextConfig.user,
          mode: nextConfig.mode,
          executiveUser
        });
        if (dmRoomId) discoveredDmRoomIds.push(dmRoomId);
      } catch (err) {
        dmBootstrapErrors.push({
          executiveUser,
          error: String(err?.message ?? err)
        });
      }
    }
  }

  if (includeAuthCache) {
    const authCache = await readMatrixAuthCache(agentHouse);
    const cachedDmRoomIds = Object.values(authCache?.executiveDmRooms ?? {})
      .map((roomId) => String(roomId ?? "").trim())
      .filter((roomId) => roomId.startsWith("!"));
    discoveredDmRoomIds.push(...cachedDmRoomIds);
  }

  if (discoveredDmRoomIds.length) {
    nextConfig = mergeMatrixDmRooms({
      channelConfig: nextConfig,
      dmRoomIds: discoveredDmRoomIds,
      channelType
    });
  }

  return {
    channelConfig: nextConfig,
    executiveUsers,
    dmRoomIds: Array.from(new Set(discoveredDmRoomIds)),
    dmBootstrapErrors
  };
}
