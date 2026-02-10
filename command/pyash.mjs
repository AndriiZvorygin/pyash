#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import readline from "node:readline/promises";
import { Writable } from "node:stream";
import { ensureMatrixCredentials } from "../program/agent/channels/bootstrap.mjs";
import { establishAgent, beginAgent, stopAgent } from "../program/agent/admin.mjs";

const __filename = fileURLToPath(import.meta.url);
const installRoot = path.resolve(path.dirname(__filename), "..");
const runProgramPath = path.join(installRoot, "command", "run_pya_program.mjs");
const replPath = path.join(installRoot, "program", "main.mjs");

const MATRIX_CATERER_NAME = "matrix";
const MATRIX_BLOCK_NAME = "matrix channel";
const CHANNEL_CONFIG_BLOCK_NAME = "channel configure";
const MATRIX_POLICY_BLOCK_NAME = "matrix channel conduct";
const ORCHESTRATOR_CONFIG_BLOCK_NAME = "orchestrator configure";
const MIND_CONFIG_BLOCK_NAME = "mind configure";
const MIND_DEFAULTS_BLOCK_NAME = "mind defaults";

function parseArgValue(args, flag) {
  const idx = args.findIndex((arg) => arg === flag);
  if (idx < 0) return null;
  return args[idx + 1] ?? null;
}

function hasFlag(args, flag) {
  return args.includes(flag);
}

function parseTruthy(value, fallback = false) {
  if (value == null || value === "") return fallback;
  return /^(truth|true|yes|1|y)$/i.test(String(value).trim());
}

function usage() {
  return [
    "Usage:",
    "  pyash run <file.pya> [run flags...]",
    "  pyash <file.pya> [run flags...]",
    "  pyash repl",
    "  pyash configure",
    "  pyash configure intro [--root <path>] [--json]",
    "  pyash configure orchestrator [--root <path>] [--non-interactive] [--dry-run] [--print] [--json] [--mode <container|local>] [--host <hostname>] [--port <n>] [--autostart <truth|lie>] [--health-minute <n>]",
    "  pyash configure channel",
    "  pyash configure channel list [--json]",
    "  pyash configure channel matrix [--root <path>] [--non-interactive] [--dry-run] [--print] [--json] [--quickstart|--advanced] [--test-now <truth|lie>] [--homeserver <url>] [--room <id-or-alias>] [--executive <@user:server>] [--agent-user-id <@user:server>] [--auth-mode <password|token|shared-secret>] [--password <password>] [--token <token>] [--registration-shared-secret <secret>] [--admin-token <token>] [--agent <name>] [--write-agent-policy <truth|lie>] [--mention-gate <truth|lie>]",
    "  pyash configure channel matrix test [--root <path>] [--json]",
    "  pyash configure channel matrix doctor [--root <path>] [--json]",
    "  pyash configure mind [--root <path>] [--non-interactive] [--dry-run] [--print] [--json] [--backend <name>] [--host <url>] [--model <name>] [--test-now <truth|lie>]",
    "  pyash configure agent [--root <path>] [--non-interactive] [--dry-run] [--print] [--json] [--agent <name>] [--purpose <text>] [--interval-minutes <n>] [--backend <name>] [--model <name>] [--tools-map <name>] [--bind-channel <truth|lie>] [--smoke-test <truth|lie>]",
    "",
    "Notes:",
    "  - Recommended onboarding route is: pyash configure intro",
    "  - Canonical configure route is: pyash configure channel <caterer>",
    "  - Channel config writes managed blocks to configure/secret.pya",
    "  - Optional channel conduct writes to world/house/<agent>/conduct/channels.pya"
  ].join("\n");
}

function jsonOut(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function textOut(value = "") {
  process.stdout.write(`${value}\n`);
}

function quoteText(value) {
  const text = String(value ?? "");
  return `\"${text.replace(/\\/g, "\\\\").replace(/\"/g, "\\\"")}"`;
}

function unquotePyashText(value) {
  const text = String(value ?? "").trim();
  if (!(text.startsWith("\"") && text.endsWith("\""))) return text;
  const inner = text.slice(1, -1);
  return inner
    .replace(/\\\\/g, "\\")
    .replace(/\\\"/g, "\"");
}

async function readText(filePath) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (err) {
    if (err?.code === "ENOENT") return "";
    throw err;
  }
}

async function ensureDirForFile(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

function normalizeHomeserver(raw) {
  const text = String(raw ?? "").trim().replace(/\/+$/g, "");
  if (!text) return "";
  if (!/^https?:\/\//i.test(text)) return `https://${text}`;
  return text;
}

function homeserverHost(homeserver) {
  const text = normalizeHomeserver(homeserver);
  if (!text) return "";
  const withoutProto = text.replace(/^https?:\/\//i, "");
  return withoutProto.replace(/\/.*$/g, "").trim().toLowerCase();
}

function matrixSupportsSharedSecret(homeserver) {
  const host = homeserverHost(homeserver);
  // matrix.org is not a self-hosted Synapse admin endpoint for shared-secret registration.
  return host !== "matrix.org";
}

function matrixServerFromId(value) {
  const text = String(value ?? "").trim();
  const idx = text.lastIndexOf(":");
  if (idx <= 0 || idx === text.length - 1) return "";
  return text.slice(idx + 1).trim().toLowerCase();
}

function ensureMatrixIdServer(value, host) {
  const text = String(value ?? "").trim();
  const trimmedHost = String(host ?? "").trim().toLowerCase();
  if (!text || !trimmedHost) return text;
  if (!text.startsWith("#") && !text.startsWith("!")) return text;
  if (matrixServerFromId(text)) return text;
  return `${text}:${trimmedHost}`;
}

function rewriteMatrixIdServer(value, host) {
  const text = String(value ?? "").trim();
  const trimmedHost = String(host ?? "").trim().toLowerCase();
  if (!text || !trimmedHost) return text;
  if (!text.startsWith("#") && !text.startsWith("!")) return text;
  if (!matrixServerFromId(text)) return `${text}:${trimmedHost}`;
  const local = text.slice(0, text.lastIndexOf(":"));
  return `${local}:${trimmedHost}`;
}

function ensureMatrixUserServer(value, host) {
  const text = String(value ?? "").trim();
  const trimmedHost = String(host ?? "").trim().toLowerCase();
  if (!text || !trimmedHost) return text;
  if (!text.startsWith("@")) return text;
  if (matrixServerFromId(text)) return text;
  return `${text}:${trimmedHost}`;
}

function redactText(value) {
  if (!value) return "";
  return "[redacted]";
}

function redactMatrixConfig(cfg) {
  return {
    ...cfg,
    token: redactText(cfg.token),
    password: redactText(cfg.password),
    registrationSharedSecret: redactText(cfg.registrationSharedSecret),
    adminToken: redactText(cfg.adminToken)
  };
}

function sectionPrinter() {
  return {
    header(title) {
      textOut("");
      textOut(`[${title}]`);
    },
    why(text) {
      textOut(`Why this matters: ${text}`);
    },
    how(text) {
      textOut(`How to get it: ${text}`);
    },
    examples(text) {
      textOut(`Examples: ${text}`);
    },
    gap() {
      textOut("");
    }
  };
}

class MuteWritable extends Writable {
  constructor(target) {
    super();
    this.target = target;
    this.muted = false;
  }

  _write(chunk, encoding, callback) {
    if (!this.muted) this.target.write(chunk, encoding);
    callback();
  }
}

async function runNodeScript(scriptPath, args, { cwd = process.cwd() } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      stdio: "inherit",
      cwd,
      env: process.env
    });
    child.on("exit", (code, signal) => {
      if (signal) process.kill(process.pid, signal);
      resolve(code ?? 0);
    });
  });
}

