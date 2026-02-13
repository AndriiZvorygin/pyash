import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { ensureMatrixCredentials, ensureMatrixExecutiveDmRoom } from "../program/agent/channels/bootstrap.mjs";

function readFlagValue(args, flag) {
  const idx = args.indexOf(flag);
  if (idx === -1) return null;
  return args[idx + 1] ?? null;
}

function hasFlag(args, flag) {
  return args.includes(flag);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function usage() {
  return [
    "Usage: node command/matrix_configure_smoke.mjs [options]",
    "",
    "Options:",
    "  --root <path>             Root directory (default: current working directory)",
    "  --agent <name>            Agent name (default: mricge)",
    "  --executive <@user:id>    Executive Matrix user (default: @mricge-smoke:matrix.liberit.ca)",
    "  --wipe <truth|lie>        Remove world/house/<agent> before configure (default: truth)",
    "  --restart-calendar <truth|lie>  Restore scheduler running state at end (default: truth)",
    "  --restore-room <truth|lie>  Restore original configured room after smoke run (default: truth)",
    "  --json                    Output JSON only",
    "  --help                    Show this help"
  ].join("\n");
}

function parseTruthy(raw, fallback = false) {
  if (raw == null) return fallback;
  const value = String(raw).trim().toLowerCase();
  if (["truth", "true", "yes", "y", "1", "on"].includes(value)) return true;
  if (["lie", "false", "no", "n", "0", "off"].includes(value)) return false;
  return fallback;
}

function homeserverHost(homeserver) {
  const base = String(homeserver ?? "").trim();
  if (!base) return "";
  try {
    return new URL(base).host;
  } catch {
    return base.replace(/^https?:\/\//i, "").replace(/\/+$/g, "");
  }
}

function ensureMatrixUserServer(userId, host) {
  const text = String(userId ?? "").trim();
  if (!text) return "";
  if (text.startsWith("@") && text.includes(":")) return text;
  if (text.startsWith("@")) return `${text}:${host}`;
  if (text.includes(":")) return `@${text}`;
  return `@${text}:${host}`;
}

function sanitizePathSegment(raw) {
  return String(raw ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "") || "smoke";
}

function parseSecretText(secretText) {
  const read = (patterns, fallback = "") => {
    for (const pattern of patterns) {
      const match = String(secretText).match(pattern);
      if (match?.[1]) return String(match[1]).trim();
    }
    return fallback;
  };

  const homeserver = read([
    /su name homeserver ob text "([^"]+)" ya/i,
    /exists\s+su name matrix homeserver ob text "([^"]+)"/i
  ]);
  const userId = read([
    /su name user ob text "([^"]+)" ya/i
  ]);
  const sharedSecret = read([
    /exists\s+su name matrix registration shared secret ob text "([^"]+)"/i,
    /su name registration shared secret ob text "([^"]+)" ya/i
  ]);
  return { homeserver, userId, sharedSecret };
}

async function readTextOrEmpty(filePath) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (err) {
    if (err?.code === "ENOENT") return "";
    throw err;
  }
}

function parseMatrixRoomFromChannelPolicy(policyText) {
  const matches = [...String(policyText ?? "").matchAll(/su name matrix room ob text "([^"]+)" ya/ig)];
  if (!matches.length) return "";
  return String(matches[matches.length - 1]?.[1] ?? "").trim();
}

async function loadConfiguredMatrixRoom({ rootDir, agentName }) {
  const worldPolicyPath = path.join(rootDir, "world", "conduct", "channels.pya");
  const agentPolicyPath = path.join(rootDir, "world", "house", agentName, "conduct", "channels.pya");
  const [worldPolicyText, agentPolicyText] = await Promise.all([
    readTextOrEmpty(worldPolicyPath),
    readTextOrEmpty(agentPolicyPath)
  ]);
  const agentRoom = parseMatrixRoomFromChannelPolicy(agentPolicyText);
  if (agentRoom) return agentRoom;
  return parseMatrixRoomFromChannelPolicy(worldPolicyText);
}

function runPyash({ rootDir, args }) {
  const run = spawnSync(process.execPath, ["command/pyash.mjs", ...args, "--root", rootDir, "--json"], {
    cwd: rootDir,
    encoding: "utf8"
  });
  let payload = null;
  const text = String(run.stdout ?? "").trim();
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }
  return {
    status: run.status,
    stdout: String(run.stdout ?? ""),
    stderr: String(run.stderr ?? ""),
    payload
  };
}

