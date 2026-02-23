import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { appendChannelOutcome } from "./outcome.mjs";

function toBaseUrl(raw) {
  return String(raw ?? "").replace(/\/+$/g, "");
}

function isAppserviceMode(mode) {
  const value = String(mode ?? "").trim().toLowerCase();
  return value === "appservice" || value === "appservice-push";
}

function applyAuthToUrl(url, { token, userId, mode } = {}) {
  const text = String(url ?? "");
  if (!isAppserviceMode(mode)) return text;
  const parsed = new URL(text);
  if (token) parsed.searchParams.set("access_token", String(token));
  if (userId) parsed.searchParams.set("user_id", String(userId));
  return parsed.toString();
}

function authHeaders({ token, mode, headers = {} } = {}) {
  const next = { ...headers };
  if (!isAppserviceMode(mode) && token) {
    next.Authorization = `Bearer ${token}`;
  }
  return next;
}

function randomSuffix() {
  return crypto.randomBytes(4).toString("hex");
}

function sanitizeUsernamePart(raw) {
  return String(raw ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9._=-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "") || "agent";
}

function parseLocalpartFromUserId(user) {
  const text = String(user ?? "").trim();
  if (!text.startsWith("@")) return null;
  const idx = text.indexOf(":");
  if (idx === -1) return sanitizeUsernamePart(text.slice(1));
  return sanitizeUsernamePart(text.slice(1, idx));
}

function generateCredentials({ agentName, localpart, withSuffix = false }) {
  const userBase = sanitizeUsernamePart(localpart || agentName);
  const resolved = withSuffix ? `${userBase}_${randomSuffix()}` : userBase;
  const password = crypto.randomBytes(18).toString("base64url");
  return { localpart: resolved, password };
}

async function readTextFile(filePath) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (err) {
    if (err?.code === "ENOENT") return "";
    throw err;
  }
}

function authPath(agentHouse) {
  return path.join(agentHouse, "conduct", "matrix-auth.pya");
}

function legacyAuthPath(agentHouse) {
  return path.join(agentHouse, "conduct", "matrix-auth.json");
}

function quotePyashText(value) {
  const text = String(value ?? "");
  return `"${text.replace(/\\/g, "\\\\").replace(/"/g, "\\\"")}"`;
}

function unquotePyashText(value) {
  const text = String(value ?? "").trim();
  if (!(text.startsWith("\"") && text.endsWith("\""))) return text;
  const inner = text.slice(1, -1);
  return inner
    .replace(/\\\"/g, "\"")
    .replace(/\\\\/g, "\\");
}

function normalizeAuthCache(raw = {}) {
  const executiveDmRooms = {};
  for (const [key, value] of Object.entries(raw?.executiveDmRooms ?? {})) {
    const userId = String(key ?? "").trim();
    const roomId = String(value ?? "").trim();
    if (!userId || !roomId) continue;
    executiveDmRooms[userId] = roomId;
  }
  return {
    homeserver: String(raw?.homeserver ?? "").trim(),
    user: String(raw?.user ?? "").trim(),
    localpart: String(raw?.localpart ?? "").trim(),
    password: String(raw?.password ?? "").trim(),
    accessToken: String(raw?.accessToken ?? "").trim(),
    deviceId: raw?.deviceId == null ? null : String(raw.deviceId).trim(),
    executiveDmRooms
  };
}

function parseMatrixAuthPyash(text = "") {
  const cache = normalizeAuthCache({});
  const dmPattern = /su name executive dm room for name ("(?:[^"\\]|\\.)*") ob text ("(?:[^"\\]|\\.)*") ya/gi;
  for (const match of String(text).matchAll(dmPattern)) {
    const userId = unquotePyashText(match[1]);
    const roomId = unquotePyashText(match[2]);
    if (!userId || !roomId) continue;
    cache.executiveDmRooms[userId] = roomId;
  }

  const fieldPattern = /su name (homeserver|user|localpart|password|access token|device id) ob text ("(?:[^"\\]|\\.)*") ya/gi;
  for (const match of String(text).matchAll(fieldPattern)) {
    const key = String(match[1] ?? "").trim().toLowerCase();
    const value = unquotePyashText(match[2]);
    if (key === "homeserver") cache.homeserver = value;
    else if (key === "user") cache.user = value;
    else if (key === "localpart") cache.localpart = value;
    else if (key === "password") cache.password = value;
    else if (key === "access token") cache.accessToken = value;
    else if (key === "device id") cache.deviceId = value;
  }
  return cache;
}