function blockMarkers(blockName) {
  return {
    start: `# managed by pyash configure ${blockName}:start`,
    end: `# managed by pyash configure ${blockName}:end`
  };
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function renderManagedBlock({ blockName, content }) {
  const markers = blockMarkers(blockName);
  return `${markers.start}\n${content.trim()}\n${markers.end}\n`;
}

function planManagedUpsert({ existing, blockName, content }) {
  const markers = blockMarkers(blockName);
  const block = renderManagedBlock({ blockName, content });
  const pattern = new RegExp(`${escapeRegex(markers.start)}[\\s\\S]*?${escapeRegex(markers.end)}\\n?`, "m");

  let nextText;
  let action;
  if (pattern.test(existing)) {
    nextText = existing.replace(pattern, block);
    action = "replace";
  } else if (existing.trim()) {
    nextText = `${existing.trimEnd()}\n\n${block}`;
    action = "append";
  } else {
    nextText = block;
    action = "create";
  }

  const changed = nextText !== existing;
  return {
    changed,
    action,
    nextText,
    block,
    blockName
  };
}

function parseMapBlock(blockText) {
  const out = {};
  const linePattern = /su name (.+?)\s+ob text\s+("[^"\\]*(?:\\.[^"\\]*)*")\s+ya/g;
  for (const match of blockText.matchAll(linePattern)) {
    out[match[1]] = unquotePyashText(match[2]);
  }
  return out;
}

function extractManagedBlock(text, blockName) {
  const markers = blockMarkers(blockName);
  const pattern = new RegExp(`${escapeRegex(markers.start)}([\\s\\S]*?)${escapeRegex(markers.end)}`, "m");
  const match = text.match(pattern);
  return match ? match[1] : "";
}

async function loadMatrixConfigFromSecret(rootDir) {
  const secretPath = path.join(rootDir, "configure", "secret.pya");
  const text = await readText(secretPath);
  if (!text) return {};

  const matrixBlock = extractManagedBlock(text, MATRIX_BLOCK_NAME);
  const channelCfgBlock = extractManagedBlock(text, CHANNEL_CONFIG_BLOCK_NAME);

  const matrixValues = parseMapBlock(matrixBlock);
  const channelValues = parseMapBlock(channelCfgBlock);

  const defaultCaterer = channelValues["default caterer"] || "";

  return {
    defaultCaterer,
    homeserver: matrixValues.homeserver || "",
    room: matrixValues.room || "",
    executiveUsername: matrixValues["executive username"] || "",
    userId: matrixValues.user || "",
    authMode: matrixValues["auth mode"] || "",
    token: matrixValues.token || "",
    registrationSharedSecret: matrixValues["registration shared secret"] || "",
    adminToken: matrixValues["admin token"] || ""
  };
}

async function loadOrchestratorConfigFromSecret(rootDir) {
  const secretPath = path.join(rootDir, "configure", "secret.pya");
  const text = await readText(secretPath);
  if (!text) return {};
  const orchestratorBlock = extractManagedBlock(text, ORCHESTRATOR_CONFIG_BLOCK_NAME);
  const values = parseMapBlock(orchestratorBlock);
  return {
    mode: values.mode || "",
    host: values.host || "",
    port: values.port || "",
    autostart: values.autostart || "",
    healthMinute: values["health minute"] || ""
  };
}

async function loadMindConfigFromSecret(rootDir) {
  const secretPath = path.join(rootDir, "configure", "secret.pya");
  const text = await readText(secretPath);
  if (!text) return {};
  const mindBlock = extractManagedBlock(text, MIND_CONFIG_BLOCK_NAME);
  const values = parseMapBlock(mindBlock);
  return {
    backend: values.backend || "",
    host: values.host || "",
    model: values.model || ""
  };
}

function buildOrchestratorConfigureBlock(cfg) {
  return [
    "su name orchestrator configure be map def",
    `  su name mode ob text ${quoteText(cfg.mode)} ya`,
    `  su name host ob text ${quoteText(cfg.host)} ya`,
    `  su name port ob text ${quoteText(String(cfg.port))} ya`,
    `  su name autostart ob text ${quoteText(cfg.autostart ? "truth" : "lie")} ya`,
    `  su name health minute ob text ${quoteText(String(cfg.healthMinute))} ya`,
    "prah"
  ].join("\n");
}

function buildMatrixMapBlock(cfg) {
  const lines = [
    "su name matrix channel be map def",
    `  su name homeserver ob text ${quoteText(cfg.homeserver)} ya`,
    `  su name room ob text ${quoteText(cfg.room)} ya`
  ];
  if (cfg.executiveUsername) lines.push(`  su name executive username ob text ${quoteText(cfg.executiveUsername)} ya`);
  if (cfg.userId) lines.push(`  su name user ob text ${quoteText(cfg.userId)} ya`);
  lines.push(`  su name auth mode ob text ${quoteText(cfg.authMode)} ya`);
  if (cfg.token) lines.push(`  su name token ob text ${quoteText(cfg.token)} ya`);
  if (cfg.registrationSharedSecret) {
    lines.push(`  su name registration shared secret ob text ${quoteText(cfg.registrationSharedSecret)} ya`);
  }
  if (cfg.adminToken) lines.push(`  su name admin token ob text ${quoteText(cfg.adminToken)} ya`);
  lines.push("prah");
  return lines.join("\n");
}

function buildChannelConfigureBlock() {
  return [
    "su name channel configure be map def",
    `  su name default caterer ob text ${quoteText(MATRIX_CATERER_NAME)} ya`,
    "  su name matrix ob name matrix channel ya",
    "prah"
  ].join("\n");
}

function buildChannelConductBlock({ homeserver, room, mentionGate = false }) {
  return [
    "su name matrix channel ob bool truth ya",
    `su name matrix mention gate ob bool ${mentionGate ? "truth" : "lie"} ya`,
    `su name matrix homeserver ob text ${quoteText(homeserver)} ya`,
    `su name matrix room ob text ${quoteText(room)} ya`
  ].join("\n");
}

function buildMatrixPollCalendarBlock({ agentName, intervalMinutes = 1 }) {
  const interval = Math.max(1, Math.floor(Number(intervalMinutes) || 1));
  return [
    `su name matrix poll for name ${agentName} with wo tools vyah habit during minute ${interval} be calendar ya`,
    "su name matrix poll lane ob text \"matrix_poll\" ya"
  ].join("\n");
}

function upsertMatrixPollCalendarText({ existing, agentName, intervalMinutes = 1 }) {
  const pollLines = buildMatrixPollCalendarBlock({ agentName, intervalMinutes }).split("\n");
  const lines = String(existing ?? "").split("\n");
  const pollPattern = /^su name matrix poll for name .* be calendar ya$/i;
  const lanePattern = /^su name matrix poll lane ob text "matrix_poll" ya$/i;
  const kept = lines.filter((line) => !pollPattern.test(line.trim()) && !lanePattern.test(line.trim()));
  const body = kept.join("\n").trim();
  const block = pollLines.join("\n");
  const nextText = body ? `${body}\n${block}\n` : `${block}\n`;
  return {
    changed: nextText !== existing,
    action: String(existing || "").trim() ? "append" : "create",
    nextText
  };
}

async function loginMatrixWithPassword({ homeserver, userId, password }) {
  const endpoint = `${normalizeHomeserver(homeserver)}/_matrix/client/v3/login`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "m.login.password",
      identifier: {
        type: "m.id.user",
        user: String(userId ?? "")
      },
      password: String(password ?? "")
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const code = payload?.errcode ? ` code=${payload.errcode}` : "";
    const message = payload?.error ? ` error=${payload.error}` : "";
    throw new Error(`matrix password login failed: status=${response.status}${code}${message}`);
  }
  const token = payload?.access_token;
  if (!token) throw new Error("matrix password login missing access_token");
  return {
    token: String(token),
    userId: String(payload?.user_id ?? userId ?? "")
  };
}

async function matrixWhoAmI({ homeserver, token }) {
  const endpoint = `${normalizeHomeserver(homeserver)}/_matrix/client/v3/account/whoami`;
  const response = await fetch(endpoint, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const code = payload?.errcode ? ` code=${payload.errcode}` : "";
    const message = payload?.error ? ` error=${payload.error}` : "";
    throw new Error(`matrix whoami failed: status=${response.status}${code}${message}`);
  }
  return { userId: String(payload?.user_id ?? "") };
}

async function matrixVersions({ homeserver }) {
  const endpoint = `${normalizeHomeserver(homeserver)}/_matrix/client/versions`;
  const response = await fetch(endpoint, { method: "GET" });
  if (!response.ok) {
    throw new Error(`matrix versions failed: status=${response.status}`);
  }
  return await response.json().catch(() => ({}));
}

function matrixVerification(cfg) {
  const errors = [];
  const warnings = [];

  const homeserver = normalizeHomeserver(cfg.homeserver);
  const room = String(cfg.room || "").trim();
  const authMode = String(cfg.authMode || "").trim();

  if (!homeserver) errors.push({ code: "missing_homeserver", message: "homeserver is required" });
  if (!/^https?:\/\//i.test(homeserver)) {
    errors.push({ code: "invalid_homeserver_url", message: "homeserver must start with http:// or https://" });
  }

  if (!room) errors.push({ code: "missing_room", message: "room is required" });
  if (room && !room.startsWith("#") && !room.startsWith("!")) {
    errors.push({ code: "invalid_room", message: "room must start with # or !" });
  }

  if (!["password", "token", "shared-secret"].includes(authMode)) {
    errors.push({ code: "invalid_auth_mode", message: "auth mode must be password, token, or shared-secret" });
  }
  if (authMode === "shared-secret" && !matrixSupportsSharedSecret(homeserver)) {
    errors.push({
      code: "invalid_auth_mode_for_homeserver",
      message: "shared-secret mode is not supported for matrix.org; use password or token"
    });
  }

  if (authMode === "password") {
    if (!cfg.userId) errors.push({ code: "missing_user", message: "agent user id is required for password mode" });
    if (!cfg.password && !cfg.token) {
      errors.push({ code: "missing_password", message: "password (or existing token) is required for password mode" });
    }
  }
  if (authMode === "token") {
    if (!cfg.token) errors.push({ code: "missing_token", message: "token is required for token mode" });
  }
  if (authMode === "shared-secret") {
    if (!cfg.registrationSharedSecret) {
      errors.push({ code: "missing_registration_shared_secret", message: "registration shared secret is required" });
    }
    if (!cfg.userId) {
      warnings.push({ code: "missing_user_shared_secret", message: "agent user id is recommended for shared-secret mode" });
    }
  }

  const host = homeserverHost(homeserver);
  const roomServer = matrixServerFromId(room);
  if (host && roomServer && host !== roomServer) {
    warnings.push({
      code: "room_server_mismatch",
      message: `room server (${roomServer}) differs from homeserver (${host})`
    });
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings
  };
}

async function matrixLiveTest(cfg) {
  const checks = [];
  try {
    await matrixVersions({ homeserver: cfg.homeserver });
    checks.push({ name: "homeserver reachable", ok: true });
  } catch (err) {
    checks.push({ name: "homeserver reachable", ok: false, error: String(err?.message || err) });
    return { ok: false, checks };
  }

  let token = cfg.token;
  if (!token && cfg.authMode === "password" && cfg.userId && cfg.password) {
    try {
      const login = await loginMatrixWithPassword({
        homeserver: cfg.homeserver,
        userId: cfg.userId,
        password: cfg.password
      });
      token = login.token;
      checks.push({ name: "password login", ok: true, userId: login.userId || cfg.userId });
    } catch (err) {
      checks.push({ name: "password login", ok: false, error: String(err?.message || err) });
      return { ok: false, checks };
    }
  }

  if (!token) {
    checks.push({ name: "auth verification", ok: false, error: "missing token for whoami" });
    return { ok: false, checks };
  }

  try {
    const who = await matrixWhoAmI({ homeserver: cfg.homeserver, token });
    checks.push({ name: "whoami", ok: true, userId: who.userId || null });
  } catch (err) {
    checks.push({ name: "whoami", ok: false, error: String(err?.message || err) });
    return { ok: false, checks };
  }

  return { ok: true, checks };
}

async function ensureSharedSecretToken({ cfg, rootDir }) {
  if (cfg.authMode !== "shared-secret" || cfg.token) return cfg;
  const agentName = String(cfg.agentName || "parity coder").trim() || "parity coder";
  const agentHouse = path.join(rootDir, "world", "house", agentName);
  const credentials = await ensureMatrixCredentials({
    agentName,
    agentHouse,
    config: {
      homeserver: cfg.homeserver,
      user: cfg.userId || null,
      token: cfg.token || null,
      registrationSharedSecret: cfg.registrationSharedSecret || null,
      adminToken: cfg.adminToken || null
    }
  });
  return {
    ...cfg,
    token: credentials.token || cfg.token,
    userId: cfg.userId || credentials.user || ""
  };
}

async function matrixJoinRoom({ homeserver, token, room }) {
  const endpoint = `${normalizeHomeserver(homeserver)}/_matrix/client/v3/join/${encodeURIComponent(room)}`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({})
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const code = payload?.errcode ? ` code=${payload.errcode}` : "";
    const message = payload?.error ? ` error=${payload.error}` : "";
    throw new Error(`matrix join failed: status=${response.status}${code}${message}`);
  }
  return String(payload?.room_id || room);
}