async function matrixJoinRoom({ homeserver, token, room }) {
  const response = await fetch(`${homeserver}/_matrix/client/v3/join/${encodeURIComponent(room)}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`matrix join failed: status=${response.status} error=${String(payload?.error || "")}`);
  }
  return String(payload?.room_id ?? "");
}

async function matrixSendText({ homeserver, token, roomId, body }) {
  const txnId = `smoke-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const response = await fetch(
    `${homeserver}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${encodeURIComponent(txnId)}`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ msgtype: "m.text", body: String(body) })
    }
  );
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`matrix send failed: status=${response.status} error=${String(payload?.error || "")}`);
  }
  return String(payload?.event_id ?? "");
}

function isMatrixRateLimitedError(errorLike) {
  const message = String(errorLike?.message ?? errorLike ?? "");
  return /status=429|m_limit_exceeded/i.test(message);
}

async function matrixSendTextWithRetry(params, { attempts = 6, baseDelayMs = 1200 } = {}) {
  let lastError = null;
  const maxAttempts = Math.max(1, Math.floor(Number(attempts) || 1));
  for (let i = 0; i < maxAttempts; i += 1) {
    try {
      return await matrixSendText(params);
    } catch (err) {
      lastError = err;
      if (!isMatrixRateLimitedError(err) || i >= maxAttempts - 1) throw err;
      await sleep(baseDelayMs * (i + 1));
    }
  }
  throw lastError ?? new Error("matrix send failed");
}

async function matrixCreateRoom({ homeserver, token, invite = [], isDirect = false }) {
  const response = await fetch(`${homeserver}/_matrix/client/v3/createRoom`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      is_direct: Boolean(isDirect),
      invite: Array.isArray(invite) ? invite : [],
      preset: isDirect ? "trusted_private_chat" : "private_chat"
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`matrix createRoom failed: status=${response.status} error=${String(payload?.error || "")}`);
  }
  const roomId = String(payload?.room_id ?? "");
  if (!roomId) throw new Error("matrix createRoom missing room_id");
  return roomId;
}