function renderMatrixAuthPyash(raw = {}) {
  const cache = normalizeAuthCache(raw);
  const lines = ["# managed by pyash matrix auth cache"];
  if (cache.homeserver) lines.push(`su name homeserver ob text ${quotePyashText(cache.homeserver)} ya`);
  if (cache.user) lines.push(`su name user ob text ${quotePyashText(cache.user)} ya`);
  if (cache.localpart) lines.push(`su name localpart ob text ${quotePyashText(cache.localpart)} ya`);
  if (cache.password) lines.push(`su name password ob text ${quotePyashText(cache.password)} ya`);
  if (cache.accessToken) lines.push(`su name access token ob text ${quotePyashText(cache.accessToken)} ya`);
  if (cache.deviceId) lines.push(`su name device id ob text ${quotePyashText(cache.deviceId)} ya`);
  for (const [userId, roomId] of Object.entries(cache.executiveDmRooms)) {
    lines.push(`su name executive dm room for name ${quotePyashText(userId)} ob text ${quotePyashText(roomId)} ya`);
  }
  return `${lines.join("\n")}\n`;
}

export async function writeMatrixAuthCache(agentHouse, value) {
  if (!agentHouse) throw new Error("writeMatrixAuthCache requires agentHouse");
  const filePath = authPath(agentHouse);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, renderMatrixAuthPyash(value), "utf8");
}

function sanitizeUserId(raw, homeserver) {
  const text = String(raw ?? "").trim();
  if (!text) return null;
  if (text.startsWith("@")) return text;
  if (!text.includes(":")) return `@${text}:${homeserver.replace(/^https?:\/\//, "")}`;
  return `@${text}`;
}

function normalizeConfiguredUserId(raw, homeserver) {
  const text = String(raw ?? "").trim();
  if (!text) return null;
  return sanitizeUserId(text, homeserver);
}

function userIdsMatch(a, b) {
  const left = String(a ?? "").trim().toLowerCase();
  const right = String(b ?? "").trim().toLowerCase();
  return Boolean(left && right && left === right);
}