async function matrixSendRoomMessage({ homeserver, token, roomId, content }) {
  const txnId = `pyash-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const endpoint = `${normalizeHomeserver(homeserver)}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${encodeURIComponent(txnId)}`;
  const response = await fetch(endpoint, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      msgtype: "m.text",
      body: String(content ?? "")
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const code = payload?.errcode ? ` code=${payload.errcode}` : "";
    const message = payload?.error ? ` error=${payload.error}` : "";
    throw new Error(`matrix send failed: status=${response.status}${code}${message}`);
  }
  return String(payload?.event_id || "");
}

async function matrixCreateDirectRoom({ homeserver, token, executiveUsername }) {
  const endpoint = `${normalizeHomeserver(homeserver)}/_matrix/client/v3/createRoom`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      is_direct: true,
      invite: [String(executiveUsername ?? "")],
      preset: "trusted_private_chat"
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const code = payload?.errcode ? ` code=${payload.errcode}` : "";
    const message = payload?.error ? ` error=${payload.error}` : "";
    throw new Error(`matrix createRoom failed: status=${response.status}${code}${message}`);
  }
  const roomId = String(payload?.room_id || "");
  if (!roomId) throw new Error("matrix createRoom missing room_id");
  return roomId;
}

async function matrixPostSetupTest(cfg) {
  const checks = [];
  const live = await matrixLiveTest(cfg);
  checks.push(...(live.checks || []));
  if (!live.ok) return { ok: false, checks };

  if (!cfg.token) {
    checks.push({ name: "room join + greeting", ok: true, note: "skipped: no token available" });
    if (cfg.executiveUsername) {
      checks.push({ name: "executive dm greeting", ok: true, note: "skipped: no token available" });
    }
    return { ok: true, checks };
  }

  try {
    const joinedRoomId = await matrixJoinRoom({
      homeserver: cfg.homeserver,
      token: cfg.token,
      room: cfg.room
    });
    checks.push({ name: "join room", ok: true, roomId: joinedRoomId });
    const roomEventId = await matrixSendRoomMessage({
      homeserver: cfg.homeserver,
      token: cfg.token,
      roomId: joinedRoomId,
      content: "Pyash configure test greeting. If you can read this, channel setup works."
    });
    checks.push({ name: "send room greeting", ok: true, eventId: roomEventId });
  } catch (err) {
    checks.push({ name: "room join + greeting", ok: false, error: String(err?.message || err) });
    return { ok: false, checks };
  }

  if (cfg.executiveUsername) {
    try {
      const dmRoomId = await matrixCreateDirectRoom({
        homeserver: cfg.homeserver,
        token: cfg.token,
        executiveUsername: cfg.executiveUsername
      });
      checks.push({ name: "create executive dm room", ok: true, roomId: dmRoomId });
      const dmEventId = await matrixSendRoomMessage({
        homeserver: cfg.homeserver,
        token: cfg.token,
        roomId: dmRoomId,
        content: "Pyash configure DM test greeting. Executive messaging is working."
      });
      checks.push({ name: "send executive dm greeting", ok: true, eventId: dmEventId });
    } catch (err) {
      checks.push({ name: "executive dm greeting", ok: false, error: String(err?.message || err) });
      return { ok: false, checks };
    }
  }

  return { ok: true, checks };
}

async function matrixDoctor({ rootDir }) {
  const loaded = await loadMatrixConfigFromSecret(rootDir);
  const configExists = Boolean(loaded.homeserver || loaded.room || loaded.token || loaded.userId || loaded.authMode || loaded.registrationSharedSecret);
  if (!configExists) {
    return {
      ok: false,
      issues: [{ code: "missing_config", kind: "missing", message: "matrix channel config is missing from configure/secret.pya" }],
      remedies: ["run: pyash configure channel matrix"]
    };
  }

  const resolved = await ensureSharedSecretToken({ cfg: { ...loaded, agentName: "parity coder" }, rootDir });
  const verification = matrixVerification(resolved);
  const issues = [];
  for (const err of verification.errors) issues.push({ code: err.code, kind: "invalid", message: err.message });
  for (const warn of verification.warnings) issues.push({ code: warn.code, kind: "warning", message: warn.message });

  let live = null;
  if (verification.ok) {
    live = await matrixLiveTest(resolved);
    if (!live.ok) {
      issues.push({ code: "live_check_failed", kind: "unreachable", message: "live check failed; inspect checks for details" });
    }
  }

  const remedies = [];
  if (!verification.ok) {
    remedies.push("rerun configure: pyash configure channel matrix");
  }
  if (issues.some((issue) => issue.code === "room_server_mismatch")) {
    remedies.push("set room server suffix to match homeserver host");
  }
  if (issues.some((issue) => issue.code === "live_check_failed")) {
    remedies.push("verify homeserver reachability and credentials, then rerun: pyash configure channel matrix test");
  }

  return {
    ok: verification.ok && (!live || live.ok),
    config: redactMatrixConfig(resolved),
    issues,
    live,
    remedies
  };
}

function collectMatrixFromFlags({ args, prior }) {
  const homeserver = normalizeHomeserver(parseArgValue(args, "--homeserver") ?? prior.homeserver ?? "");
  const host = homeserverHost(homeserver);
  const providedRoom = parseArgValue(args, "--room");
  const room = providedRoom
    ? ensureMatrixIdServer(providedRoom, host)
    : rewriteMatrixIdServer(prior.room ?? "", host);
  const executiveUsername = ensureMatrixUserServer(parseArgValue(args, "--executive") ?? prior.executiveUsername ?? "", host);
  const userId = ensureMatrixUserServer(parseArgValue(args, "--agent-user-id") ?? prior.userId ?? "", host);
  const authMode = String(parseArgValue(args, "--auth-mode") ?? prior.authMode ?? "password").trim().toLowerCase();
  const token = parseArgValue(args, "--token") ?? prior.token ?? "";
  const password = parseArgValue(args, "--password") ?? "";
  const registrationSharedSecret = parseArgValue(args, "--registration-shared-secret") ?? prior.registrationSharedSecret ?? "";
  const adminToken = parseArgValue(args, "--admin-token") ?? prior.adminToken ?? "";
  const agentName = parseArgValue(args, "--agent") ?? "parity coder";
  const writeAgentPolicy = parseTruthy(parseArgValue(args, "--write-agent-policy"), true);
  const mentionGate = parseTruthy(parseArgValue(args, "--mention-gate"), false);

  return {
    homeserver,
    room,
    executiveUsername,
    userId,
    authMode,
    token,
    password,
    registrationSharedSecret,
    adminToken,
    agentName,
    writeAgentPolicy,
    mentionGate
  };
}

async function collectMatrixInteractive({ prior, mode, rootDir }) {
  const quickstart = mode !== "advanced";
  const printer = sectionPrinter();
  const muteOutput = new MuteWritable(process.stdout);
  const rl = readline.createInterface({ input: process.stdin, output: muteOutput, terminal: true });
  try {
    const ask = async (label, fallback = "") => {
      muteOutput.muted = false;
      const shown = fallback ? ` [${fallback}]` : "";
      const v = (await rl.question(`${label}${shown}: `)).trim();
      return v || fallback;
    };
    const askYesNo = async (label, fallback = true) => {
      muteOutput.muted = false;
      const shown = fallback ? "Y/n" : "y/N";
      const v = (await rl.question(`${label} [${shown}]: `)).trim().toLowerCase();
      if (!v) return fallback;
      return v === "y" || v === "yes";
    };
    const askSecret = async (label, fallback = "") => {
      const shown = fallback ? " [set]" : "";
      muteOutput.muted = false;
      process.stdout.write(`${label}${shown}: `);
      muteOutput.muted = true;
      const v = (await rl.question("")).trim();
      muteOutput.muted = false;
      process.stdout.write("\n");
      return v || fallback;
    };
    const validateHomeserverUrl = (value) => {
      try {
        const url = new URL(value);
        if (!/^https?:$/i.test(url.protocol)) {
          return "homeserver must use http or https";
        }
        return "";
      } catch {
        return "homeserver must be a valid URL or hostname";
      }
    };

    printer.header("A.1 Homeserver");
    printer.why("All channel and auth operations depend on the homeserver endpoint.");
    printer.how("Enter server host or full URL. If protocol is omitted, https:// is assumed.");
    printer.examples("matrix.org | https://matrix.liberit.ca");
    let homeserver = "";
    while (!homeserver) {
      const entered = await ask("Matrix homeserver", prior.homeserver || "https://matrix.org");
      const normalized = normalizeHomeserver(entered);
      const issue = validateHomeserverUrl(normalized);
      if (issue) {
        textOut(`- invalid: ${issue}`);
        continue;
      }
      let reachable = false;
      try {
        await matrixVersions({ homeserver: normalized });
        reachable = true;
        textOut("- check: homeserver reachable");
      } catch (err) {
        textOut(`- warning: homeserver check failed (${String(err?.message || err)})`);
      }
      if (!reachable) {
        const keep = await askYesNo("Keep this homeserver anyway", false);
        if (!keep) continue;
      }
      homeserver = normalized;
      textOut(`- server set to ${homeserver}`);
      textOut(`- server check ${reachable ? "passed" : "not verified"}`);
    }
    const host = homeserverHost(homeserver);

    printer.header("B.1 Matrix Auth");
    printer.why("The caterer needs credentials to verify and send.");
    const supportsSharedSecret = matrixSupportsSharedSecret(homeserver);
    const allowedAuthModes = supportsSharedSecret
      ? ["password", "token", "shared-secret"]
      : ["password", "token"];
    printer.how(supportsSharedSecret
      ? "Choose password for easiest setup, token for existing access token, shared-secret for self-hosted Synapse."
      : "Choose password for easiest setup, or token for existing access token.");
    printer.examples(allowedAuthModes.join(" | "));
    let authMode = "";
    while (!authMode) {
      const defaultAuth = allowedAuthModes.includes(String(prior.authMode || "").trim().toLowerCase())
        ? String(prior.authMode || "").trim().toLowerCase()
        : "password";
      const picked = String(await ask("Auth mode", defaultAuth)).trim().toLowerCase();
      if (!allowedAuthModes.includes(picked)) {
        textOut(`- invalid: auth mode must be ${allowedAuthModes.join(", ")}`);
        continue;
      }
      authMode = picked;
    }

    let userId = ensureMatrixUserServer(prior.userId || "", host);
    let token = prior.token || "";
    let password = "";
    let registrationSharedSecret = prior.registrationSharedSecret || "";
    let adminToken = prior.adminToken || "";
    let authOk = false;
    while (!authOk) {
      if (authMode === "password") {
        printer.header("B.2 Password Flow");
        printer.why("Password can be exchanged for token automatically.");
        printer.how("Use your bot/service account user id and password.");
        printer.examples("@pyash-agent:matrix.org");
        userId = ensureMatrixUserServer(await ask("Agent Matrix user id", userId || "@pyash-agent"), host);
        password = "";
        while (!password) {
          password = await askSecret("Matrix password");
          if (!password) textOut("- invalid: password is required for password mode");
        }
        token = "";
        registrationSharedSecret = "";
        adminToken = "";
      } else if (authMode === "token") {
        printer.header("B.2 Token Flow");
        printer.why("Use existing access token without password exchange.");
        printer.how("Get from Matrix client session export or login API response.");
        printer.examples("POST /_matrix/client/v3/login and copy access_token");
        token = "";
        while (!token) {
          token = await askSecret("Access token", token);
          if (!token) textOut("- invalid: access token is required for token mode");
        }
        userId = ensureMatrixUserServer(await ask("Agent Matrix user id (optional)", userId), host);
        registrationSharedSecret = "";
        adminToken = "";
      } else {
        printer.header("B.2 Shared-Secret Flow");
        printer.why("Self-hosted Synapse bootstrap can register agents via shared secret.");
        printer.how("Read registration_shared_secret from homeserver.yaml (Synapse).");
        printer.examples("registration_shared_secret: <value>");
        textOut("This step configures the default agent account for this channel setup.");
        textOut("Other agents should use their own Matrix user identities in their own setup flows.");
        registrationSharedSecret = "";
        while (!registrationSharedSecret) {
          registrationSharedSecret = await askSecret("Registration shared secret", registrationSharedSecret);
          if (!registrationSharedSecret) textOut("- invalid: registration shared secret is required for shared-secret mode");
        }
        userId = ensureMatrixUserServer(await ask("Default agent Matrix user id", userId || "@pyash-agent"), host);
        adminToken = "";
        token = "";
        password = "";
      }

      try {
        let authCfg = {
          homeserver,
          userId,
          authMode,
          token,
          password,
          registrationSharedSecret,
          adminToken,
          agentName: "parity coder"
        };
        if (authMode === "password" && !authCfg.token && authCfg.userId && authCfg.password) {
          const login = await loginMatrixWithPassword({
            homeserver: authCfg.homeserver,
            userId: authCfg.userId,
            password: authCfg.password
          });
          authCfg = { ...authCfg, token: login.token, userId: login.userId || authCfg.userId };
        }
        authCfg = await ensureSharedSecretToken({ cfg: authCfg, rootDir });
        const live = await matrixLiveTest(authCfg);
        if (!live.ok) throw new Error((live.checks || []).filter((c) => !c.ok).map((c) => c.error || c.name).join("; ") || "auth check failed");
        token = authCfg.token;
        userId = authCfg.userId || userId;
        textOut("- auth check passed");
        authOk = true;
      } catch (err) {
        textOut(`- auth check failed (${String(err?.message || err)})`);
        const retry = await askYesNo("Retry authentication step", true);
        if (!retry) throw err;
      }
    }

    printer.header("C.1 Channel");
    printer.why("The agent should join a target room and send a greeting test.");
    printer.how("Use room id (!...) for reliability, alias (#...) is acceptable.");
    printer.examples("!roomid:matrix.liberit.ca | #pyash:matrix.liberit.ca");
    let room = "";
    while (!room) {
      const roomDefault = rewriteMatrixIdServer(prior.room || "#pyash", host);
      const enteredRoom = await ask("Room id or alias (!room:server or #alias:server)", roomDefault);
      const normalizedRoom = ensureMatrixIdServer(enteredRoom, host);
      if (!normalizedRoom.startsWith("#") && !normalizedRoom.startsWith("!")) {
        textOut("- invalid: room must start with # or !");
        continue;
      }
      room = normalizedRoom;
    }

    let executiveUsername = ensureMatrixUserServer(prior.executiveUsername || "", host);
    let writeAgentPolicy = true;
    let agentName = "parity coder";
    let mentionGate = false;

    printer.header("D.1 Executive Test");
    printer.why("Optional executive user can receive a DM greeting test.");
    printer.how("Set a user id to test direct messaging; leave blank to skip.");
    printer.examples("@andrii:matrix.liberit.ca");
    executiveUsername = ensureMatrixUserServer(await ask("Executive user (optional DM target)", executiveUsername), host);
    if (executiveUsername) {
      try {
        const dmRoomId = await matrixCreateDirectRoom({
          homeserver,
          token,
          executiveUsername
        });
        await matrixSendRoomMessage({
          homeserver,
          token,
          roomId: dmRoomId,
          content: "Pyash configure DM test greeting. Executive messaging is working."
        });
        textOut("- executive DM test passed");
      } catch (err) {
        textOut(`- executive DM test failed (${String(err?.message || err)})`);
      }
    }

    if (!quickstart) {
      printer.header("E.1 Agent Conduct Files");
      printer.why("Optional local channel conduct file can be generated per agent.");
      printer.how("Enable when you want world/house/<agent>/conduct/channels.pya written.");
      printer.examples("agent=parity coder, mention gate=lie");
      writeAgentPolicy = await askYesNo("Write agent channel conduct file", true);
      if (writeAgentPolicy) {
        agentName = await ask("Agent name", agentName);
        mentionGate = parseTruthy(await ask("Mention gate (truth/lie)", mentionGate ? "truth" : "lie"), mentionGate);
      }
    }

    return {
      homeserver,
      room,
      executiveUsername,
      userId,
      authMode,
      token,
      password,
      registrationSharedSecret,
      adminToken,
      writeAgentPolicy,
      agentName,
      mentionGate,
      mode: quickstart ? "quickstart" : "advanced"
    };
  } finally {
    rl.close();
  }
}

function normalizeMatrixCollected(cfg) {
  const homeserver = normalizeHomeserver(cfg.homeserver);
  const host = homeserverHost(homeserver);
  const room = ensureMatrixIdServer(cfg.room, host);
  return {
    ...cfg,
    homeserver,
    room,
    executiveUsername: ensureMatrixUserServer(cfg.executiveUsername, host),
    userId: ensureMatrixUserServer(cfg.userId, host),
    authMode: String(cfg.authMode || "password").trim().toLowerCase()
  };
}

async function createMatrixWritePlan({ rootDir, cfg }) {
  const secretPath = path.join(rootDir, "configure", "secret.pya");
  const secretExisting = await readText(secretPath);

  const matrixBlockPlan = planManagedUpsert({
    existing: secretExisting,
    blockName: MATRIX_BLOCK_NAME,
    content: buildMatrixMapBlock(cfg)
  });

  const channelBlockPlan = planManagedUpsert({
    existing: matrixBlockPlan.nextText,
    blockName: CHANNEL_CONFIG_BLOCK_NAME,
    content: buildChannelConfigureBlock()
  });

  const writes = [{
    path: secretPath,
    changed: channelBlockPlan.changed || matrixBlockPlan.changed,
    action: channelBlockPlan.action,
    preview: [MATRIX_BLOCK_NAME, CHANNEL_CONFIG_BLOCK_NAME],
    nextText: channelBlockPlan.nextText
  }];

  if (cfg.writeAgentPolicy && cfg.agentName && cfg.agentName.trim()) {
    const channelPath = path.join(rootDir, "world", "house", cfg.agentName, "conduct", "channels.pya");
    const channelExisting = await readText(channelPath);
    const policyPlan = planManagedUpsert({
      existing: channelExisting,
      blockName: MATRIX_POLICY_BLOCK_NAME,
      content: buildChannelConductBlock({
        homeserver: cfg.homeserver,
        room: cfg.room,
        mentionGate: cfg.mentionGate
      })
    });
    writes.push({
      path: channelPath,
      changed: policyPlan.changed,
      action: policyPlan.action,
      preview: [MATRIX_POLICY_BLOCK_NAME],
      nextText: policyPlan.nextText
    });

    const calendarPath = path.join(rootDir, "world", "house", cfg.agentName, "conduct", "calendar.pya");
    const calendarExisting = await readText(calendarPath);
    const calendarPlan = upsertMatrixPollCalendarText({
      existing: calendarExisting,
      agentName: cfg.agentName,
      intervalMinutes: 1
    });
    writes.push({
      path: calendarPath,
      changed: calendarPlan.changed,
      action: calendarPlan.action,
      preview: ["matrix poll calendar"],
      nextText: calendarPlan.nextText
    });
  }

  return {
    writes,
    changed: writes.some((item) => item.changed)
  };
}

async function applyWritePlan(plan) {
  for (const write of plan.writes) {
    if (!write.changed) continue;
    await ensureDirForFile(write.path);
    await fs.writeFile(write.path, write.nextText, "utf8");
  }
}

function writePlanSummary(plan) {
  return plan.writes.map((write) => ({
    path: write.path,
    changed: write.changed,
    action: write.action,
    blocks: write.preview
  }));
}

async function configureChannelList({ json }) {
  const payload = {
    ok: true,
    caterers: [{
      name: MATRIX_CATERER_NAME,
      supports: ["configure", "test", "doctor"]
    }]
  };
  if (json) jsonOut(payload);
  else {
    textOut("Available caterers:");
    textOut("- matrix (configure, test, doctor)");
  }
}

async function configureMatrix({ args }) {
  const rootDir = path.resolve(parseArgValue(args, "--root") ?? process.cwd());
  const json = hasFlag(args, "--json");
  const print = hasFlag(args, "--print");
  const dryRun = hasFlag(args, "--dry-run");
  const nonInteractive = hasFlag(args, "--non-interactive");
  const mode = hasFlag(args, "--advanced") ? "advanced" : "quickstart";
  const testNowFlag = parseArgValue(args, "--test-now");

  const prior = await loadMatrixConfigFromSecret(rootDir);
  const collected = nonInteractive
    ? collectMatrixFromFlags({ args, prior })
    : await collectMatrixInteractive({ prior, mode, rootDir });

  let cfg = normalizeMatrixCollected(collected);

  const verification = matrixVerification(cfg);
  if (!verification.ok) {
    const payload = {
      ok: false,
      stage: "verification",
      verification,
      config: redactMatrixConfig(cfg)
    };
    if (json) jsonOut(payload);
    else {
      textOut("verification failed:");
      for (const err of verification.errors) textOut(`- ${err.code}: ${err.message}`);
      for (const warn of verification.warnings) textOut(`- warning ${warn.code}: ${warn.message}`);
    }
    process.exit(1);
  }

  if (cfg.authMode === "password" && !cfg.token && cfg.userId && cfg.password) {
    const login = await loginMatrixWithPassword({
      homeserver: cfg.homeserver,
      userId: cfg.userId,
      password: cfg.password
    });
    cfg = { ...cfg, token: login.token, userId: login.userId || cfg.userId };
  }
  cfg = await ensureSharedSecretToken({ cfg, rootDir });

  const runTestNow = testNowFlag == null ? !nonInteractive : parseTruthy(testNowFlag, false);
  let live = null;
  if (runTestNow) {
    live = await matrixPostSetupTest(cfg);
  }

  const plan = await createMatrixWritePlan({ rootDir, cfg });
  if (!dryRun) {
    await applyWritePlan(plan);
  }

  const out = {
    ok: true,
    route: "configure channel matrix",
    rootDir,
    mode: nonInteractive ? "non-interactive" : cfg.mode || mode,
    dryRun,
    changed: plan.changed,
    writes: writePlanSummary(plan),
    verification,
    live,
    config: redactMatrixConfig(cfg)
  };

  if (json) {
    jsonOut(out);
    return;
  }

  textOut("configure channel matrix complete");
  for (const w of out.writes) {
    textOut(`- ${w.path} (${w.changed ? "changed" : "unchanged"}, ${w.action})`);
  }
  if (runTestNow) {
    textOut(`post-config test ${live?.ok ? "passed" : "failed"}`);
    for (const check of live?.checks || []) {
      textOut(`- ${check.ok ? "ok" : "fail"}: ${check.name}${check.error ? ` (${check.error})` : ""}`);
    }
  }
  if (print) {
    textOut("");
    textOut("planned blocks:");
    for (const w of plan.writes) {
      textOut(`## ${w.path}`);
      textOut(renderShortPreview(w.nextText));
    }
  }
}