async function matrixRoomMessages({ homeserver, token, roomId, limit = 80 }) {
  const response = await fetch(
    `${homeserver}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/messages?dir=b&limit=${Math.max(1, Math.floor(limit))}`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` }
    }
  );
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`matrix messages failed: status=${response.status} error=${String(payload?.error || "")}`);
  }
  return Array.isArray(payload?.chunk) ? payload.chunk : [];
}

async function matrixReadExecutiveDmRooms({ homeserver, token, userId, executiveUserId }) {
  const encodedUser = encodeURIComponent(String(userId ?? "").trim());
  if (!encodedUser) return [];
  const response = await fetch(`${homeserver}/_matrix/client/v3/user/${encodedUser}/account_data/m.direct`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) return [];
  const rooms = payload?.[executiveUserId];
  if (!Array.isArray(rooms)) return [];
  return rooms.map((room) => String(room ?? "").trim()).filter((room) => room.startsWith("!"));
}

function readMatrixBody(event = {}) {
  const body = event?.content?.body;
  if (body == null) return "";
  return String(body).trim();
}

function isAgentErrorBody(body = "") {
  const text = String(body ?? "").trim().toLowerCase();
  if (!text) return false;
  return text.startsWith("mind defective:")
    || text.includes("sandbox defective")
    || text.includes("command sandbox defective")
    || text.startsWith("error:");
}

function hasAgentReplyAfter({ messages, eventId, agentUserId }) {
  const index = messages.findIndex((event) => String(event?.event_id ?? "") === eventId);
  const newerMessages = index >= 0 ? messages.slice(0, index) : messages;
  const target = String(agentUserId ?? "").trim().toLowerCase();
  return newerMessages.some((event) => {
    const sender = String(event?.sender ?? "").trim().toLowerCase();
    if (!sender || sender !== target) return false;
    const body = readMatrixBody(event);
    return !isAgentErrorBody(body);
  });
}

function requireOk(result, label) {
  if (result.status !== 0) {
    throw new Error(`${label} failed (status=${result.status}): ${result.stderr || result.stdout}`);
  }
  return result.payload ?? {};
}

async function main() {
  const args = process.argv.slice(2);
  if (hasFlag(args, "--help")) {
    console.log(usage());
    return;
  }

  const rootDir = path.resolve(readFlagValue(args, "--root") ?? process.cwd());
  const agentName = String(readFlagValue(args, "--agent") ?? "mricge").trim();
  const executiveInput = String(readFlagValue(args, "--executive") ?? "@mricge-smoke:matrix.liberit.ca").trim();
  const wipe = parseTruthy(readFlagValue(args, "--wipe"), true);
  const restartCalendar = parseTruthy(readFlagValue(args, "--restart-calendar"), true);
  const restoreRoom = parseTruthy(readFlagValue(args, "--restore-room"), true);
  const json = hasFlag(args, "--json");

  if (!agentName) throw new Error("--agent is required");

  const summary = {
    ok: false,
    rootDir,
    agentName,
    executive: executiveInput,
    steps: {},
    checks: {}
  };

  const healthBefore = requireOk(
    runPyash({ rootDir, args: ["calendar", "health"] }),
    "calendar health"
  );
  const schedulerWasRunning = Boolean(healthBefore?.result?.running);
  summary.steps.schedulerWasRunning = schedulerWasRunning;

  requireOk(runPyash({ rootDir, args: ["calendar", "stop"] }), "calendar stop");
  summary.steps.schedulerStopped = true;

  const originalRoom = await loadConfiguredMatrixRoom({ rootDir, agentName });
  summary.steps.originalRoom = originalRoom;

  const housePath = path.join(rootDir, "world", "house", agentName);
  if (wipe) {
    await fs.rm(housePath, { recursive: true, force: true });
    summary.steps.houseWiped = true;
  }

  const secretPath = path.join(rootDir, "configure", "secret.pya");
  const secretText = await fs.readFile(secretPath, "utf8");
  const secret = parseSecretText(secretText);
  if (!secret.homeserver) {
    throw new Error("configure/secret.pya is missing matrix homeserver");
  }
  if (!originalRoom) {
    throw new Error("matrix room is missing from world/house channel policy");
  }
  if (!secret.sharedSecret) {
    throw new Error("configure/secret.pya is missing matrix registration shared secret");
  }
  const host = homeserverHost(secret.homeserver);
  const executiveUserId = ensureMatrixUserServer(executiveInput, host);
  const agentUserId = ensureMatrixUserServer(agentName, host);
  const smokeHouseCandidates = [
    path.join("/tmp", `matrix-smoke-${sanitizePathSegment(executiveUserId)}`),
    path.join("/tmp", `${agentName}-smoke-house`),
    path.join("/tmp", "mricge-smoke-house")
  ];
  let smokeHouse = smokeHouseCandidates[0];
  for (const candidate of smokeHouseCandidates) {
    try {
      await fs.access(path.join(candidate, "conduct", "matrix-auth.json"));
      smokeHouse = candidate;
      break;
    } catch {
      // continue
    }
  }
  const smokeCredentials = await ensureMatrixCredentials({
    agentName: sanitizePathSegment(executiveUserId),
    agentHouse: smokeHouse,
    config: {
      homeserver: secret.homeserver,
      registrationSharedSecret: secret.sharedSecret,
      user: executiveUserId,
      mode: "sync"
    }
  });

  const smokeToken = String(smokeCredentials?.token ?? "");
  if (!smokeToken) throw new Error("failed to establish smoke user token");

  const smokePublicRoomId = await matrixCreateRoom({
    homeserver: secret.homeserver,
    token: smokeToken,
    invite: [agentUserId],
    isDirect: false
  });
  summary.steps.smokePublicRoomId = smokePublicRoomId;

  const configureChannelPayload = requireOk(
    runPyash({
      rootDir,
      args: [
        "configure", "channel", "matrix",
        "--non-interactive",
        "--agent", agentName,
        "--room", smokePublicRoomId,
        "--agent-user-id", agentUserId,
        "--executive", executiveUserId,
        "--mention-gate", "truth",
        "--write-agent-policy", "truth",
        "--test-now", "truth",
        "--start-now", "lie"
      ]
    }),
    "configure channel matrix"
  );
  summary.steps.configureChannel = {
    changed: Boolean(configureChannelPayload?.changed),
    verificationOk: Boolean(configureChannelPayload?.verification?.ok),
    liveOk: Boolean(configureChannelPayload?.live?.ok)
  };

  const configureAgentPayload = requireOk(
    runPyash({
      rootDir,
      args: [
        "configure", "agent", "establish",
        "--non-interactive",
        "--agent", agentName,
        "--bind-channel", "truth",
        "--smoke-test", "lie",
        "--start-now", "lie"
      ]
    }),
    "configure agent establish"
  );
  summary.steps.configureAgent = {
    changed: Boolean(configureAgentPayload?.changed),
    bootstrapOk: Boolean(configureAgentPayload?.channelBootstrap?.ok || configureAgentPayload?.channelBootstrap?.skipped)
  };

  summary.steps.bootstrap = {
    ok: true,
    joinedRoomId: String(configureChannelPayload?.live?.checks?.find((check) => check?.name === "join room")?.roomId ?? ""),
    executiveDmRoomId: String(configureChannelPayload?.live?.checks?.find((check) => check?.name === "resolve executive dm room")?.roomId ?? "")
  };

  const houseFiles = await fs.readdir(path.join(housePath, "conduct")).catch(() => []);
  summary.steps.houseReady = houseFiles.includes("runtime.pya")
    && houseFiles.includes("channels.pya")
    && houseFiles.includes("calendar.pya");

  const agentAuthPath = path.join(housePath, "conduct", "matrix-auth.json");
  const knownExecutiveDmRoom = summary.steps.bootstrap.executiveDmRoomId || "";
  if (knownExecutiveDmRoom) {
    try {
      const authText = await fs.readFile(agentAuthPath, "utf8");
      const authData = JSON.parse(authText);
      const executiveDmRooms = {
        ...(authData?.executiveDmRooms ?? {}),
        [executiveUserId]: knownExecutiveDmRoom
      };
      const patchedAuth = {
        ...(authData ?? {}),
        executiveDmRooms
      };
      await fs.writeFile(agentAuthPath, JSON.stringify(patchedAuth, null, 2) + "\n", "utf8");
      const agentToken = String(patchedAuth?.accessToken ?? "");
      if (agentToken) {
        try {
          await matrixJoinRoom({
            homeserver: secret.homeserver,
            token: agentToken,
            room: knownExecutiveDmRoom
          });
        } catch {
          // best effort; poll path will still attempt recovery
        }
      }
    } catch {
      // best effort only
    }
  }

  const marker = `smoke-${Date.now()}`;
  summary.steps.marker = marker;

  const pollAgent = async ({ attempts = 6, baseDelayMs = 1200 } = {}) => {
    const maxAttempts = Math.max(1, Math.floor(Number(attempts) || 1));
    let lastRun = null;
    for (let i = 0; i < maxAttempts; i += 1) {
      const run = runPyash({ rootDir, args: ["channel", "poll", "--agent", agentName, "--channel", "matrix"] });
      lastRun = run;
      if (run.status === 0) return;
      const errorText = `${String(run.stderr ?? "")}\n${String(run.stdout ?? "")}`;
      if (!isMatrixRateLimitedError(errorText) || i >= maxAttempts - 1) {
        requireOk(run, "channel poll");
      }
      await sleep(baseDelayMs * (i + 1));
    }
    requireOk(lastRun, "channel poll");
  };

  const pollAndRead = async (roomId, rounds = 1, pauseMs = 1200) => {
    let messages = [];
    for (let i = 0; i < rounds; i += 1) {
      await pollAgent();
      await new Promise((resolve) => setTimeout(resolve, pauseMs));
      messages = await matrixRoomMessages({
        homeserver: secret.homeserver,
        token: smokeToken,
        roomId,
        limit: 160
      });
    }
    return messages;
  };

  const waitForReply = async ({ roomId, eventId, attempts = 8, pauseMs = 2000 }) => {
    for (let i = 0; i < attempts; i += 1) {
      const messages = await pollAndRead(roomId, 1, pauseMs);
      const replied = hasAgentReplyAfter({
        messages,
        eventId,
        agentUserId
      });
      if (replied) return true;
    }
    return false;
  };

  const untaggedEventId = await matrixSendTextWithRetry({
    homeserver: secret.homeserver,
    token: smokeToken,
    roomId: smokePublicRoomId,
    body: `${marker} public untagged`
  });
  const publicAfterUntagged = await pollAndRead(smokePublicRoomId, 2, 1400);
  const untaggedReply = hasAgentReplyAfter({
    messages: publicAfterUntagged,
    eventId: untaggedEventId,
    agentUserId
  });

  const taggedEventId = await matrixSendTextWithRetry({
    homeserver: secret.homeserver,
    token: smokeToken,
    roomId: smokePublicRoomId,
    body: `@${agentName} ${marker} public tagged`
  });
  let taggedReply = await waitForReply({
    roomId: smokePublicRoomId,
    eventId: taggedEventId
  });
  if (!taggedReply) {
    const taggedRetryEventId = await matrixSendTextWithRetry({
      homeserver: secret.homeserver,
      token: smokeToken,
      roomId: smokePublicRoomId,
      body: `@${agentName} ${marker} public tagged retry`
    });
    taggedReply = await waitForReply({
      roomId: smokePublicRoomId,
      eventId: taggedRetryEventId
    });
  }

  const authPath = path.join(rootDir, "world", "house", agentName, "conduct", "matrix-auth.json");
  const agentAuth = JSON.parse(await fs.readFile(authPath, "utf8"));
  let dmRoomId = String(agentAuth?.executiveDmRooms?.[executiveUserId] || summary.steps.bootstrap.executiveDmRoomId || "");
  const agentToken = String(agentAuth?.accessToken ?? "");
  const agentUser = String(agentAuth?.user ?? agentUserId);
  if (!dmRoomId && agentToken && agentUser) {
    const accountDataRooms = await matrixReadExecutiveDmRooms({
      homeserver: secret.homeserver,
      token: agentToken,
      userId: agentUser,
      executiveUserId
    });
    dmRoomId = accountDataRooms[0] || "";
  }
  if (!dmRoomId && agentToken && agentUser) {
    try {
      dmRoomId = String(await ensureMatrixExecutiveDmRoom({
        agentHouse: housePath,
        homeserver: secret.homeserver,
        token: agentToken,
        user: agentUser,
        executiveUser: executiveUserId
      }) || "");
    } catch {
      // fall through to existing guard
    }
  }
  if (!dmRoomId) {
    throw new Error("missing executive dm room id after bootstrap");
  }
  await matrixJoinRoom({ homeserver: secret.homeserver, token: smokeToken, room: dmRoomId });
  const dmEventId = await matrixSendTextWithRetry({
    homeserver: secret.homeserver,
    token: smokeToken,
    roomId: dmRoomId,
    body: `${marker} dm untagged`
  });
  let dmReply = await waitForReply({
    roomId: dmRoomId,
    eventId: dmEventId
  });
  if (!dmReply) {
    const dmRetryEventId = await matrixSendTextWithRetry({
      homeserver: secret.homeserver,
      token: smokeToken,
      roomId: dmRoomId,
      body: `${marker} dm untagged retry`
    });
    dmReply = await waitForReply({
      roomId: dmRoomId,
      eventId: dmRetryEventId
    });
  }

  summary.checks = {
    untaggedPublicReply: untaggedReply,
    taggedPublicReply: taggedReply,
    dmReply,
    publicRoomId: smokePublicRoomId,
    dmRoomId,
    agentUserId,
    executiveUserId
  };

  if (restoreRoom && originalRoom && originalRoom !== smokePublicRoomId) {
    const restoreChannelPayload = requireOk(
      runPyash({
        rootDir,
        args: [
          "configure", "channel", "matrix",
          "--non-interactive",
          "--agent", agentName,
          "--room", originalRoom,
          "--agent-user-id", agentUserId,
          "--executive", executiveUserId,
          "--mention-gate", "truth",
          "--write-agent-policy", "truth",
          "--test-now", "truth",
          "--start-now", "lie"
        ]
      }),
      "restore configure channel matrix"
    );
    summary.steps.restoreRoom = {
      restored: true,
      room: originalRoom,
      changed: Boolean(restoreChannelPayload?.changed),
      bootstrapOk: true
    };
  } else {
    summary.steps.restoreRoom = {
      restored: false,
      room: originalRoom || ""
    };
  }

  summary.ok = Boolean(
    summary.steps.houseReady
    && summary.steps.configureChannel.liveOk
    && (summary.steps.restoreRoom.restored ? summary.steps.restoreRoom.bootstrapOk : true)
    && untaggedReply === false
    && taggedReply === true
    && dmReply === true
  );

  if (restartCalendar && schedulerWasRunning) {
    requireOk(runPyash({ rootDir, args: ["calendar", "begin"] }), "calendar begin");
    summary.steps.schedulerRestored = true;
  } else {
    summary.steps.schedulerRestored = false;
  }

  if (json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(`matrix configure smoke ${summary.ok ? "passed" : "failed"}`);
    console.log(`- agent ${summary.agentName}`);
    console.log(`- untagged public reply ${summary.checks.untaggedPublicReply}`);
    console.log(`- tagged public reply ${summary.checks.taggedPublicReply}`);
    console.log(`- dm reply ${summary.checks.dmReply}`);
    console.log(`- public room ${summary.checks.publicRoomId}`);
    console.log(`- dm room ${summary.checks.dmRoomId}`);
  }

  if (!summary.ok) process.exit(1);
}

main().catch((err) => {
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
});
