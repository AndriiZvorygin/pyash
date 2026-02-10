#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import readline from "node:readline/promises";

const __filename = fileURLToPath(import.meta.url);
const installRoot = path.resolve(path.dirname(__filename), "..");
const runProgramPath = path.join(installRoot, "command", "run_pya_program.mjs");
const replPath = path.join(installRoot, "program", "main.mjs");

const MATRIX_CATERER_NAME = "matrix";
const MATRIX_BLOCK_NAME = "matrix channel";
const CHANNEL_CONFIG_BLOCK_NAME = "channel configure";
const MATRIX_POLICY_BLOCK_NAME = "matrix channel conduct";

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
    "  pyash configure channel",
    "  pyash configure channel list [--json]",
    "  pyash configure channel matrix [--root <path>] [--non-interactive] [--dry-run] [--print] [--json] [--quickstart|--advanced] [--homeserver <url>] [--room <id-or-alias>] [--executive <@user:server>] [--agent-user-id <@user:server>] [--auth-mode <password|token|shared-secret>] [--password <password>] [--token <token>] [--registration-shared-secret <secret>] [--admin-token <token>] [--agent <name>] [--write-agent-policy <truth|lie>] [--mention-gate <truth|lie>]",
    "  pyash configure channel matrix test [--root <path>] [--json]",
    "  pyash configure channel matrix doctor [--root <path>] [--json]",
    "",
    "Notes:",
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
  return String(raw ?? "").trim().replace(/\/+$/g, "");
}