function renderShortPreview(text) {
  const trimmed = String(text || "").trimEnd();
  const lines = trimmed.split("\n");
  if (lines.length <= 30) return trimmed;
  return `${lines.slice(0, 30).join("\n")}\n... (${lines.length - 30} more lines)`;
}

async function configureMatrixTest({ args }) {
  const rootDir = path.resolve(parseArgValue(args, "--root") ?? process.cwd());
  const json = hasFlag(args, "--json");
  const agentName = parseArgValue(args, "--agent") ?? "parity coder";
  const loaded = await loadMatrixConfigFromSecret(rootDir);
  const resolved = await ensureSharedSecretToken({ cfg: { ...loaded, agentName }, rootDir });
  const verification = matrixVerification(resolved);
  if (!verification.ok) {
    const payload = { ok: false, stage: "verification", verification, config: redactMatrixConfig(resolved) };
    if (json) jsonOut(payload);
    else {
      textOut("matrix test failed (verification):");
      for (const err of verification.errors) textOut(`- ${err.code}: ${err.message}`);
    }
    process.exit(1);
  }

  const live = await matrixPostSetupTest(resolved);
  const payload = {
    ok: live.ok,
    route: "configure channel matrix test",
    checks: live.checks,
    config: redactMatrixConfig(resolved)
  };
  if (json) jsonOut(payload);
  else {
    textOut(`matrix test ${live.ok ? "passed" : "failed"}`);
    for (const check of live.checks) {
      textOut(`- ${check.ok ? "ok" : "fail"}: ${check.name}${check.error ? ` (${check.error})` : ""}`);
    }
  }
  if (!live.ok) process.exit(1);
}

