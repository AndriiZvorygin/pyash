import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

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

async function readJsonFile(filePath, fallback) {
  try {
    const text = await fs.readFile(filePath, "utf8");
    return JSON.parse(text);
  } catch (err) {
    if (err?.code === "ENOENT") return fallback;
    throw err;
  }
}

async function writeJsonFile(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(value, null, 2) + "\n", "utf8");
}

function authPath(agentHouse) {
  return path.join(agentHouse, "conduct", "matrix-auth.json");
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
    if (!resolved) return isAppserviceMode(mode) ? normalizedPreferred : null;
    if (normalizedPreferred && !isAppserviceMode(mode) && !userIdsMatch(resolved, normalizedPreferred)) {
      return null;
    }
    return resolved;
  } catch {
    return isAppserviceMode(mode) ? normalizedPreferred : null;
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
  return readJsonFile(authPath(agentHouse), null);
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

  const homeserver = toBaseUrl(config?.homeserver ?? envHomeserver());
  if (!homeserver) throw new Error("matrix homeserver missing");

  const cached = await readMatrixAuthCache(agentHouse);
  const desiredUserFromConfig = config?.user ? String(config.user) : null;
  const desiredUserNormalized = normalizeConfiguredUserId(desiredUserFromConfig, homeserver);
  const mode = config?.mode ? String(config.mode) : "";
  if (cached?.accessToken) {
    if (isAppserviceMode(mode) && desiredUserNormalized) {
      const resolvedLocalpart = cached.localpart
        ?? parseLocalpartFromUserId(desiredUserNormalized)
        ?? null;
      if (!userIdsMatch(cached.user, desiredUserNormalized)) {
        await writeJsonFile(authPath(agentHouse), {
          ...cached,
          homeserver,
          user: desiredUserNormalized,
          localpart: resolvedLocalpart,
          executiveDmRooms: {}
        });
      }
      return {
        homeserver,
        token: cached.accessToken,
        user: desiredUserNormalized,
        localpart: resolvedLocalpart,
        executiveDmRooms: userIdsMatch(cached.user, desiredUserNormalized)
          ? (cached?.executiveDmRooms ?? {})
          : {}
      };
    }

    const requireTokenUserValidation = Boolean(desiredUserNormalized) && !isAppserviceMode(mode);
    let preferredUser = desiredUserNormalized ?? cached.user;
    let resolvedCachedUser = normalizeConfiguredUserId(cached.user, homeserver);
    if (requireTokenUserValidation || !resolvedCachedUser) {
      resolvedCachedUser = await resolveTokenUserId({
        homeserver,
        token: cached.accessToken,
        preferredUser,
        mode,
        fetchImpl
      });
    }
    if (requireTokenUserValidation && !resolvedCachedUser) {
      // Cached token is stale or belongs to a different user; continue with login/register flow.
    } else {
      const resolvedLocalpart = cached.localpart
        ?? parseLocalpartFromUserId(resolvedCachedUser)
        ?? null;
      if (resolvedCachedUser && !userIdsMatch(resolvedCachedUser, cached.user)) {
        await writeJsonFile(authPath(agentHouse), {
          ...cached,
          homeserver,
          user: resolvedCachedUser,
          localpart: resolvedLocalpart,
          executiveDmRooms: {}
        });
      }
      return {
        homeserver,
        token: cached.accessToken,
        user: resolvedCachedUser,
        localpart: resolvedLocalpart,
        executiveDmRooms: cached?.executiveDmRooms ?? {}
      };
    }
  }

  if (config?.token) {
    if (isAppserviceMode(mode) && desiredUserNormalized) {
      await writeJsonFile(authPath(agentHouse), {
        ...(cached ?? {}),
        homeserver,
        user: desiredUserNormalized,
        localpart: parseLocalpartFromUserId(desiredUserNormalized),
        accessToken: config.token,
        executiveDmRooms: cached?.executiveDmRooms ?? {}
      });
      return {
        homeserver,
        token: config.token,
        user: desiredUserNormalized,
        localpart: parseLocalpartFromUserId(desiredUserNormalized),
        executiveDmRooms: cached?.executiveDmRooms ?? {}
      };
    }

    const requireTokenUserValidation = Boolean(desiredUserNormalized) && !isAppserviceMode(mode);
    let resolvedTokenUser = desiredUserNormalized ?? null;
    if (requireTokenUserValidation || !resolvedTokenUser) {
      resolvedTokenUser = await resolveTokenUserId({
        homeserver,
        token: config.token,
        preferredUser: desiredUserNormalized,
        mode,
        fetchImpl
      });
    }
    if (!requireTokenUserValidation || resolvedTokenUser) {
      if (resolvedTokenUser) {
        await writeJsonFile(authPath(agentHouse), {
          ...(cached ?? {}),
          homeserver,
          user: resolvedTokenUser,
          localpart: parseLocalpartFromUserId(resolvedTokenUser),
          accessToken: config.token,
          executiveDmRooms: cached?.executiveDmRooms ?? {}
        });
      }
      return {
        homeserver,
        token: config.token,
        user: resolvedTokenUser,
        localpart: parseLocalpartFromUserId(resolvedTokenUser),
        executiveDmRooms: cached?.executiveDmRooms ?? {}
      };
    }
    // Token exists but cannot be used for the configured user in non-appservice mode.
  }

  const sharedSecret = config?.registrationSharedSecret ?? envSharedSecret();
  const _adminToken = config?.adminToken ?? envAdminToken();
  const userFromConfig = desiredUserFromConfig;

  let localpart = parseLocalpartFromUserId(userFromConfig) ?? sanitizeUsernamePart(userFromConfig ?? agentName);
  let password = null;
  if (cached?.localpart && cached?.password) {
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
  await writeJsonFile(authPath(agentHouse), record);
  return {
    homeserver,
    token: accessToken,
    user: resolvedUser,
    localpart,
    executiveDmRooms: record.executiveDmRooms
  };
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

  const executiveUserId = sanitizeUserId(executiveUser, homeserver);
  if (!executiveUserId) return null;

  const cached = await readJsonFile(authPath(agentHouse), null);
  const joinedRooms = await fetchJoinedRoomSet({
    homeserver,
    token,
    userId: user,
    mode,
    fetchImpl
  });
  const cachedRoom = cached?.executiveDmRooms?.[executiveUserId];
  if (
    typeof cachedRoom === "string"
    && cachedRoom.startsWith("!")
    && (!joinedRooms || joinedRooms.has(cachedRoom))
  ) {
    return cachedRoom;
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
    await writeJsonFile(authPath(agentHouse), next);
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
  await writeJsonFile(authPath(agentHouse), next);
  return createdRoom;
}