function shortError(err) {
  return String(err?.message ?? err ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

async function matrixWhoAmI({ homeserver, token, fetchImpl, userId = "", mode = "" }) {
  const response = await fetchImpl(
    applyAuthToUrl(`${homeserver}/_matrix/client/v3/account/whoami`, { token, userId, mode }),
    {
      method: "GET",
      headers: authHeaders({ token, mode })
    }
  );
  if (!response.ok) {
    throw new Error(`matrix whoami failed: status=${response.status}`);
  }
  const payload = await response.json().catch(() => ({}));
  const resolvedUserId = String(payload?.user_id ?? "").trim();
  return resolvedUserId || null;
}

async function resolveTokenUserId({
  homeserver,
  token,
  preferredUser,
  mode,
  fetchImpl
}) {
  const normalizedPreferred = normalizeConfiguredUserId(preferredUser, homeserver);
  try {
    const resolved = await matrixWhoAmI({
      homeserver,
      token,
      userId: normalizedPreferred || "",
      mode,
      fetchImpl
    });
    if (!resolved) {
      return {
        userId: isAppserviceMode(mode) ? normalizedPreferred : null,
        reason: "empty"
      };
    }
    if (normalizedPreferred && !isAppserviceMode(mode) && !userIdsMatch(resolved, normalizedPreferred)) {
      return { userId: null, reason: "mismatch" };
    }
    return { userId: resolved, reason: "ok" };
  } catch {
    return {
      userId: isAppserviceMode(mode) ? normalizedPreferred : null,
      reason: "unreachable"
    };
  }
}

async function registerWithSharedSecret({
  homeserver,
  sharedSecret,
  localpart,
  password,
  fetchImpl
}) {
  const nonceRes = await fetchImpl(`${homeserver}/_synapse/admin/v1/register`, { method: "GET" });
  if (!nonceRes.ok) {
    throw new Error(`matrix register nonce failed: status=${nonceRes.status}`);
  }
  const noncePayload = await nonceRes.json();
  const nonce = noncePayload?.nonce;
  if (!nonce) throw new Error("matrix register nonce missing");

  const mac = crypto
    .createHmac("sha1", String(sharedSecret))
    .update(String(nonce))
    .update("\0")
    .update(String(localpart))
    .update("\0")
    .update(String(password))
    .update("\0")
    .update("notadmin")
    .digest("hex");

  const regRes = await fetchImpl(`${homeserver}/_synapse/admin/v1/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      nonce,
      username: localpart,
      password,
      admin: false,
      mac
    })
  });
  if (!regRes.ok) {
    const errorPayload = await regRes.json().catch(() => ({}));
    return {
      ok: false,
      status: regRes.status,
      code: String(errorPayload?.errcode ?? ""),
      error: String(errorPayload?.error ?? "")
    };
  }
  const payload = await regRes.json().catch(() => ({}));
  return { ok: true, payload };
}

async function loginPassword({
  homeserver,
  user,
  password,
  fetchImpl
}) {
  const response = await fetchImpl(`${homeserver}/_matrix/client/v3/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "m.login.password",
      identifier: {
        type: "m.id.user",
        user
      },
      password
    })
  });
  if (!response.ok) {
    throw new Error(`matrix login failed: status=${response.status}`);
  }
  return response.json();
}

async function readDirectRoomFromAccountData({
  homeserver,
  token,
  userId,
  executiveUserId,
  mode,
  fetchImpl
}) {
  if (!userId || !executiveUserId) return null;
  const encodedUser = encodeURIComponent(String(userId));
  const url = applyAuthToUrl(
    `${homeserver}/_matrix/client/v3/user/${encodedUser}/account_data/m.direct`,
    { token, userId, mode }
  );
  const response = await fetchImpl(url, {
    method: "GET",
    headers: authHeaders({ token, mode })
  });
  if (!response.ok) return null;
  const payload = await response.json().catch(() => ({}));
  const roomIds = payload?.[executiveUserId];
  if (!Array.isArray(roomIds) || roomIds.length === 0) return null;
  const roomId = roomIds.find((id) => typeof id === "string" && id.startsWith("!"));
  return roomId ?? null;
}

async function createDirectRoom({
  homeserver,
  token,
  executiveUserId,
  mode,
  actingUserId,
  fetchImpl
}) {
  const url = applyAuthToUrl(
    `${homeserver}/_matrix/client/v3/createRoom`,
    { token, userId: actingUserId, mode }
  );
  const response = await fetchImpl(url, {
    method: "POST",
    headers: authHeaders({ token, mode, headers: { "Content-Type": "application/json" } }),
    body: JSON.stringify({
      is_direct: true,
      invite: [executiveUserId],
      preset: "trusted_private_chat"
    })
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(`matrix create direct room failed: status=${response.status} code=${payload?.errcode ?? ""} error=${payload?.error ?? ""}`);
  }
  const payload = await response.json().catch(() => ({}));
  const roomId = payload?.room_id;
  if (!roomId) throw new Error("matrix create direct room missing room_id");
  return String(roomId);
}

async function fetchJoinedRoomSet({
  homeserver,
  token,
  userId,
  mode,
  fetchImpl
}) {
  const url = applyAuthToUrl(
    `${homeserver}/_matrix/client/v3/joined_rooms`,
    { token, userId, mode }
  );
  const response = await fetchImpl(url, {
    method: "GET",
    headers: authHeaders({ token, mode })
  });
  if (!response.ok) return null;
  const payload = await response.json().catch(() => ({}));
  const values = Array.isArray(payload?.joined_rooms) ? payload.joined_rooms : [];
  return new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean));
}