async function configureMatrixDoctor({ args }) {
  const rootDir = path.resolve(parseArgValue(args, "--root") ?? process.cwd());
  const json = hasFlag(args, "--json");
  const report = await matrixDoctor({ rootDir });
  if (json) jsonOut(report);
  else {
    textOut(`matrix doctor ${report.ok ? "ok" : "needs attention"}`);
    if (report.issues?.length) {
      textOut("issues:");
      for (const issue of report.issues) {
        textOut(`- ${issue.kind} ${issue.code}: ${issue.message}`);
      }
    }
    if (report.remedies?.length) {
      textOut("remedies:");
      for (const remedy of report.remedies) textOut(`- ${remedy}`);
    }
  }
  if (!report.ok) process.exit(1);
}

function normalizePort(raw, fallback = 59652) {
  const num = Number(raw);
  if (!Number.isFinite(num)) return fallback;
  const whole = Math.floor(num);
  if (whole < 1 || whole > 65535) return fallback;
  return whole;
}

function normalizePositiveInt(raw, fallback = 1) {
  const num = Number(raw);
  if (!Number.isFinite(num) || num <= 0) return fallback;
  return Math.floor(num);
}

function collectOrchestratorFromFlags({ args, prior }) {
  return {
    mode: String(parseArgValue(args, "--mode") ?? prior.mode ?? "container").trim().toLowerCase(),
    host: String(parseArgValue(args, "--host") ?? prior.host ?? "127.0.0.1").trim(),
    port: normalizePort(parseArgValue(args, "--port") ?? prior.port ?? 59652, 59652),
    autostart: parseTruthy(parseArgValue(args, "--autostart"), parseTruthy(prior.autostart, true)),
    healthMinute: normalizePositiveInt(parseArgValue(args, "--health-minute") ?? prior.healthMinute ?? 1, 1)
  };
}

