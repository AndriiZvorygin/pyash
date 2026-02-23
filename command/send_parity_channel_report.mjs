#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, remember } from "../program/remember/index.mjs";
import { builtInSignatures } from "../program/verbs/index.mjs";
import { registerSignatureHandler, clearSignatureHandlers } from "../program/bridge/signature.mjs";
import { ensureAgentDirs, resolveAgentHouse } from "../program/agent/session.mjs";
import { loadChannelPolicyWithGlobal } from "../program/agent/channels/policy.mjs";
import { ensureMatrixCredentials } from "../program/agent/channels/bootstrap.mjs";
import { createMatrixAdapter } from "../program/agent/channels/matrix.mjs";
import { loadDefaultConfig } from "./run_pya_helpers.mjs";
import { resolveConfigMapText } from "../program/configure/env.mjs";

function parseArgValue(flag) {
  const i = process.argv.indexOf(flag);
  if (i < 0) return null;
  return process.argv[i + 1] ?? null;
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function resolveMatrixConfigWithMap(rawConfig = {}) {
  const mapName = "matrix channel";
  const mapHomeserver = resolveConfigMapText(mapName, "homeserver");
  const mapSharedSecret = resolveConfigMapText(mapName, "registration shared secret");
  const mapAdminToken = resolveConfigMapText(mapName, "admin token");
  const mapToken = resolveConfigMapText(mapName, "token");
  const mapUser = resolveConfigMapText(mapName, "user");
  const mapRoom = resolveConfigMapText(mapName, "room");
  return {
    ...rawConfig,
    homeserver: rawConfig.homeserver ?? mapHomeserver ?? null,
    registrationSharedSecret: rawConfig.registrationSharedSecret ?? mapSharedSecret ?? null,
    adminToken: rawConfig.adminToken ?? mapAdminToken ?? null,
    token: rawConfig.token ?? mapToken ?? null,
    user: rawConfig.user ?? mapUser ?? null,
    room: rawConfig.room ?? mapRoom ?? null
  };
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

async function ensureJoinedRoomId({ homeserver, token, userId, mode, roomIdOrAlias, fetchImpl = globalThis.fetch }) {
  const encoded = encodeURIComponent(String(roomIdOrAlias ?? "").trim());
  if (!encoded) return null;
  const joinUrl = applyAuthToUrl(`${homeserver}/_matrix/client/v3/join/${encoded}`, {
    token,
    userId,
    mode
  });
  const response = await fetchImpl(joinUrl, {
    method: "POST",
    headers: authHeaders({
      token,
      mode,
      headers: { "Content-Type": "application/json" }
    }),
    body: "{}"
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`matrix join failed: status=${response.status}${payload?.errcode ? ` code=${payload.errcode}` : ""}${payload?.error ? ` error=${payload.error}` : ""}`);
  }
  const joinedRoomId = String(payload?.room_id ?? "").trim();
  return joinedRoomId || String(roomIdOrAlias).trim();
}

async function initializeRuntimeConfig({ cwd, agentName }) {
  forget();
  clearSignatureHandlers();
  for (const sig of builtInSignatures) registerSignatureHandler(sig);
  await loadDefaultConfig({ cwd, interpretFn: interpret, entryPath: cwd });
  if (!remember(agentName)) {
    await interpret(parse(`exists su name ${agentName} be mind ya`));
  }
}

async function sendMatrixSummary({ worldRoot, agentName, summaryText, roomOverride = null }) {
  const agentHouse = resolveAgentHouse({
    mindName: agentName,
    rememberFn: () => null,
    worldRoot
  });
  await ensureAgentDirs(agentHouse);
  const allChannels = await loadChannelPolicyWithGlobal({ worldRoot, agentHouse });
  const matrix = resolveMatrixConfigWithMap(allChannels?.matrix ?? {});
  if (!matrix?.enabled) return { sent: false, reason: "matrix_disabled" };
  const rooms = Array.isArray(matrix.rooms) ? matrix.rooms : [];
  const targetRoomId = roomOverride || matrix.room || rooms[0]?.id || null;
  if (!targetRoomId) return { sent: false, reason: "matrix_no_room" };
  const hasCreds = Boolean(
    matrix?.token
    || matrix?.registrationSharedSecret
    || process.env.MATRIX_ACCESS_TOKEN
    || process.env.PYA_MATRIX_ACCESS_TOKEN
    || process.env.MATRIX_REGISTRATION_SHARED_SECRET
    || process.env.PYA_MATRIX_REGISTRATION_SHARED_SECRET
  );
  if (!hasCreds) return { sent: false, reason: "matrix_missing_credentials" };

  const creds = await ensureMatrixCredentials({
    agentName,
    agentHouse,
    config: matrix
  });
  const joinedRoomId = await ensureJoinedRoomId({
    homeserver: creds.homeserver,
    token: creds.token,
    userId: matrix.user ?? creds.user,
    mode: matrix.mode ?? "",
    roomIdOrAlias: targetRoomId
  });
  const adapter = createMatrixAdapter();
  await adapter.send({
    config: {
      ...matrix,
      homeserver: creds.homeserver,
      token: creds.token,
      user: matrix.user ?? creds.user
    },
    event: { channelId: joinedRoomId || targetRoomId },
    content: summaryText
  });
  return { sent: true, roomId: joinedRoomId || targetRoomId };
}

async function main() {
  const repoRoot = path.resolve(parseArgValue("--repo-root") ?? process.cwd());
  const worldRoot = path.resolve(parseArgValue("--world-root") ?? path.join(repoRoot, "world"));
  const agentName = parseArgValue("--agent") ?? "parity coder";
  const matrixRoom = parseArgValue("--matrix-room");
  const summaryFile = parseArgValue("--summary-file");
  const summaryTextArg = parseArgValue("--summary-text");
  const strict = hasFlag("--strict");

  const summaryText = summaryTextArg
    ?? (summaryFile ? await fs.readFile(summaryFile, "utf8") : "");
  if (!String(summaryText).trim()) {
    throw new Error("missing summary text: provide --summary-file or --summary-text");
  }

  await initializeRuntimeConfig({ cwd: repoRoot, agentName });
  let result;
  try {
    result = await sendMatrixSummary({
      worldRoot,
      agentName,
      summaryText: String(summaryText).trim(),
      roomOverride: matrixRoom
    });
  } catch (err) {
    result = { sent: false, reason: String(err?.message ?? err) };
  }

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (strict && result.sent !== true) process.exit(2);
}

main().catch((err) => {
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
});