function envSharedSecret() {
  return process.env.MATRIX_REGISTRATION_SHARED_SECRET ?? process.env.PYA_MATRIX_REGISTRATION_SHARED_SECRET ?? null;
}

function envAdminToken() {
  return process.env.MATRIX_ADMIN_TOKEN ?? process.env.PYA_MATRIX_ADMIN_TOKEN ?? null;
}

function envHomeserver() {
  return process.env.MATRIX_HOMESERVER ?? process.env.PYA_MATRIX_HOMESERVER ?? null;
}

export async function readMatrixAuthCache(agentHouse) {
  if (!agentHouse) return null;
  const text = await readTextFile(authPath(agentHouse));
  if (String(text).trim()) return parseMatrixAuthPyash(text);
  const legacyText = await readTextFile(legacyAuthPath(agentHouse));
  if (!String(legacyText).trim()) return null;
  let legacy = null;
  try {
    legacy = JSON.parse(legacyText);
  } catch {
    return null;
  }
  const migrated = normalizeAuthCache(legacy);
  await writeMatrixAuthCache(agentHouse, migrated);
  await fs.rm(legacyAuthPath(agentHouse), { force: true }).catch(() => {});
  return migrated;
}

export async function ensureMatrixCredentials({
  agentName,
  agentHouse,
  config,
  fetchImpl = globalThis.fetch
}) {
  if (!agentName) throw new Error("ensureMatrixCredentials requires agentName");
  if (!agentHouse) throw new Error("ensureMatrixCredentials requires agentHouse");
  if (typeof fetchImpl !== "function") throw new Error("ensureMatrixCredentials requires fetch");
  const report = async ({ stage = "status", outcome = "success", message = "" } = {}) => {
    try {
      await appendChannelOutcome(agentHouse, {
        channelType: "matrix",
        agentName,
        area: "credentials",
        stage,
        outcome,
        message
      });
    } catch {
      // non-blocking debug log
    }
  };

  try {
    const homeserver = toBaseUrl(config?.homeserver ?? envHomeserver());
    if (!homeserver) throw new Error("matrix homeserver missing");
    const authMode = String(config?.authMode ?? "").trim().toLowerCase();

    const cached = await readMatrixAuthCache(agentHouse);
    const desiredUserFromConfig = config?.user ? String(config.user) : null;
    const desiredUserNormalized = normalizeConfiguredUserId(desiredUserFromConfig, homeserver);
    const mode = config?.mode ? String(config.mode) : "";
    if (cached?.accessToken && authMode !== "password") {
    if (isAppserviceMode(mode) && desiredUserNormalized) {
      const resolvedLocalpart = cached.localpart
        ?? parseLocalpartFromUserId(desiredUserNormalized)
        ?? null;
      if (!userIdsMatch(cached.user, desiredUserNormalized)) {
        await writeMatrixAuthCache(agentHouse, {
          ...cached,
          homeserver,
          user: desiredUserNormalized,
          localpart: resolvedLocalpart,
          executiveDmRooms: {}
        });
      }
      const resolved = {
        homeserver,
        token: cached.accessToken,
        user: desiredUserNormalized,
        localpart: resolvedLocalpart,
        executiveDmRooms: userIdsMatch(cached.user, desiredUserNormalized)
          ? (cached?.executiveDmRooms ?? {})
          : {}
      };
      await report({ stage: "cache_appservice", outcome: "success", message: "cached token active for configured appservice user" });
      return resolved;
    }

    const requireTokenUserValidation = Boolean(desiredUserNormalized) && !isAppserviceMode(mode);
    let preferredUser = desiredUserNormalized ?? cached.user;
    let resolvedCachedUser = normalizeConfiguredUserId(cached.user, homeserver);
    let resolvedCachedReason = "ok";
    if (requireTokenUserValidation || !resolvedCachedUser) {
      const resolved = await resolveTokenUserId({
        homeserver,
        token: cached.accessToken,
        preferredUser,
        mode,
        fetchImpl
      });
      resolvedCachedUser = resolved.userId;
      resolvedCachedReason = resolved.reason;
    }
    if (requireTokenUserValidation && !resolvedCachedUser) {
      if (resolvedCachedReason === "mismatch") {
        // Cached token belongs to a different user; continue with login/register flow.
      } else {
      const fallbackUser = desiredUserNormalized || cached.user || null;
        const resolved = {
          homeserver,
          token: cached.accessToken,
          user: fallbackUser,
        localpart: cached.localpart
          ?? parseLocalpartFromUserId(fallbackUser)
          ?? null,
          executiveDmRooms: cached?.executiveDmRooms ?? {}
        };
        await report({ stage: "cache_fallback", outcome: "success", message: "cached token used while whoami unavailable" });
        return resolved;
      }
    } else {
      const resolvedLocalpart = cached.localpart
        ?? parseLocalpartFromUserId(resolvedCachedUser)
        ?? null;
      if (resolvedCachedUser && !userIdsMatch(resolvedCachedUser, cached.user)) {
        await writeMatrixAuthCache(agentHouse, {
          ...cached,
          homeserver,
          user: resolvedCachedUser,
          localpart: resolvedLocalpart,
          executiveDmRooms: {}
        });
      }
      const resolved = {
        homeserver,
        token: cached.accessToken,
        user: resolvedCachedUser,
        localpart: resolvedLocalpart,
        executiveDmRooms: cached?.executiveDmRooms ?? {}
      };
      await report({ stage: "cache", outcome: "success", message: "cached token accepted" });
      return resolved;
    }
  }

  if (config?.token && authMode !== "password") {
    if (isAppserviceMode(mode) && desiredUserNormalized) {
      await writeMatrixAuthCache(agentHouse, {
        ...(cached ?? {}),
        homeserver,
        user: desiredUserNormalized,
        localpart: parseLocalpartFromUserId(desiredUserNormalized),
        accessToken: config.token,
        executiveDmRooms: cached?.executiveDmRooms ?? {}
      });
      const resolved = {
        homeserver,
        token: config.token,
        user: desiredUserNormalized,
        localpart: parseLocalpartFromUserId(desiredUserNormalized),
        executiveDmRooms: cached?.executiveDmRooms ?? {}
      };
      await report({ stage: "config_token_appservice", outcome: "success", message: "configured token accepted for appservice user" });
      return resolved;
    }

    const requireTokenUserValidation = Boolean(desiredUserNormalized) && !isAppserviceMode(mode);
    let resolvedTokenUser = desiredUserNormalized ?? null;
    let resolvedTokenReason = "ok";
    if (requireTokenUserValidation || !resolvedTokenUser) {
      const resolved = await resolveTokenUserId({
        homeserver,
        token: config.token,
        preferredUser: desiredUserNormalized,
        mode,
        fetchImpl
      });
      resolvedTokenUser = resolved.userId;
      resolvedTokenReason = resolved.reason;
    }
    if (!requireTokenUserValidation || resolvedTokenUser) {
      if (resolvedTokenUser) {
        await writeMatrixAuthCache(agentHouse, {
          ...(cached ?? {}),
          homeserver,
          user: resolvedTokenUser,
          localpart: parseLocalpartFromUserId(resolvedTokenUser),
          accessToken: config.token,
          executiveDmRooms: cached?.executiveDmRooms ?? {}
        });
      }
      const resolved = {
        homeserver,
        token: config.token,
        user: resolvedTokenUser,
        localpart: parseLocalpartFromUserId(resolvedTokenUser),
        executiveDmRooms: cached?.executiveDmRooms ?? {}
      };
      await report({ stage: "config_token", outcome: "success", message: "configured token accepted" });
      return resolved;
    }
    if (resolvedTokenReason === "mismatch") {
      // Token exists but cannot be used for the configured user in non-appservice mode.
    } else {
    const fallbackUser = desiredUserNormalized || cached?.user || null;
    const resolved = {
      homeserver,
      token: config.token,
      user: fallbackUser,
      localpart: parseLocalpartFromUserId(fallbackUser),
      executiveDmRooms: cached?.executiveDmRooms ?? {}
    };
    await report({ stage: "config_token_fallback", outcome: "success", message: "configured token used while whoami unavailable" });
    return resolved;
    }
    // Token exists but cannot be used for the configured user in non-appservice mode.
  }

  const sharedSecret = authMode === "password"
    ? null
    : (config?.registrationSharedSecret ?? envSharedSecret());
  const _adminToken = config?.adminToken ?? envAdminToken();
  const userFromConfig = desiredUserFromConfig;

  let localpart = parseLocalpartFromUserId(userFromConfig) ?? sanitizeUsernamePart(userFromConfig ?? agentName);
  const configuredPassword = typeof config?.password === "string"
    ? String(config.password).trim()
    : "";
  let password = configuredPassword || null;
  if (!password && cached?.localpart && cached?.password) {
    if (!userFromConfig || cached.user === userFromConfig || cached.localpart === localpart) {
      localpart = cached.localpart;
      password = cached.password;
    }
  }
  if (!password) {
    const generated = generateCredentials({ agentName, localpart, withSuffix: false });
    localpart = generated.localpart;
    password = generated.password;
  }

    if (sharedSecret) {
    let registerResult = await registerWithSharedSecret({
      homeserver,
      sharedSecret,
      localpart,
      password,
      fetchImpl
    });
    if (!registerResult.ok && (
      registerResult.status === 409 ||
      registerResult.code === "M_USER_IN_USE" ||
      /in use/i.test(registerResult.error)
    )) {
      const canReuseExistingUser = Boolean(cached?.password) && (
        !userFromConfig ||
        cached.user === userFromConfig ||
        cached.localpart === localpart
      );
      if (canReuseExistingUser) {
        // Deterministic path: user already exists and we have reusable credentials.
        registerResult = { ok: true, payload: null };
      } else if (!userFromConfig) {
        // No explicit user requested: allow suffix fallback for first-time bootstrap collisions.
        const generated = generateCredentials({ agentName, localpart, withSuffix: true });
        localpart = generated.localpart;
        password = generated.password;
        registerResult = await registerWithSharedSecret({
          homeserver,
          sharedSecret,
          localpart,
          password,
          fetchImpl
        });
        if (!registerResult.ok) {
          throw new Error(`matrix register failed: status=${registerResult.status} code=${registerResult.code} error=${registerResult.error}`);
        }
      } else {
          throw new Error("matrix user already exists; reuse cached token or configure token/password for this user");
      }
    } else if (!registerResult.ok) {
      throw new Error(`matrix register failed: status=${registerResult.status} code=${registerResult.code} error=${registerResult.error}`);
    }
  }
  const resolvedLoginUser = (userFromConfig && userFromConfig.startsWith("@"))
    ? (parseLocalpartFromUserId(userFromConfig) === localpart
      ? userFromConfig
      : `@${localpart}:${String(userFromConfig).split(":").slice(1).join(":") || homeserver.replace(/^https?:\/\//, "")}`)
    : localpart;

    const loginPayload = await loginPassword({
    homeserver,
    user: resolvedLoginUser,
    password,
    fetchImpl
  });
  const accessToken = loginPayload?.access_token;
  if (!accessToken) throw new Error("matrix login missing access token");
  const resolvedUser = loginPayload?.user_id ?? resolvedLoginUser;
  const record = {
    homeserver,
    user: resolvedUser,
    localpart,
    password,
    accessToken,
    deviceId: loginPayload?.device_id ?? null,
    executiveDmRooms: cached?.executiveDmRooms ?? {}
  };
    await writeMatrixAuthCache(agentHouse, record);
    const resolved = {
      homeserver,
      token: accessToken,
      user: resolvedUser,
      localpart,
      executiveDmRooms: record.executiveDmRooms
    };
    await report({ stage: "password_login", outcome: "success", message: "password flow token issued and cached" });
    return resolved;
  } catch (err) {
    await report({ stage: "defect", outcome: "fail", message: shortError(err) || "credential flow defective" });
    throw err;
  }
}