async function collectOrchestratorInteractive({ prior }) {
  const printer = sectionPrinter();
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const ask = async (label, fallback = "") => {
      const shown = fallback ? ` [${fallback}]` : "";
      const v = (await rl.question(`${label}${shown}: `)).trim();
      return v || fallback;
    };
    const askYesNo = async (label, fallback = true) => {
      const shown = fallback ? "Y/n" : "y/N";
      const v = (await rl.question(`${label} [${shown}]: `)).trim().toLowerCase();
      if (!v) return fallback;
      return v === "y" || v === "yes";
    };

    printer.header("A.1 Orchestrator Endpoint");
    printer.why("Host and port define where host-side pyash reaches the running orchestrator.");
    printer.how("Use container mode for Docker setups. Default port 59652.");
    printer.examples("mode=container host=127.0.0.1 port=59652");
    let mode = "";
    while (!mode) {
      const picked = String(await ask("Mode (container/local)", prior.mode || "container")).trim().toLowerCase();
      if (picked !== "container" && picked !== "local") {
        textOut("- invalid: mode must be container or local");
        continue;
      }
      mode = picked;
    }
    const host = String(await ask("Host", prior.host || "127.0.0.1")).trim() || "127.0.0.1";
    const port = normalizePort(await ask("Port", String(prior.port || 59652)), 59652);

    printer.header("B.1 Service Behavior");
    printer.why("Autostart and health cadence control background supervision behavior.");
    printer.how("Keep autostart on and health minute low for quick failures.");
    printer.examples("autostart=yes health minute=1");
    const autostart = await askYesNo("Autostart services", parseTruthy(prior.autostart, true));
    const healthMinute = normalizePositiveInt(await ask("Health minute cadence", String(prior.healthMinute || 1)), 1);

    return { mode, host, port, autostart, healthMinute };
  } finally {
    rl.close();
  }
}

function orchestratorVerification(cfg) {
  const errors = [];
  const mode = String(cfg.mode ?? "").trim().toLowerCase();
  if (mode !== "container" && mode !== "local") {
    errors.push({ code: "invalid_mode", message: "mode must be container or local" });
  }
  if (!String(cfg.host ?? "").trim()) {
    errors.push({ code: "missing_host", message: "host is required" });
  }
  const port = Number(cfg.port);
  if (!Number.isFinite(port) || port < 1 || port > 65535) {
    errors.push({ code: "invalid_port", message: "port must be between 1 and 65535" });
  }
  return { ok: errors.length === 0, errors, warnings: [] };
}

async function createOrchestratorWritePlan({ rootDir, cfg }) {
  const secretPath = path.join(rootDir, "configure", "secret.pya");
  const secretExisting = await readText(secretPath);
  const plan = planManagedUpsert({
    existing: secretExisting,
    blockName: ORCHESTRATOR_CONFIG_BLOCK_NAME,
    content: buildOrchestratorConfigureBlock(cfg)
  });
  return {
    writes: [{
      path: secretPath,
      changed: plan.changed,
      action: plan.action,
      preview: [ORCHESTRATOR_CONFIG_BLOCK_NAME],
      nextText: plan.nextText
    }],
    changed: plan.changed
  };
}

async function configureOrchestrator({ args }) {
  const rootDir = path.resolve(parseArgValue(args, "--root") ?? process.cwd());
  const json = hasFlag(args, "--json");
  const print = hasFlag(args, "--print");
  const dryRun = hasFlag(args, "--dry-run");
  const nonInteractive = hasFlag(args, "--non-interactive");
  const prior = await loadOrchestratorConfigFromSecret(rootDir);
  const cfg = nonInteractive
    ? collectOrchestratorFromFlags({ args, prior })
    : await collectOrchestratorInteractive({ prior });

  const verification = orchestratorVerification(cfg);
  if (!verification.ok) {
    const out = { ok: false, stage: "verification", verification, config: cfg };
    if (json) jsonOut(out);
    else {
      textOut("verification failed:");
      for (const err of verification.errors) textOut(`- ${err.code}: ${err.message}`);
    }
    process.exit(1);
  }

  const plan = await createOrchestratorWritePlan({ rootDir, cfg });
  if (!dryRun) await applyWritePlan(plan);

  const out = {
    ok: true,
    route: "configure orchestrator",
    rootDir,
    dryRun,
    changed: plan.changed,
    writes: writePlanSummary(plan),
    verification,
    config: cfg
  };
  if (json) {
    jsonOut(out);
    return;
  }
  textOut("configure orchestrator complete");
  for (const w of out.writes) {
    textOut(`- ${w.path} (${w.changed ? "changed" : "unchanged"}, ${w.action})`);
  }
  if (print) {
    textOut("");
    textOut("planned blocks:");
    for (const w of plan.writes) {
      textOut(`## ${w.path}`);
      textOut(renderShortPreview(w.nextText));
    }
  }
}

function collectMindFromFlags({ args, prior }) {
  return {
    backend: String(parseArgValue(args, "--backend") ?? prior.backend ?? "ollama command mind").trim(),
    host: normalizeHomeserver(parseArgValue(args, "--host") ?? prior.host ?? "http://localhost:11434"),
    model: String(parseArgValue(args, "--model") ?? prior.model ?? "gpt-oss:latest").trim()
  };
}

async function collectMindInteractive({ prior }) {
  const printer = sectionPrinter();
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const ask = async (label, fallback = "") => {
      const shown = fallback ? ` [${fallback}]` : "";
      const v = (await rl.question(`${label}${shown}: `)).trim();
      return v || fallback;
    };

    printer.header("A.1 Mind Relay");
    printer.why("Channel and agent responses require a configured mind relay backend.");
    printer.how("Use ollama command mind unless you have a different relay module.");
    printer.examples("backend=ollama command mind");
    const backend = String(await ask("Mind backend", prior.backend || "ollama command mind")).trim();

    printer.header("B.1 Provider Endpoint");
    printer.why("Mind backend uses this host for model calls.");
    printer.how("Use full URL; protocol defaults to https when omitted.");
    printer.examples("http://localhost:11434");
    const host = normalizeHomeserver(await ask("Mind host", prior.host || "http://localhost:11434"));

    printer.header("C.1 Default Model");
    printer.why("Used when agent/mind facts do not specify an explicit model.");
    printer.how("Set a stable local model tag.");
    printer.examples("gpt-oss:latest");
    const model = String(await ask("Mind model", prior.model || "gpt-oss:latest")).trim();

    return { backend, host, model };
  } finally {
    rl.close();
  }
}