function homeserverHost(homeserver) {
  const text = normalizeHomeserver(homeserver);
  if (!text) return "";
  const withoutProto = text.replace(/^https?:\/\//i, "");
  return withoutProto.replace(/\/.*$/g, "").trim().toLowerCase();
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

  if (cfg.authMode === "shared-secret") {
    checks.push({ name: "auth verification", ok: true, note: "shared-secret mode not live-auth-verified in test path" });
    return { ok: true, checks };
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

  const verification = matrixVerification(loaded);
  const issues = [];
  for (const err of verification.errors) issues.push({ code: err.code, kind: "invalid", message: err.message });
  for (const warn of verification.warnings) issues.push({ code: warn.code, kind: "warning", message: warn.message });

  let live = null;
  if (verification.ok) {
    live = await matrixLiveTest(loaded);
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
    config: redactMatrixConfig(loaded),
    issues,
    live,
    remedies
  };
}

function collectMatrixFromFlags({ args, prior }) {
  const homeserver = normalizeHomeserver(parseArgValue(args, "--homeserver") ?? prior.homeserver ?? "");
  const host = homeserverHost(homeserver);
  const room = ensureMatrixIdServer(parseArgValue(args, "--room") ?? prior.room ?? "", host);
  const executiveUsername = ensureMatrixUserServer(parseArgValue(args, "--executive") ?? prior.executiveUsername ?? "", host);
  const userId = ensureMatrixUserServer(parseArgValue(args, "--agent-user-id") ?? prior.userId ?? "", host);
  const authMode = String(parseArgValue(args, "--auth-mode") ?? prior.authMode ?? "password").trim().toLowerCase();
  const token = parseArgValue(args, "--token") ?? prior.token ?? "";
  const password = parseArgValue(args, "--password") ?? "";
  const registrationSharedSecret = parseArgValue(args, "--registration-shared-secret") ?? prior.registrationSharedSecret ?? "";
  const adminToken = parseArgValue(args, "--admin-token") ?? prior.adminToken ?? "";
  const agentName = parseArgValue(args, "--agent") ?? "parity coder";
  const writeAgentPolicy = parseTruthy(parseArgValue(args, "--write-agent-policy"), false);
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

async function collectMatrixInteractive({ prior, mode }) {
  const quickstart = mode !== "advanced";
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

    printer.header("A.1 Channel Route");
    printer.why("Messages must be routed to the right homeserver and room.");
    printer.how("Use your homeserver URL and a room id (!...) or alias (#...).");
    printer.examples("homeserver=https://matrix.org, room=#pyash:matrix.org");
    const homeserver = normalizeHomeserver(await ask("Matrix homeserver", prior.homeserver || "https://matrix.org"));
    const host = homeserverHost(homeserver);
    const room = ensureMatrixIdServer(await ask("Room id or alias (!room:server or #alias:server)", ensureMatrixIdServer(prior.room || "#pyash", host)), host);

    printer.header("B.1 Matrix Auth");
    printer.why("The caterer needs credentials to verify and send.");
    printer.how("Choose password for easiest setup, token for existing access token, shared-secret for self-hosted Synapse.");
    printer.examples("password | token | shared-secret");
    let authMode = String(await ask("Auth mode", prior.authMode || "password")).trim().toLowerCase();
    if (!["password", "token", "shared-secret"].includes(authMode)) authMode = "password";

    let userId = ensureMatrixUserServer(prior.userId || "", host);
    let token = prior.token || "";
    let password = "";
    let registrationSharedSecret = prior.registrationSharedSecret || "";
    let adminToken = prior.adminToken || "";

    if (authMode === "password") {
      printer.header("B.2 Password Flow");
      printer.why("Password can be exchanged for token automatically.");
      printer.how("Use your bot/service account user id and password.");
      printer.examples("@pyash-agent:matrix.org");
      userId = ensureMatrixUserServer(await ask("Agent Matrix user id", userId || "@pyash-agent"), host);
      password = await ask("Matrix password (visible input)", "");
      token = "";
      registrationSharedSecret = "";
      adminToken = "";
    } else if (authMode === "token") {
      printer.header("B.2 Token Flow");
      printer.why("Use existing access token without password exchange.");
      printer.how("Get from Matrix client session export or login API response.");
      printer.examples("POST /_matrix/client/v3/login and copy access_token");
      token = await ask("Access token", token);
      userId = ensureMatrixUserServer(await ask("Agent Matrix user id (optional)", userId), host);
      registrationSharedSecret = "";
      adminToken = "";
    } else {
      printer.header("B.2 Shared-Secret Flow");
      printer.why("Self-hosted Synapse bootstrap can register agents via shared secret.");
      printer.how("Read registration_shared_secret from homeserver.yaml (Synapse).");
      printer.examples("registration_shared_secret: <value>");
      userId = ensureMatrixUserServer(await ask("Agent Matrix user id", userId || "@pyash-agent"), host);
      registrationSharedSecret = await ask("Registration shared secret", registrationSharedSecret);
      adminToken = await ask("Admin token (optional)", adminToken);
      token = "";
      password = "";
    }

    let executiveUsername = ensureMatrixUserServer(prior.executiveUsername || "", host);
    let writeAgentPolicy = false;
    let agentName = "parity coder";
    let mentionGate = false;

    if (!quickstart) {
      printer.header("C.1 Agent Conduct Files");
      printer.why("Optional local channel conduct file can be generated per agent.");
      printer.how("Enable when you want world/house/<agent>/conduct/channels.pya written.");
      printer.examples("agent=parity coder, mention gate=lie");
      executiveUsername = ensureMatrixUserServer(await ask("Executive user (optional DM target)", executiveUsername), host);
      writeAgentPolicy = await askYesNo("Write agent channel conduct file", false);
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

  const prior = await loadMatrixConfigFromSecret(rootDir);
  const collected = nonInteractive
    ? collectMatrixFromFlags({ args, prior })
    : await collectMatrixInteractive({ prior, mode });

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
  const loaded = await loadMatrixConfigFromSecret(rootDir);
  const verification = matrixVerification(loaded);
  if (!verification.ok) {
    const payload = { ok: false, stage: "verification", verification, config: redactMatrixConfig(loaded) };
    if (json) jsonOut(payload);
    else {
      textOut("matrix test failed (verification):");
      for (const err of verification.errors) textOut(`- ${err.code}: ${err.message}`);
    }
    process.exit(1);
  }

  const live = await matrixLiveTest(loaded);
  const payload = {
    ok: live.ok,
    route: "configure channel matrix test",
    checks: live.checks,
    config: redactMatrixConfig(loaded)
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

async function configureChannel(args) {
  const sub = args[0] ?? "";
  if (!sub) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    try {
      textOut("Pyash Configure Channel");
      textOut("1. list caterers");
      textOut("2. matrix");
      textOut("3. exit");
      const choice = (await rl.question("Choose option [2]: ")).trim() || "2";
      if (choice === "1") {
        await configureChannelList({ json: false });
        return;
      }
      if (choice === "3") {
        textOut("No changes made.");
        return;
      }
      await configureMatrix({ args: [] });
      return;
    } finally {
      rl.close();
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
  if (first === "channel") {
    await configureChannel(args.slice(1));
    return;
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    textOut("Pyash Configure");
    textOut("1. channel");
    textOut("2. exit");
    const choice = (await rl.question("Choose option [1]: ")).trim() || "1";
    if (choice === "1") {
      await configureChannel([]);
      return;
    }
    textOut("No changes made.");
  } finally {
    rl.close();
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