export async function ensureMatrixExecutiveDmRoom({
  agentHouse,
  homeserver,
  token,
  user,
  mode = "",
  executiveUser,
  fetchImpl = globalThis.fetch
}) {
  if (!agentHouse) throw new Error("ensureMatrixExecutiveDmRoom requires agentHouse");
  if (!homeserver || !token) throw new Error("ensureMatrixExecutiveDmRoom requires homeserver/token");
  if (typeof fetchImpl !== "function") throw new Error("ensureMatrixExecutiveDmRoom requires fetch");
  const report = async ({ stage = "status", outcome = "success", message = "" } = {}) => {
    try {
      await appendChannelOutcome(agentHouse, {
        channelType: "matrix",
        agentName: parseLocalpartFromUserId(user) || "agent",
        area: "executive_dm",
        stage,
        outcome,
        message
      });
    } catch {
      // non-blocking debug log
    }
  };

  const executiveUserId = sanitizeUserId(executiveUser, homeserver);
  if (!executiveUserId) return null;

  try {
    const cached = await readMatrixAuthCache(agentHouse);
    const cachedRoom = cached?.executiveDmRooms?.[executiveUserId];
    let joinedRooms = null;
    if (typeof cachedRoom === "string" && cachedRoom.startsWith("!")) {
      try {
        joinedRooms = await fetchJoinedRoomSet({
          homeserver,
          token,
          userId: user,
          mode,
          fetchImpl
        });
        if (!joinedRooms || joinedRooms.has(cachedRoom)) {
          await report({ stage: "cache", outcome: "success", message: `reused cached room ${cachedRoom}` });
          return cachedRoom;
        }
      } catch {
        await report({ stage: "cache_fallback", outcome: "success", message: `reused cached room ${cachedRoom} while joined_rooms unavailable` });
        return cachedRoom;
      }
    } else {
      joinedRooms = await fetchJoinedRoomSet({
        homeserver,
        token,
        userId: user,
        mode,
        fetchImpl
      });
    }

    const directRoom = await readDirectRoomFromAccountData({
    homeserver,
    token,
    userId: user,
    executiveUserId,
    mode,
    fetchImpl
  });
    if (directRoom && (!joinedRooms || joinedRooms.has(directRoom))) {
      const next = {
      ...(cached ?? {}),
      homeserver,
      user,
      accessToken: token,
      executiveDmRooms: {
        ...(cached?.executiveDmRooms ?? {}),
        [executiveUserId]: directRoom
      }
    };
      await writeMatrixAuthCache(agentHouse, next);
      await report({ stage: "account_data", outcome: "success", message: `resolved direct room ${directRoom}` });
      return directRoom;
    }

    const createdRoom = await createDirectRoom({
    homeserver,
    token,
    executiveUserId,
    mode,
    actingUserId: user,
    fetchImpl
  });
    const next = {
    ...(cached ?? {}),
    homeserver,
    user,
    accessToken: token,
    executiveDmRooms: {
      ...(cached?.executiveDmRooms ?? {}),
      [executiveUserId]: createdRoom
    }
  };
    await writeMatrixAuthCache(agentHouse, next);
    await report({ stage: "create_room", outcome: "success", message: `created direct room ${createdRoom}` });
    return createdRoom;
  } catch (err) {
    await report({ stage: "defect", outcome: "fail", message: shortError(err) || "executive dm bootstrap defective" });
    throw err;
  }
}