function mindVerification(cfg) {
  const errors = [];
  if (!String(cfg.backend ?? "").trim()) errors.push({ code: "missing_backend", message: "backend is required" });
  const host = normalizeHomeserver(cfg.host);
  if (!host) errors.push({ code: "missing_host", message: "host is required" });
  if (!/^https?:\/\//i.test(host)) errors.push({ code: "invalid_host", message: "host must start with http:// or https://" });
  if (!String(cfg.model ?? "").trim()) errors.push({ code: "missing_model", message: "model is required" });
  return { ok: errors.length === 0, errors, warnings: [] };
}

async function mindLiveTest(cfg) {
  const host = normalizeHomeserver(cfg.host);
  const checks = [];
  try {
    const response = await fetch(`${host}/api/tags`, { method: "GET" });
    if (!response.ok) throw new Error(`status=${response.status}`);
    checks.push({ name: "host reachable", ok: true });
  } catch (err) {
    checks.push({ name: "host reachable", ok: false, error: String(err?.message || err) });
    return { ok: false, checks };
  }
  return { ok: true, checks };
}

function buildMindConfigureBlock(cfg) {
  return [
    "su name mind configure be map def",
    `  su name backend ob text ${quoteText(cfg.backend)} ya`,
    `  su name host ob text ${quoteText(cfg.host)} ya`,
    `  su name model ob text ${quoteText(cfg.model)} ya`,
    "prah"
  ].join("\n");
}

function buildMindDefaultsBlock(cfg) {
  return [
    `exists su name mind backend be default ob name ${cfg.backend} ya`,
    `exists su name ollama host ob text ${quoteText(cfg.host)} be default ya`,
    `exists su name ai host ob text ${quoteText(cfg.host)} be default ya`,
    `exists su name mind model ob text ${quoteText(cfg.model)} be default ya`
  ].join("\n");
}

async function createMindWritePlan({ rootDir, cfg }) {
  const secretPath = path.join(rootDir, "configure", "secret.pya");
  const secretExisting = await readText(secretPath);
  const configPlan = planManagedUpsert({
    existing: secretExisting,
    blockName: MIND_CONFIG_BLOCK_NAME,
    content: buildMindConfigureBlock(cfg)
  });
  const defaultsPlan = planManagedUpsert({
    existing: configPlan.nextText,
    blockName: MIND_DEFAULTS_BLOCK_NAME,
    content: buildMindDefaultsBlock(cfg)
  });
  return {
    writes: [{
      path: secretPath,
      changed: configPlan.changed || defaultsPlan.changed,
      action: defaultsPlan.action,
      preview: [MIND_CONFIG_BLOCK_NAME, MIND_DEFAULTS_BLOCK_NAME],
      nextText: defaultsPlan.nextText
    }],
    changed: configPlan.changed || defaultsPlan.changed
  };
}

async function configureMind({ args }) {
  const rootDir = path.resolve(parseArgValue(args, "--root") ?? process.cwd());
  const json = hasFlag(args, "--json");
  const print = hasFlag(args, "--print");
  const dryRun = hasFlag(args, "--dry-run");
  const nonInteractive = hasFlag(args, "--non-interactive");
  const testNowFlag = parseArgValue(args, "--test-now");
  const prior = await loadMindConfigFromSecret(rootDir);
  const cfg = nonInteractive
    ? collectMindFromFlags({ args, prior })
    : await collectMindInteractive({ prior });

  const verification = mindVerification(cfg);
  if (!verification.ok) {
    const out = { ok: false, stage: "verification", verification, config: cfg };
    if (json) jsonOut(out);
    else {
      textOut("verification failed:");
      for (const err of verification.errors) textOut(`- ${err.code}: ${err.message}`);
    }
    process.exit(1);
  }

  const runTestNow = testNowFlag == null ? !nonInteractive : parseTruthy(testNowFlag, false);
  let live = null;
  if (runTestNow) live = await mindLiveTest(cfg);

  const plan = await createMindWritePlan({ rootDir, cfg });
  if (!dryRun) await applyWritePlan(plan);

  const out = {
    ok: true,
    route: "configure mind",
    rootDir,
    dryRun,
    changed: plan.changed,
    writes: writePlanSummary(plan),
    verification,
    live,
    config: cfg
  };
  if (json) {
    jsonOut(out);
    return;
  }
  textOut("configure mind complete");
  for (const w of out.writes) {
    textOut(`- ${w.path} (${w.changed ? "changed" : "unchanged"}, ${w.action})`);
  }
  if (runTestNow) {
    textOut(`mind test ${live?.ok ? "passed" : "failed"}`);
    for (const check of live?.checks || []) {
      textOut(`- ${check.ok ? "ok" : "fail"}: ${check.name}${check.error ? ` (${check.error})` : ""}`);
    }
  }
  if (print) {
    textOut("");
    textOut("planned blocks:");
    for (const w of plan.writes) {
      textOut(`## ${w.path}`);
      textOut(renderShortPreview(w.nextText));
    }
  }
}

function normalizeIntervalMinutes(raw, fallback = 24) {
  const num = Number(raw);
  if (!Number.isFinite(num) || num <= 0) return fallback;
  return Math.floor(num);
}

function buildAgentRuntimeBlock({ backend, model, toolsMap }) {
  return [
    "su name agent runtime be map def",
    `  su name backend ob text ${quoteText(backend)} ya`,
    `  su name model ob text ${quoteText(model)} ya`,
    `  su name tools map ob text ${quoteText(toolsMap)} ya`,
    "prah"
  ].join("\n");
}

async function upsertAgentRuntime({ worldRoot, agentName, backend, model, toolsMap, dryRun = false }) {
  const runtimePath = path.join(worldRoot, "house", agentName, "conduct", "runtime.pya");
  const existing = await readText(runtimePath);
  const plan = planManagedUpsert({
    existing,
    blockName: "agent runtime",
    content: buildAgentRuntimeBlock({ backend, model, toolsMap })
  });
  if (!dryRun && plan.changed) {
    await ensureDirForFile(runtimePath);
    await fs.writeFile(runtimePath, plan.nextText, "utf8");
  }
  return {
    path: runtimePath,
    changed: plan.changed,
    action: plan.action
  };
}

async function bindAgentToDefaultChannel({ rootDir, worldRoot, agentName, mentionGate = false, dryRun = false }) {
  const matrix = await loadMatrixConfigFromSecret(rootDir);
  if (!matrix?.homeserver || !matrix?.room) {
    return {
      ok: false,
      reason: "missing channel configure",
      path: null,
      changed: false,
      action: "none"
    };
  }
  const channelPath = path.join(worldRoot, "house", agentName, "conduct", "channels.pya");
  const existing = await readText(channelPath);
  const plan = planManagedUpsert({
    existing,
    blockName: MATRIX_POLICY_BLOCK_NAME,
    content: buildChannelConductBlock({
      homeserver: matrix.homeserver,
      room: matrix.room,
      mentionGate
    })
  });
  if (!dryRun && plan.changed) {
    await ensureDirForFile(channelPath);
    await fs.writeFile(channelPath, plan.nextText, "utf8");
  }
  return {
    ok: true,
    path: channelPath,
    changed: plan.changed,
    action: plan.action,
    homeserver: matrix.homeserver,
    room: matrix.room
  };
}

function collectAgentFromFlags({ args }) {
  const agentName = String(parseArgValue(args, "--agent") ?? "parity coder").trim();
  const purpose = String(parseArgValue(args, "--purpose") ?? "Assist with scheduled automation tasks.").trim();
  const intervalMinutes = normalizeIntervalMinutes(parseArgValue(args, "--interval-minutes") ?? 24, 24);
  const backend = String(parseArgValue(args, "--backend") ?? "ollama").trim();
  const model = String(parseArgValue(args, "--model") ?? "gpt-oss:latest").trim();
  const toolsMap = String(parseArgValue(args, "--tools-map") ?? "tools").trim();
  const bindChannel = parseTruthy(parseArgValue(args, "--bind-channel"), true);
  const smokeTest = parseTruthy(parseArgValue(args, "--smoke-test"), true);
  return {
    agentName,
    purpose,
    intervalMinutes,
    backend,
    model,
    toolsMap,
    bindChannel,
    smokeTest
  };
}

async function collectAgentInteractive({ worldRoot }) {
  const printer = sectionPrinter();
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const ask = async (label, fallback = "") => {
      const shown = fallback ? ` [${fallback}]` : "";
      const v = (await rl.question(`${label}${shown}: `)).trim();
      return v || fallback;
    };
    const askYesNo = async (label, fallback = true) => {
      const shown = fallback ? "Y/n" : "y/N";
      const v = (await rl.question(`${label} [${shown}]: `)).trim().toLowerCase();
      if (!v) return fallback;
      return v === "y" || v === "yes";
    };

    printer.header("A.1 Agent Identity");
    printer.why("Agent name and purpose define house identity and managed state.");
    printer.how("Choose a stable name and concise purpose sentence.");
    printer.examples("parity coder | Fix parity regressions and report delta");
    const agentName = await ask("Agent name", "parity coder");
    const purpose = await ask("Agent purpose", "Assist with scheduled automation tasks.");

    printer.header("B.1 Runtime Backend");
    printer.why("Backend/model determine response behavior for upcoming channel and schedule runs.");
    printer.how("Select your default backend and model.");
    printer.examples("backend=ollama, model=gpt-oss:latest");
    const backend = await ask("Backend", "ollama");
    const model = await ask("Model", "gpt-oss:latest");
    const toolsMap = await ask("Tools map", "tools");

    printer.header("C.1 Channel Binding");
    printer.why("Most agents should inherit default channel routing.");
    printer.how("Enable to write channel conduct file from current channel configure.");
    printer.examples("yes");
    const bindChannel = await askYesNo("Bind default channel to this agent", true);
    if (bindChannel) {
      const matrix = await loadMatrixConfigFromSecret(worldRoot);
      if (!matrix?.homeserver || !matrix?.room) {
        textOut("- warning: default channel configure missing; binding will be skipped unless channel is configured.");
      } else {
        textOut(`- channel source ${matrix.homeserver} ${matrix.room}`);
      }
    }

    printer.header("D.1 Schedule");
    printer.why("Schedule ensures the agent runs regularly.");
    printer.how("Set heartbeat interval in minutes.");
    printer.examples("24");
    const intervalRaw = await ask("Interval minutes", "24");
    const intervalMinutes = normalizeIntervalMinutes(intervalRaw, 24);

    printer.header("E.1 Smoke Test");
    printer.why("Quick begin/stop verifies the new agent can be controlled.");
    printer.how("Enable for first setup; disable if you only want file writes.");
    printer.examples("yes");
    const smokeTest = await askYesNo("Run begin/stop smoke test", true);

    return {
      agentName,
      purpose,
      intervalMinutes,
      backend,
      model,
      toolsMap,
      bindChannel,
      smokeTest
    };
  } finally {
    rl.close();
  }
}

async function configureAgent({ args }) {
  const rootDir = path.resolve(parseArgValue(args, "--root") ?? process.cwd());
  const worldRoot = path.join(rootDir, "world");
  const json = hasFlag(args, "--json");
  const print = hasFlag(args, "--print");
  const dryRun = hasFlag(args, "--dry-run");
  const nonInteractive = hasFlag(args, "--non-interactive");

  const cfg = nonInteractive
    ? collectAgentFromFlags({ args })
    : await collectAgentInteractive({ worldRoot });

  if (!cfg.agentName) {
    throw new Error("configure agent requires --agent");
  }
  if (!cfg.backend || !cfg.model) {
    throw new Error("configure agent requires backend and model");
  }

  let establishResult = {
    action: "establish",
    status: "dry-run",
    changed: false,
    changes: [],
    agentName: cfg.agentName
  };
  if (!dryRun) {
    establishResult = await establishAgent({
      worldRoot,
      agentName: cfg.agentName,
      purpose: cfg.purpose,
      intervalMinutes: cfg.intervalMinutes
    });
  }

  const runtimeWrite = await upsertAgentRuntime({
    worldRoot,
    agentName: cfg.agentName,
    backend: cfg.backend,
    model: cfg.model,
    toolsMap: cfg.toolsMap,
    dryRun
  });

  const channelWrite = cfg.bindChannel
    ? await bindAgentToDefaultChannel({
      rootDir,
      worldRoot,
      agentName: cfg.agentName,
      mentionGate: false,
      dryRun
    })
    : { ok: false, reason: "channel binding disabled", path: null, changed: false, action: "none" };

  let smoke = null;
  if (cfg.smokeTest && !dryRun) {
    const beginRes = await beginAgent({ worldRoot, agentName: cfg.agentName, startScheduler: false });
    const stopRes = await stopAgent({ worldRoot, agentName: cfg.agentName });
    smoke = {
      ok: true,
      begin: beginRes.enabledServices ?? [],
      stop: stopRes.disabledServices ?? []
    };
  }

  const changed = Boolean(establishResult.changed || runtimeWrite.changed || channelWrite.changed);
  const out = {
    ok: true,
    route: "configure agent",
    rootDir,
    worldRoot,
    dryRun,
    changed,
    config: {
      agentName: cfg.agentName,
      intervalMinutes: cfg.intervalMinutes,
      backend: cfg.backend,
      model: cfg.model,
      toolsMap: cfg.toolsMap,
      bindChannel: cfg.bindChannel,
      smokeTest: cfg.smokeTest
    },
    establish: {
      status: establishResult.status,
      changed: establishResult.changed,
      changes: establishResult.changes
    },
    runtimeWrite,
    channelWrite,
    smoke
  };

  if (json) {
    jsonOut(out);
    return;
  }

  textOut("configure agent complete");
  textOut(`- agent ${cfg.agentName}`);
  textOut(`- establish ${establishResult.status}`);
  textOut(`- runtime ${runtimeWrite.path} (${runtimeWrite.changed ? "changed" : "unchanged"})`);
  if (cfg.bindChannel) {
    if (channelWrite.ok) {
      textOut(`- channel ${channelWrite.path} (${channelWrite.changed ? "changed" : "unchanged"})`);
    } else {
      textOut(`- channel skipped (${channelWrite.reason})`);
    }
  }
  if (smoke) {
    textOut(`- smoke test passed (begin=${smoke.begin.length} stop=${smoke.stop.length})`);
  }
  if (print) {
    const runtimePath = path.join(worldRoot, "house", cfg.agentName, "conduct", "runtime.pya");
    const runtimeText = await readText(runtimePath);
    if (runtimeText) {
      textOut("");
      textOut(`## ${runtimePath}`);
      textOut(renderShortPreview(runtimeText));
    }
  }
}

async function configureIntro({ args }) {
  const rootDir = path.resolve(parseArgValue(args, "--root") ?? process.cwd());
  const json = hasFlag(args, "--json");
  const loadStatus = async () => {
    const orchestrator = await loadOrchestratorConfigFromSecret(rootDir);
    const channel = await loadMatrixConfigFromSecret(rootDir);
    const mind = await loadMindConfigFromSecret(rootDir);
    let agentConfigured = false;
    try {
      const houseDir = path.join(rootDir, "world", "house");
      const entries = await fs.readdir(houseDir, { withFileTypes: true });
      agentConfigured = entries.some((entry) => entry.isDirectory() && entry.name !== "base");
    } catch {}
    return {
      orchestrator: Boolean(orchestrator.mode && orchestrator.host && orchestrator.port),
      channel: Boolean(channel.homeserver && channel.room),
      mind: Boolean(mind.backend && mind.host && mind.model),
      agent: agentConfigured
    };
  };
  const status = await loadStatus();

  if (json) {
    jsonOut({ ok: true, route: "configure intro", rootDir, status });
    return;
  }

  while (true) {
    const current = await loadStatus();
    const defaultChoice = !current.orchestrator ? "1"
      : !current.channel ? "2"
        : !current.mind ? "3"
          : !current.agent ? "4"
            : "5";
    let rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    try {
      textOut("Pyash Configure Intro");
      textOut(`1. orchestrator ${current.orchestrator ? "(configured)" : "(pending)"}`);
      textOut(`2. channel ${current.channel ? "(configured)" : "(pending)"}`);
      textOut(`3. mind ${current.mind ? "(configured)" : "(pending)"}`);
      textOut(`4. agent ${current.agent ? "(configured)" : "(pending)"}`);
      textOut("5. exit");
      const choice = (await rl.question(`Choose option [${defaultChoice}]: `)).trim() || defaultChoice;
      if (choice === "1") {
        rl.close();
        rl = null;
        await configureOrchestrator({ args: [] });
        continue;
      }
      if (choice === "2") {
        rl.close();
        rl = null;
        await configureChannel([]);
        continue;
      }
      if (choice === "3") {
        rl.close();
        rl = null;
        await configureMind({ args: [] });
        continue;
      }
      if (choice === "4") {
        rl.close();
        rl = null;
        await configureAgent({ args: [] });
        continue;
      }
      textOut("No changes made.");
      return;
    } finally {
      try { rl?.close(); } catch {}
    }
  }
}

async function configureChannel(args) {
  const sub = args[0] ?? "";
  if (!sub) {
    while (true) {
      let rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      try {
      textOut("Pyash Configure Channel");
      textOut("1. matrix");
      textOut("2. exit");
      const choice = (await rl.question("Choose option [1]: ")).trim() || "1";
      if (choice === "2") {
        textOut("No changes made.");
        return;
      }
      // Close parent prompt before entering nested interactive flow.
      rl.close();
      rl = null;
      await configureMatrix({ args: [] });
      } finally {
        try { rl?.close(); } catch {}
      }
    }
  }

  if (sub === "list") {
    await configureChannelList({ json: hasFlag(args, "--json") });
    return;
  }

  if (sub !== MATRIX_CATERER_NAME) {
    throw new Error(`unknown caterer: ${sub}`);
  }

  const action = args[1] ?? "";
  if (action === "test") {
    await configureMatrixTest({ args: args.slice(2) });
    return;
  }
  if (action === "doctor") {
    await configureMatrixDoctor({ args: args.slice(2) });
    return;
  }
  await configureMatrix({ args: args.slice(1) });
}

async function configureMenu(args) {
  const first = args[0] ?? "";
  if (first === "intro") {
    await configureIntro({ args: args.slice(1) });
    return;
  }
  if (first === "orchestrator") {
    await configureOrchestrator({ args: args.slice(1) });
    return;
  }
  if (first === "channel") {
    await configureChannel(args.slice(1));
    return;
  }
  if (first === "mind") {
    await configureMind({ args: args.slice(1) });
    return;
  }
  if (first === "agent") {
    await configureAgent({ args: args.slice(1) });
    return;
  }

  while (true) {
    let rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    try {
    textOut("Pyash Configure");
    textOut("1. intro");
    textOut("2. orchestrator");
    textOut("3. channel");
    textOut("4. mind");
    textOut("5. agent");
    textOut("6. exit");
    const choice = (await rl.question("Choose option [1]: ")).trim() || "1";
    if (choice === "1") {
      // Close parent prompt before entering nested interactive flow.
      rl.close();
      rl = null;
      await configureIntro({ args: [] });
      continue;
    }
    if (choice === "2") {
      rl.close();
      rl = null;
      await configureOrchestrator({ args: [] });
      continue;
    }
    if (choice === "3") {
      rl.close();
      rl = null;
      await configureChannel([]);
      continue;
    }
    if (choice === "4") {
      rl.close();
      rl = null;
      await configureMind({ args: [] });
      continue;
    }
    if (choice === "5") {
      rl.close();
      rl = null;
      await configureAgent({ args: [] });
      continue;
    }
    textOut("No changes made.");
    return;
    } finally {
      try { rl?.close(); } catch {}
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const first = args[0] ?? "";

  if (!first || first === "--help" || first === "-h" || first === "help") {
    textOut(usage());
    return;
  }

  if (first === "run") {
    const code = await runNodeScript(runProgramPath, args.slice(1));
    process.exit(code);
  }

  if (first === "repl") {
    const code = await runNodeScript(replPath, []);
    process.exit(code);
  }

  if (first === "configure") {
    await configureMenu(args.slice(1));
    return;
  }

  const code = await runNodeScript(runProgramPath, args);
  process.exit(code);
}

main().catch((err) => {
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
});
