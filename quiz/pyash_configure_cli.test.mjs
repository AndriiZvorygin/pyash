import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn, spawnSync } from "node:child_process";

const cliPath = path.resolve("command/pyash.mjs");
const nodeStdoutProbe = spawnSync(process.execPath, ["-e", "console.log('ok')"], { encoding: "utf8" });
const canCaptureNodeChildStdout = String(nodeStdoutProbe.stdout ?? "").trim() === "ok";
const maybeTest = (name, fn) => {
  if (canCaptureNodeChildStdout) return test(name, fn);
  return test(name, { skip: "environment cannot capture node child stdout" }, fn);
};

function runCli(args, opts = {}) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    encoding: "utf8",
    ...opts
  });
}

function runCliAsync(args, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      stdio: ["ignore", "pipe", "pipe"],
      ...opts
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("close", (code) => resolve({ status: code, stdout, stderr }));
  });
}

async function makeRoot() {
  return await fs.mkdtemp(path.join(os.tmpdir(), "pyash-configure-"));
}

async function startMatrixMockServer() {
  const calls = [];
  const tokenUser = new Map();
  const readToken = (req) => {
    const auth = String(req.headers.authorization ?? "").trim();
    const match = auth.match(/^Bearer\s+(.+)$/i);
    return match ? match[1] : "";
  };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const bodyText = Buffer.concat(chunks).toString("utf8");
      const token = readToken(req);
      calls.push({
        method: req.method,
        path: url.pathname,
        query: url.searchParams.toString(),
        body: bodyText
      });

      if (req.method === "GET" && url.pathname === "/_synapse/admin/v1/register") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ nonce: "nonce-1" }));
        return;
      }
      if (req.method === "POST" && url.pathname === "/_synapse/admin/v1/register") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({}));
        return;
      }
      if (req.method === "POST" && url.pathname === "/_matrix/client/v3/login") {
        const payload = JSON.parse(bodyText || "{}");
        const loginUser = String(payload?.identifier?.user ?? payload?.user ?? "builder");
        const normalizedUser = loginUser.startsWith("@") ? loginUser : `@${loginUser}:example.test`;
        const accessToken = `token-${normalizedUser.replace(/[^a-z0-9]/gi, "_")}`;
        tokenUser.set(accessToken, normalizedUser);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ access_token: accessToken, user_id: normalizedUser, device_id: "DEV1" }));
        return;
      }
      if (req.method === "GET" && url.pathname === "/_matrix/client/v3/account/whoami") {
        const userId = tokenUser.get(token) || "@builder:example.test";
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ user_id: userId }));
        return;
      }
      if (req.method === "POST" && url.pathname === "/_matrix/client/v3/join/%23pyash%3Aexample.test") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ room_id: "!main:example.test" }));
        return;
      }
      if (req.method === "GET" && url.pathname === "/_matrix/client/v3/joined_rooms") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ joined_rooms: ["!main:example.test"] }));
        return;
      }
      if (req.method === "GET" && /\/_matrix\/client\/v3\/user\/.+\/account_data\/m\.direct$/.test(url.pathname)) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({}));
        return;
      }
      if (req.method === "POST" && url.pathname === "/_matrix/client/v3/createRoom") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ room_id: "!dm:example.test" }));
        return;
      }
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ errcode: "M_NOT_FOUND", error: "not found" }));
    });
  });

  await new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    homeserver: `http://127.0.0.1:${port}`,
    calls,
    close: async () => {
      await new Promise((resolve) => server.close(resolve));
    }
  };
}

async function startMatrixInviteFallbackMockServer() {
  const calls = [];
  const inviterToken = "inviter-token";
  const accountantToken = "accountant-token";
  const aliasToRoom = new Map([
    ["#pyash:example.test", "!main:example.test"]
  ]);
  const joinedByToken = new Map([
    [inviterToken, new Set(["!main:example.test"])],
    [accountantToken, new Set()]
  ]);
  const invitedUsersByRoom = new Map([
    ["!main:example.test", new Set()]
  ]);

  const tokenUser = (token) => {
    if (token === inviterToken) return "@mricge:example.test";
    if (token === accountantToken) return "@accountant:example.test";
    return "@unknown:example.test";
  };

  const readToken = (req) => {
    const auth = String(req.headers.authorization ?? "").trim();
    const match = auth.match(/^Bearer\s+(.+)$/i);
    return match ? match[1] : "";
  };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const bodyText = Buffer.concat(chunks).toString("utf8");
      const token = readToken(req);
      calls.push({
        method: req.method,
        path: url.pathname,
        query: url.searchParams.toString(),
        body: bodyText,
        token
      });

      if (req.method === "GET" && url.pathname === "/_matrix/client/v3/account/whoami") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ user_id: tokenUser(token) }));
        return;
      }
      if (req.method === "GET" && url.pathname === "/_synapse/admin/v1/register") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ nonce: "nonce-1" }));
        return;
      }
      if (req.method === "POST" && url.pathname === "/_synapse/admin/v1/register") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({}));
        return;
      }
      if (req.method === "POST" && url.pathname === "/_matrix/client/v3/login") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          access_token: accountantToken,
          user_id: "@accountant:example.test",
          device_id: "DEV1"
        }));
        return;
      }
      if (req.method === "GET" && url.pathname === "/_matrix/client/v3/joined_rooms") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ joined_rooms: [...(joinedByToken.get(token) ?? new Set())] }));
        return;
      }
      if (req.method === "POST" && url.pathname.startsWith("/_matrix/client/v3/join/")) {
        const encoded = url.pathname.split("/_matrix/client/v3/join/")[1] || "";
        const roomOrAlias = decodeURIComponent(encoded);
        const roomId = aliasToRoom.get(roomOrAlias) || roomOrAlias;
        if (!roomId.startsWith("!")) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ errcode: "M_NOT_FOUND", error: "unknown room" }));
          return;
        }
        if (token === inviterToken) {
          joinedByToken.get(inviterToken)?.add(roomId);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ room_id: roomId }));
          return;
        }
        if (token === accountantToken) {
          const invited = invitedUsersByRoom.get(roomId)?.has("@accountant:example.test") === true;
          if (!invited) {
            res.writeHead(403, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ errcode: "M_FORBIDDEN", error: "You are not invited to this room." }));
            return;
          }
          joinedByToken.get(accountantToken)?.add(roomId);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ room_id: roomId }));
          return;
        }
      }
      if (req.method === "POST" && /\/_matrix\/client\/v3\/rooms\/.+\/invite$/.test(url.pathname)) {
        const roomId = decodeURIComponent(url.pathname.split("/_matrix/client/v3/rooms/")[1].replace(/\/invite$/, ""));
        const payload = JSON.parse(bodyText || "{}");
        const inviteUserId = String(payload?.user_id ?? "");
        if (!invitedUsersByRoom.has(roomId)) invitedUsersByRoom.set(roomId, new Set());
        invitedUsersByRoom.get(roomId)?.add(inviteUserId);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({}));
        return;
      }
      if (req.method === "GET" && /\/_matrix\/client\/v3\/user\/.+\/account_data\/m\.direct$/.test(url.pathname)) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({}));
        return;
      }
      if (req.method === "POST" && url.pathname === "/_matrix/client/v3/createRoom") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ room_id: "!dm:example.test" }));
        return;
      }
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ errcode: "M_NOT_FOUND", error: "not found" }));
    });
  });

  await new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    homeserver: `http://127.0.0.1:${port}`,
    calls,
    close: async () => {
      await new Promise((resolve) => server.close(resolve));
    }
  };
}

async function makeMockCodexBin() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-codex-mock-"));
  const binPath = path.join(dir, "codex");
  const script = `#!/usr/bin/env node
import readline from "node:readline";

if (process.argv[2] !== "app-server") process.exit(2);

const state = { loginId: "login-1", authMode: null, account: null };
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

function send(payload) {
  process.stdout.write(JSON.stringify(payload) + "\\n");
}

rl.on("line", (line) => {
  let message;
  try { message = JSON.parse(line); } catch { return; }
  const id = message?.id;
  const method = message?.method;
  if (method === "initialize") {
    send({ jsonrpc: "2.0", id, result: { ok: true } });
    return;
  }
  if (method === "initialized") return;
  if (method === "account/read") {
    send({ jsonrpc: "2.0", id, result: { requiresOpenaiAuth: true, authMode: state.authMode, account: state.account } });
    return;
  }
  if (method === "account/login/start") {
    send({
      jsonrpc: "2.0",
      id,
      result: {
        type: "chatgpt",
        loginId: state.loginId,
        authUrl: "https://chatgpt.com/auth?redirect_uri=http%3A%2F%2Flocalhost%3A8765%2Fauth%2Fcallback"
      }
    });
    setTimeout(() => {
      state.authMode = "chatgpt";
      state.account = { type: "chatgpt", id: "acct-1" };
      send({ jsonrpc: "2.0", method: "account/login/completed", params: { loginId: state.loginId, success: true } });
      send({ jsonrpc: "2.0", method: "account/updated", params: { authMode: "chatgpt" } });
    }, 10);
    return;
  }
  send({ jsonrpc: "2.0", id, result: {} });
});
`;
  await fs.writeFile(binPath, script, "utf8");
  await fs.chmod(binPath, 0o755);
  return { dir, binPath };
}

maybeTest("configure channel list emits matrix caterer", () => {
  const run = runCli(["configure", "channel", "list", "--json"]);
  assert.equal(run.status, 0, run.stderr);
  const payload = JSON.parse(run.stdout);
  assert.equal(payload.ok, true);
  assert.equal(Array.isArray(payload.caterers), true);
  assert.equal(payload.caterers.some((item) => item.name === "matrix"), true);
});

maybeTest("configure channel matrix dry-run does not write files", async () => {
  const root = await makeRoot();
  const run = runCli([
    "configure", "channel", "matrix",
    "--root", root,
    "--non-interactive",
    "--dry-run",
    "--json",
    "--homeserver", "https://matrix.org",
    "--room", "#pyash:matrix.org",
    "--auth-mode", "token",
    "--token", "abc123"
  ]);
  assert.equal(run.status, 0, run.stderr);
  const payload = JSON.parse(run.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.dryRun, true);
  const secretPath = path.join(root, "configure", "secret.pya");
  await assert.rejects(() => fs.stat(secretPath));
});

maybeTest("configure channel matrix apply writes managed blocks and is idempotent", async () => {
  const root = await makeRoot();
  const args = [
    "configure", "channel", "matrix",
    "--root", root,
    "--non-interactive",
    "--json",
    "--homeserver", "https://matrix.org",
    "--room", "#pyash:matrix.org",
    "--auth-mode", "token",
    "--token", "abc123",
    "--write-agent-policy", "truth",
    "--agent", "parity coder"
  ];

  const first = runCli(args);
  assert.equal(first.status, 0, first.stderr);
  const firstPayload = JSON.parse(first.stdout);
  assert.equal(firstPayload.ok, true);
  assert.equal(firstPayload.changed, true);

  const secretPath = path.join(root, "configure", "secret.pya");
  const worldChannelsPath = path.join(root, "world", "conduct", "channels.pya");
  const worldCalendarPath = path.join(root, "world", "conduct", "calendar.pya");
  const channelsPath = path.join(root, "world", "house", "parity coder", "conduct", "channels.pya");
  const calendarPath = path.join(root, "world", "house", "parity coder", "conduct", "calendar.pya");
  const secretText = await fs.readFile(secretPath, "utf8");
  const worldChannelsText = await fs.readFile(worldChannelsPath, "utf8");
  const worldCalendarText = await fs.readFile(worldCalendarPath, "utf8");
  const channelsText = await fs.readFile(channelsPath, "utf8");
  const calendarText = await fs.readFile(calendarPath, "utf8");
  assert.match(secretText, /managed by pyash configure matrix channel:start/);
  assert.match(secretText, /managed by pyash configure channel configure:start/);
  assert.match(worldChannelsText, /managed by pyash configure matrix channel world conduct:start/);
  assert.match(worldChannelsText, /su name matrix dm tool summary ob bool truth ya/);
  assert.match(worldCalendarText, /managed by pyash configure matrix long poll timing:start/);
  assert.match(worldCalendarText, /su name matrix long poll ms ob text "10000" be calendar ya/);
  assert.match(channelsText, /managed by pyash configure matrix channel conduct:start/);
  assert.match(calendarText, /su name channel poll for name parity coder with ve text "matrix" vyah habit during second 10 be calendar ya/);
  assert.match(calendarText, /managed by pyash configure channel input schedule:start/);
  assert.match(calendarText, /su name channel input for name parity coder with ve text "matrix" vyah habit during second 1 be calendar ya/);
  assert.match(calendarText, /managed by pyash configure channel produce schedule:start/);
  assert.match(calendarText, /su name channel produce for name parity coder with ve text "matrix" vyah habit during second 1 be calendar ya/);

  const second = runCli(args);
  assert.equal(second.status, 0, second.stderr);
  const secondPayload = JSON.parse(second.stdout);
  assert.equal(secondPayload.ok, true);
  assert.equal(secondPayload.changed, false);
});

maybeTest("configure channel matrix scrubs legacy matrix seed lines from agent policy", async () => {
  const root = await makeRoot();
  const channelPath = path.join(root, "world", "house", "parity coder", "conduct", "channels.pya");
  await fs.mkdir(path.dirname(channelPath), { recursive: true });
  await fs.writeFile(channelPath, [
    "su name matrix channel ob bool truth ya",
    "su name matrix public tag answer ob bool lie ya",
    "su name matrix homeserver ob text \"https://matrix.example.org\" ya",
    "su name matrix room ob text \"!roomid:example.org\" ya",
    "su name matrix room lane ob text \"matrix_main\" ya"
  ].join("\n") + "\n", "utf8");

  const run = runCli([
    "configure", "channel", "matrix",
    "--root", root,
    "--non-interactive",
    "--json",
    "--homeserver", "https://matrix.org",
    "--room", "#pyash:matrix.org",
    "--auth-mode", "token",
    "--token", "abc123",
    "--write-agent-policy", "truth",
    "--agent", "parity coder"
  ]);
  assert.equal(run.status, 0, run.stderr);
  const text = await fs.readFile(channelPath, "utf8");
  assert.doesNotMatch(text, /matrix\.example\.org/);
  assert.doesNotMatch(text, /!roomid:example\.org/);
  assert.match(text, /# managed by pyash configure matrix channel conduct:start/);
  assert.doesNotMatch(text, /su name matrix room ob text/);
});

maybeTest("configure channel matrix scrubs legacy matrix probe jobs from world calendar", async () => {
  const root = await makeRoot();
  const worldCalendarPath = path.join(root, "world", "conduct", "calendar.pya");
  await fs.mkdir(path.dirname(worldCalendarPath), { recursive: true });
  await fs.writeFile(worldCalendarPath, [
    "su name matrix probe for name confederation-priest with wo tools vyah habit during minute 1 be calendar ya",
    "su name matrix probe lane ob text \"matrix_public\" ya",
    "su name keeper heartbeat for name keeper vyah habit during minute 5 be calendar ya"
  ].join("\n") + "\n", "utf8");

  const run = runCli([
    "configure", "channel", "matrix",
    "--root", root,
    "--non-interactive",
    "--json",
    "--homeserver", "https://matrix.org",
    "--room", "#pyash:matrix.org",
    "--auth-mode", "token",
    "--token", "abc123",
    "--agent", "parity coder",
    "--write-agent-policy", "lie"
  ]);
  assert.equal(run.status, 0, run.stderr);
  const text = await fs.readFile(worldCalendarPath, "utf8");
  assert.doesNotMatch(text, /su name matrix probe for name confederation-priest/);
  assert.doesNotMatch(text, /su name matrix probe lane ob text "matrix_public"/);
  assert.match(text, /su name keeper heartbeat for name keeper vyah habit during minute 5 be calendar ya/);
  assert.match(text, /su name matrix long poll ms ob text "10000" be calendar ya/);
});

maybeTest("configure channel matrix shared-secret mode reuses provided token idempotently", async () => {
  const root = await makeRoot();
  const args = [
    "configure", "channel", "matrix",
    "--root", root,
    "--non-interactive",
    "--json",
    "--homeserver", "https://matrix.liberit.ca",
    "--room", "#pyash:matrix.liberit.ca",
    "--auth-mode", "shared-secret",
    "--registration-shared-secret", "shared-secret-value",
    "--token", "existing-token",
    "--agent-user-id", "@pyash-agent:matrix.liberit.ca",
    "--agent", "pyash-agent"
  ];

  const first = runCli(args);
  assert.equal(first.status, 0, first.stderr);
  const firstPayload = JSON.parse(first.stdout);
  assert.equal(firstPayload.ok, true);
  assert.equal(firstPayload.config.token, "[redacted]");

  const second = runCli(args);
  assert.equal(second.status, 0, second.stderr);
  const secondPayload = JSON.parse(second.stdout);
  assert.equal(secondPayload.ok, true);
  assert.equal(secondPayload.changed, false);
});

maybeTest("configure channel matrix appservice mode validates registration and persists mode fields", async () => {
  const root = await makeRoot();
  const registrationDir = path.join(root, "synapse-data", "appservices");
  await fs.mkdir(registrationDir, { recursive: true });
  const registrationPath = path.join(registrationDir, "agent.yaml");
  await fs.writeFile(registrationPath, [
    "id: pyash-agent",
    "url: http://appservice:9001",
    "as_token: as-token-123",
    "hs_token: hs-token-456",
    "sender_localpart: pyash-agent"
  ].join("\n") + "\n", "utf8");

  const run = runCli([
    "configure", "channel", "matrix",
    "--root", root,
    "--non-interactive",
    "--json",
    "--homeserver", "https://matrix.liberit.ca",
    "--room", "#pyash:matrix.liberit.ca",
    "--mode", "appservice",
    "--long-poll-ms", "45000",
    "--appservice-registration", registrationPath,
    "--auth-mode", "token",
    "--token", "abc123",
    "--agent-user-id", "@pyash-agent:matrix.liberit.ca",
    "--agent", "pyash-agent"
  ]);
  assert.equal(run.status, 0, run.stderr);
  const payload = JSON.parse(run.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.config.mode, "appservice-push");
  assert.equal(payload.config.longPollMs, 45000);
  assert.equal(payload.appservice?.senderLocalpart, "pyash-agent");
  assert.equal(payload.appservice?.hasAsToken, true);
  assert.equal(payload.appservice?.hasHsToken, true);

  const secretPath = path.join(root, "configure", "secret.pya");
  const channelsPath = path.join(root, "world", "house", "pyash-agent", "conduct", "channels.pya");
  const secretText = await fs.readFile(secretPath, "utf8");
  const channelsText = await fs.readFile(channelsPath, "utf8");
  assert.doesNotMatch(secretText, /su name mode ob text "appservice-push" ya/);
  assert.doesNotMatch(secretText, /su name long poll ms ob text "45000" ya/);
  assert.match(secretText, /su name bridge service file ob text/);
  assert.doesNotMatch(channelsText, /su name matrix mode ob text/);
  assert.doesNotMatch(channelsText, /su name matrix long poll ms ob text/);
  assert.match(channelsText, /su name matrix user ob text "@pyash-agent:matrix\.liberit\.ca" ya/);
  assert.doesNotMatch(channelsText, /su name matrix bridge service file ob text/);
  const worldCalendarPath = path.join(root, "world", "conduct", "calendar.pya");
  const worldCalendarText = await fs.readFile(worldCalendarPath, "utf8");
  assert.match(worldCalendarText, /managed by pyash configure channel input schedule:start/);
  assert.match(worldCalendarText, /managed by pyash configure matrix long poll timing:start/);
  assert.match(worldCalendarText, /su name matrix long poll ms ob text "45000" be calendar ya/);
  assert.match(worldCalendarText, /su name channel input for name pyash-agent/);
  assert.match(worldCalendarText, /su name channel input for name pyash-agent with ve text "matrix" vyah habit during second 1 be calendar ya/);
});

maybeTest("configure channel matrix appservice mode defaults registration path to configure/secret/matrix.yaml", async () => {
  const root = await makeRoot();
  const registrationDir = path.join(root, "configure", "secret");
  await fs.mkdir(registrationDir, { recursive: true });
  const registrationPath = path.join(registrationDir, "matrix.yaml");
  await fs.writeFile(registrationPath, [
    "id: pyash-agent",
    "url: http://appservice:9001",
    "as_token: as-token-123",
    "hs_token: hs-token-456",
    "sender_localpart: pyash-agent"
  ].join("\n") + "\n", "utf8");

  const run = runCli([
    "configure", "channel", "matrix",
    "--root", root,
    "--non-interactive",
    "--json",
    "--homeserver", "https://matrix.liberit.ca",
    "--room", "#pyash:matrix.liberit.ca",
    "--mode", "appservice",
    "--auth-mode", "token",
    "--token", "abc123",
    "--agent-user-id", "@pyash-agent:matrix.liberit.ca",
    "--agent", "pyash-agent"
  ]);
  assert.equal(run.status, 0, run.stderr);
  const payload = JSON.parse(run.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.config.mode, "appservice-push");
  assert.equal(payload.config.appserviceRegistration, "configure/secret/matrix.yaml");
  assert.equal(payload.appservice?.path, registrationPath);
  assert.equal(payload.appservice?.senderLocalpart, "pyash-agent");
});

maybeTest("configure channel matrix preserves multiple executive usernames", async () => {
  const root = await makeRoot();
  const first = runCli([
    "configure", "channel", "matrix",
    "--root", root,
    "--non-interactive",
    "--json",
    "--homeserver", "https://matrix.liberit.ca",
    "--room", "#pyash:matrix.liberit.ca",
    "--auth-mode", "token",
    "--token", "abc123",
    "--executive", "@mricge-smoke:matrix.liberit.ca",
    "--executive", "@htaf:matrix.liberit.ca",
    "--agent", "mricge"
  ]);
  assert.equal(first.status, 0, first.stderr);

  const second = runCli([
    "configure", "channel", "matrix",
    "--root", root,
    "--non-interactive",
    "--json",
    "--homeserver", "https://matrix.liberit.ca",
    "--room", "#pyash:matrix.liberit.ca",
    "--auth-mode", "token",
    "--token", "abc123",
    "--agent", "mricge"
  ]);
  assert.equal(second.status, 0, second.stderr);

  const worldChannelsPath = path.join(root, "world", "conduct", "channels.pya");
  const worldChannelsText = await fs.readFile(worldChannelsPath, "utf8");
  assert.match(worldChannelsText, /su name matrix executive username ob text "@mricge-smoke:matrix\.liberit\.ca" ya/);
  assert.match(worldChannelsText, /su name matrix executive username ob text "@htaf:matrix\.liberit\.ca" ya/);
});

maybeTest("configure channel matrix appservice mode auto-fills token auth from registration", async () => {
  const root = await makeRoot();
  const registrationDir = path.join(root, "configure", "secret");
  await fs.mkdir(registrationDir, { recursive: true });
  const registrationPath = path.join(registrationDir, "matrix.yaml");
  await fs.writeFile(registrationPath, [
    "id: pyash-agent",
    "url: http://appservice:9001",
    "as_token: as-token-abc",
    "hs_token: hs-token-def",
    "sender_localpart: agentbot"
  ].join("\n") + "\n", "utf8");

  const run = runCli([
    "configure", "channel", "matrix",
    "--root", root,
    "--non-interactive",
    "--json",
    "--homeserver", "https://matrix.liberit.ca",
    "--room", "#pyash:matrix.liberit.ca",
    "--mode", "appservice",
    "--appservice-registration", "configure/secret/matrix.yaml"
  ]);
  assert.equal(run.status, 0, run.stderr);
  const payload = JSON.parse(run.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.config.mode, "appservice-push");
  assert.equal(payload.config.authMode, "token");
  assert.equal(payload.config.userId, "@agentbot:matrix.liberit.ca");
  assert.equal(payload.config.token, "[redacted]");
});

maybeTest("configure channel matrix resolves root from parent directories when --root is omitted", async () => {
  const root = await makeRoot();
  const secretDir = path.join(root, "configure");
  await fs.mkdir(secretDir, { recursive: true });
  await fs.writeFile(path.join(secretDir, "secret.pya"), [
    "# managed by pyash configure matrix channel:start",
    "su name matrix channel be map def",
    "  su name homeserver ob text \"https://matrix.liberit.ca\" ya",
    "  su name room ob text \"#pyash:matrix.liberit.ca\" ya",
    "prah",
    "# managed by pyash configure matrix channel:end"
  ].join("\n") + "\n", "utf8");
  const nestedCwd = path.join(root, "configure", "secret");
  await fs.mkdir(nestedCwd, { recursive: true });

  const run = runCli([
    "configure", "channel", "matrix",
    "--non-interactive",
    "--dry-run",
    "--json",
    "--auth-mode", "token",
    "--token", "abc123"
  ], { cwd: nestedCwd });
  assert.equal(run.status, 0, run.stderr);
  const payload = JSON.parse(run.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.rootDir, root);
  assert.equal(payload.config.homeserver, "https://matrix.liberit.ca");
  assert.equal(payload.config.room, "#pyash:matrix.liberit.ca");
});

maybeTest("configure channel matrix root detection ignores nested world-house trap", async () => {
  const root = await makeRoot();
  const secretDir = path.join(root, "configure");
  await fs.mkdir(secretDir, { recursive: true });
  await fs.writeFile(path.join(secretDir, "secret.pya"), [
    "# managed by pyash configure matrix channel:start",
    "su name matrix channel be map def",
    "  su name homeserver ob text \"https://matrix.liberit.ca\" ya",
    "  su name room ob text \"#pyash:matrix.liberit.ca\" ya",
    "prah",
    "# managed by pyash configure matrix channel:end"
  ].join("\n") + "\n", "utf8");
  const nestedCwd = path.join(root, "configure", "secret");
  await fs.mkdir(path.join(nestedCwd, "world", "house"), { recursive: true });

  const run = runCli([
    "configure", "channel", "matrix",
    "--non-interactive",
    "--dry-run",
    "--json",
    "--auth-mode", "token",
    "--token", "abc123"
  ], { cwd: nestedCwd });
  assert.equal(run.status, 0, run.stderr);
  const payload = JSON.parse(run.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.rootDir, root);
  assert.equal(payload.config.homeserver, "https://matrix.liberit.ca");
  assert.equal(payload.config.room, "#pyash:matrix.liberit.ca");
});

maybeTest("configure channel matrix doctor fails with missing config", async () => {
  const root = await makeRoot();
  const run = runCli(["configure", "channel", "matrix", "doctor", "--root", root, "--json"]);
  assert.equal(run.status, 1, "doctor should fail for missing config");
  const payload = JSON.parse(run.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.issues.some((item) => item.code === "missing_config"), true);
});

maybeTest("configure channel matrix test fails when verification fails", async () => {
  const root = await makeRoot();
  await fs.mkdir(path.join(root, "configure"), { recursive: true });
  await fs.writeFile(path.join(root, "configure", "secret.pya"), [
    "# managed by pyash configure matrix channel:start",
    "su name matrix channel be map def",
    "  su name homeserver ob text \"https://matrix.org\" ya",
    "prah",
    "# managed by pyash configure matrix channel:end"
  ].join("\n"), "utf8");

  const run = runCli(["configure", "channel", "matrix", "test", "--root", root, "--json"]);
  assert.equal(run.status, 1, "test should fail when required fields are missing");
  const payload = JSON.parse(run.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.stage, "verification");
});

maybeTest("configure agent dry-run does not write house files", async () => {
  const root = await makeRoot();
  const run = runCli([
    "configure", "agent",
    "--root", root,
    "--non-interactive",
    "--dry-run",
    "--json",
    "--agent", "builder",
    "--purpose", "Build things.",
    "--backend", "ollama",
    "--model", "gpt-oss:latest",
    "--tools-map", "tools",
    "--bind-channel", "lie",
    "--smoke-test", "lie"
  ]);
  assert.equal(run.status, 0, run.stderr);
  const payload = JSON.parse(run.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.route, "configure agent");
  assert.equal(payload.dryRun, true);
  const runtimePath = path.join(root, "world", "house", "builder", "conduct", "runtime.pya");
  await assert.rejects(() => fs.stat(runtimePath));
});

maybeTest("configure agent apply writes runtime and binds channel when available", async () => {
  const root = await makeRoot();
  const channelRun = runCli([
    "configure", "channel", "matrix",
    "--root", root,
    "--non-interactive",
    "--json",
    "--homeserver", "https://matrix.org",
    "--room", "#pyash:matrix.org",
    "--auth-mode", "token",
    "--token", "abc123",
    "--write-agent-policy", "lie"
  ]);
  assert.equal(channelRun.status, 0, channelRun.stderr);

  const args = [
    "configure", "agent",
    "--root", root,
    "--non-interactive",
    "--json",
    "--agent", "builder",
    "--purpose", "Build things.",
    "--interval-minutes", "15",
    "--backend", "ollama",
    "--model", "gpt-oss:latest",
    "--tools-map", "tools",
    "--bind-channel", "truth",
    "--smoke-test", "lie"
  ];

  const first = runCli(args);
  assert.equal(first.status, 0, first.stderr);
  const firstPayload = JSON.parse(first.stdout);
  assert.equal(firstPayload.ok, true);
  assert.equal(firstPayload.changed, true);
  assert.equal(firstPayload.runtimeWrite.changed, true);
  assert.equal(firstPayload.directoryLicenseWrite.changed, true);
  assert.equal(firstPayload.channelWrite.ok, true);
  assert.equal(firstPayload.channelScheduleWrite.ok, true);
  assert.equal(firstPayload.config.startNow, false);
  assert.equal(firstPayload.activation?.ok, true);
  assert.equal(firstPayload.activation?.note, "start skipped");

  const runtimePath = path.join(root, "world", "house", "builder", "conduct", "runtime.pya");
  const policyPath = path.join(root, "world", "conduct", "agent.pya");
  const channelsPath = path.join(root, "world", "house", "builder", "conduct", "channels.pya");
  const calendarPath = path.join(root, "world", "house", "builder", "conduct", "calendar.pya");
  const runtimeText = await fs.readFile(runtimePath, "utf8");
  const policyText = await fs.readFile(policyPath, "utf8");
  const channelsText = await fs.readFile(channelsPath, "utf8");
  const calendarText = await fs.readFile(calendarPath, "utf8");
  assert.match(runtimeText, /managed by pyash configure agent runtime:start/);
  assert.match(policyText, /managed by pyash configure agent directory license builder:start/);
  assert.match(policyText, /su name builder house directory ob filename "world\/house\/builder" ya/);
  assert.match(policyText, /su name builder directory license be map def/);
  assert.match(policyText, /su name "world\/house\/builder" ob ve text "read" "write" "command" ya/);
  assert.match(channelsText, /managed by pyash configure matrix channel conduct:start/);
  assert.doesNotMatch(channelsText, /su name matrix public tag answer ob bool/);
  assert.match(calendarText, /managed by pyash configure agent channel schedule:start/);
  assert.match(calendarText, /su name channel poll/);

  const second = runCli(args);
  assert.equal(second.status, 0, second.stderr);
  const secondPayload = JSON.parse(second.stdout);
  assert.equal(secondPayload.ok, true);
  assert.equal(secondPayload.changed, false);
  assert.equal(secondPayload.directoryLicenseWrite.changed, false);
});

maybeTest("configure agent bind-channel writes per-agent matrix user when shared-secret provisioning is configured", async () => {
  const root = await makeRoot();
  const channelRun = runCli([
    "configure", "channel", "matrix",
    "--root", root,
    "--non-interactive",
    "--json",
    "--homeserver", "https://matrix.liberit.ca",
    "--room", "#pyash:matrix.liberit.ca",
    "--auth-mode", "shared-secret",
    "--registration-shared-secret", "shared-secret-value",
    "--token", "existing-token",
    "--agent-user-id", "@mricge:matrix.liberit.ca",
    "--write-agent-policy", "lie"
  ]);
  assert.equal(channelRun.status, 0, channelRun.stderr);

  const run = runCli([
    "configure", "agent", "establish",
    "--root", root,
    "--non-interactive",
    "--json",
    "--agent", "accountant",
    "--purpose", "Handle accounting tasks.",
    "--backend", "ollama",
    "--model", "gpt-oss:latest",
    "--tools-map", "tools",
    "--bind-channel", "truth",
    "--smoke-test", "lie",
    "--start-now", "lie"
  ]);
  assert.equal(run.status, 0, run.stderr);

  const channelsPath = path.join(root, "world", "house", "accountant", "conduct", "channels.pya");
  const channelsText = await fs.readFile(channelsPath, "utf8");
  assert.doesNotMatch(channelsText, /su name matrix public tag answer ob bool/);
  assert.match(channelsText, /su name matrix user ob text "@accountant:matrix\.liberit\.ca" ya/);
});

maybeTest("configure agent start-now bootstraps matrix room and executive dm", async () => {
  const root = await makeRoot();
  const matrix = await startMatrixMockServer();
  try {
    const channelRun = await runCliAsync([
      "configure", "channel", "matrix",
      "--root", root,
      "--non-interactive",
      "--json",
      "--homeserver", matrix.homeserver,
      "--room", "#pyash:example.test",
      "--auth-mode", "shared-secret",
      "--registration-shared-secret", "shared-secret-value",
      "--executive", "@boss:example.test",
      "--write-agent-policy", "lie"
    ]);
    assert.equal(channelRun.status, 0, channelRun.stderr);

    const agentRun = await runCliAsync([
      "configure", "agent", "establish",
      "--root", root,
      "--non-interactive",
      "--json",
      "--agent", "builder",
      "--purpose", "Build things.",
      "--interval-minutes", "15",
      "--backend", "ollama",
      "--model", "gpt-oss:latest",
      "--tools-map", "tools",
      "--bind-channel", "truth",
      "--smoke-test", "lie",
      "--start-now", "truth"
    ]);
    assert.equal(agentRun.status, 0, agentRun.stderr);
    const payload = JSON.parse(agentRun.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.channelBootstrap?.ok, true);
    assert.equal(payload.channelBootstrap?.joinedRoomId, "!main:example.test");
    assert.equal(payload.channelBootstrap?.executiveDm?.roomId, "!dm:example.test");

    const seenRegister = matrix.calls.some((call) =>
      call.method === "POST" && call.path === "/_synapse/admin/v1/register"
    );
    const seenLogin = matrix.calls.some((call) =>
      call.method === "POST" && call.path === "/_matrix/client/v3/login"
    );
    const seenJoin = matrix.calls.some((call) => call.method === "POST" && call.path === "/_matrix/client/v3/join/%23pyash%3Aexample.test");
    const seenCreateRoom = matrix.calls.some((call) => call.method === "POST" && call.path === "/_matrix/client/v3/createRoom");
    assert.equal(seenRegister, true);
    assert.equal(seenLogin, true);
    assert.equal(seenJoin, true);
    assert.equal(seenCreateRoom, true);
  } finally {
    const stopRun = runCli(["calendar", "stop", "--root", root, "--json"]);
    assert.equal(stopRun.status, 0, stopRun.stderr);
    await matrix.close();
  }
});

maybeTest("configure agent start-now surfaces join forbidden when bootstrap identity cannot invite", async () => {
  const root = await makeRoot();
  const matrix = await startMatrixInviteFallbackMockServer();
  try {
    const channelRun = await runCliAsync([
      "configure", "channel", "matrix",
      "--root", root,
      "--non-interactive",
      "--json",
      "--homeserver", matrix.homeserver,
      "--room", "#pyash:example.test",
      "--auth-mode", "shared-secret",
      "--registration-shared-secret", "shared-secret-value",
      "--agent-user-id", "@mricge:example.test",
      "--write-agent-policy", "lie"
    ]);
    assert.equal(channelRun.status, 0, channelRun.stderr);

    const agentRun = await runCliAsync([
      "configure", "agent", "establish",
      "--root", root,
      "--non-interactive",
      "--json",
      "--agent", "accountant",
      "--purpose", "Handle accounting tasks.",
      "--backend", "ollama",
      "--model", "gpt-oss:latest",
      "--tools-map", "tools",
      "--bind-channel", "truth",
      "--smoke-test", "lie",
      "--start-now", "truth"
    ]);
    assert.equal(agentRun.status, 0, agentRun.stderr);
    const payload = JSON.parse(agentRun.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.channelBootstrap?.ok, false);
    assert.equal(payload.channelBootstrap?.step, "join room");
    assert.match(String(payload.channelBootstrap?.error || ""), /M_FORBIDDEN/);
  } finally {
    const stopRun = runCli(["calendar", "stop", "--root", root, "--json"]);
    assert.equal(stopRun.status, 0, stopRun.stderr);
    await matrix.close();
  }
});

maybeTest("configure agent skips per-agent channel schedule when channel mode is appservice-push", async () => {
  const root = await makeRoot();
  const registrationDir = path.join(root, "configure", "secret");
  await fs.mkdir(registrationDir, { recursive: true });
  const registrationPath = path.join(registrationDir, "matrix.yaml");
  await fs.writeFile(registrationPath, [
    "id: pyash-agent",
    "url: http://appservice:9001",
    "as_token: as-token-123",
    "hs_token: hs-token-456",
    "sender_localpart: pyash-agent"
  ].join("\n") + "\n", "utf8");

  const channelRun = runCli([
    "configure", "channel", "matrix",
    "--root", root,
    "--non-interactive",
    "--json",
    "--homeserver", "https://matrix.liberit.ca",
    "--room", "#pyash:matrix.liberit.ca",
    "--mode", "appservice",
    "--appservice-registration", "configure/secret/matrix.yaml",
    "--agent", "pyash-agent"
  ]);
  assert.equal(channelRun.status, 0, channelRun.stderr);
  const channelPayload = JSON.parse(channelRun.stdout);
  assert.equal(channelPayload.config.mode, "appservice-push");

  const run = runCli([
    "configure", "agent", "improve",
    "--root", root,
    "--non-interactive",
    "--json",
    "--agent", "pyash-agent",
    "--bind-channel", "truth",
    "--smoke-test", "lie"
  ]);
  assert.equal(run.status, 0, run.stderr);
  const payload = JSON.parse(run.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.channelScheduleWrite.ok, false);
  assert.match(String(payload.channelScheduleWrite.reason || ""), /appservice-push/);
});

maybeTest("configure agent list returns configured agents", async () => {
  const root = await makeRoot();
  const establish = runCli([
    "configure", "agent", "establish",
    "--root", root,
    "--non-interactive",
    "--json",
    "--agent", "builder",
    "--purpose", "Build things.",
    "--backend", "ollama",
    "--model", "gpt-oss:latest",
    "--tools-map", "tools",
    "--bind-channel", "lie",
    "--smoke-test", "lie"
  ]);
  assert.equal(establish.status, 0, establish.stderr);

  const listed = runCli([
    "configure", "agent", "list",
    "--root", root,
    "--json"
  ]);
  assert.equal(listed.status, 0, listed.stderr);
  const payload = JSON.parse(listed.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.route, "configure agent list");
  assert.equal(payload.count, 1);
  assert.equal(payload.agents[0].agentName, "builder");
});

maybeTest("configure agent list excludes houses without configured conduct", async () => {
  const root = await makeRoot();
  const runtimeOnlyHouse = path.join(root, "world", "house", "review gen", "gold", "accepted");
  await fs.mkdir(runtimeOnlyHouse, { recursive: true });
  await fs.writeFile(path.join(runtimeOnlyHouse, "artifact.pya"), "su name note ob text \"runtime only\" ya\n", "utf8");

  const establish = runCli([
    "configure", "agent", "establish",
    "--root", root,
    "--non-interactive",
    "--json",
    "--agent", "builder",
    "--purpose", "Build things.",
    "--backend", "ollama",
    "--model", "gpt-oss:latest",
    "--tools-map", "tools",
    "--bind-channel", "lie",
    "--smoke-test", "lie"
  ]);
  assert.equal(establish.status, 0, establish.stderr);

  const listed = runCli([
    "configure", "agent", "list",
    "--root", root,
    "--json"
  ]);
  assert.equal(listed.status, 0, listed.stderr);
  const payload = JSON.parse(listed.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.count, 1);
  assert.equal(payload.agents[0].agentName, "builder");
});

maybeTest("configure agent improve reuses existing runtime defaults", async () => {
  const root = await makeRoot();
  const establish = runCli([
    "configure", "agent", "establish",
    "--root", root,
    "--non-interactive",
    "--json",
    "--agent", "builder",
    "--purpose", "Build things.",
    "--backend", "ollama",
    "--model", "gpt-oss:latest",
    "--tools-map", "tools",
    "--bind-channel", "lie",
    "--smoke-test", "lie"
  ]);
  assert.equal(establish.status, 0, establish.stderr);

  const improve = runCli([
    "configure", "agent", "improve",
    "--root", root,
    "--non-interactive",
    "--json",
    "--agent", "builder",
    "--bind-channel", "lie",
    "--smoke-test", "lie"
  ]);
  assert.equal(improve.status, 0, improve.stderr);
  const payload = JSON.parse(improve.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.action, "improve");
  assert.equal(payload.config.agentName, "builder");
  assert.equal(payload.config.backend, "ollama command mind");
  assert.equal(payload.config.model, "gpt-oss:latest");
});

maybeTest("configure agent improve can select backend/model from configured relay", async () => {
  const root = await makeRoot();
  const relayLocal = runCli([
    "configure", "mind",
    "--root", root,
    "--non-interactive",
    "--json",
    "--relay", "local",
    "--set-default", "truth",
    "--backend", "ollama",
    "--host", "http://localhost:11434",
    "--model", "gpt-oss:latest",
    "--test-now", "lie"
  ]);
  assert.equal(relayLocal.status, 0, relayLocal.stderr);

  const relayCodex = runCli([
    "configure", "mind",
    "--root", root,
    "--non-interactive",
    "--json",
    "--relay", "codex",
    "--set-default", "lie",
    "--backend", "openai-codex",
    "--host", "https://api.openai.com",
    "--model", "gpt-5.3-codex",
    "--test-now", "lie"
  ]);
  assert.equal(relayCodex.status, 0, relayCodex.stderr);

  const establish = runCli([
    "configure", "agent", "establish",
    "--root", root,
    "--non-interactive",
    "--json",
    "--agent", "builder",
    "--purpose", "Build things.",
    "--backend", "ollama",
    "--model", "gpt-oss:latest",
    "--tools-map", "tools",
    "--bind-channel", "lie",
    "--smoke-test", "lie"
  ]);
  assert.equal(establish.status, 0, establish.stderr);

  const improve = runCli([
    "configure", "agent", "improve",
    "--root", root,
    "--non-interactive",
    "--json",
    "--agent", "builder",
    "--relay", "codex",
    "--bind-channel", "lie",
    "--smoke-test", "lie"
  ]);
  assert.equal(improve.status, 0, improve.stderr);
  const payload = JSON.parse(improve.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.action, "improve");
  assert.equal(payload.config.agentName, "builder");
  assert.equal(payload.config.relayName, "codex");
  assert.equal(payload.config.backend, "openai command mind");
  assert.equal(payload.config.model, "gpt-5.3-codex");
});

maybeTest("configure agent delete removes existing house", async () => {
  const root = await makeRoot();
  const establish = runCli([
    "configure", "agent", "establish",
    "--root", root,
    "--non-interactive",
    "--json",
    "--agent", "builder",
    "--purpose", "Build things.",
    "--backend", "ollama",
    "--model", "gpt-oss:latest",
    "--tools-map", "tools",
    "--bind-channel", "lie",
    "--smoke-test", "lie"
  ]);
  assert.equal(establish.status, 0, establish.stderr);

  const deleted = runCli([
    "configure", "agent", "delete",
    "--root", root,
    "--non-interactive",
    "--json",
    "--agent", "builder",
    "--yes", "truth"
  ]);
  assert.equal(deleted.status, 0, deleted.stderr);
  const payload = JSON.parse(deleted.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.changed, true);
  await assert.rejects(() => fs.stat(path.join(root, "world", "house", "builder")));
});

maybeTest("configure agent interactive opens management menu", async () => {
  const root = await makeRoot();
  const run = runCli([
    "configure", "agent",
    "--root", root
  ], {
    input: "1\n5\n"
  });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /Pyash Configure Agent/);
  assert.match(run.stdout, /configure agent list complete/);
});

maybeTest("configure orchestrator apply writes managed config and is idempotent", async () => {
  const root = await makeRoot();
  const args = [
    "configure", "orchestrator",
    "--root", root,
    "--non-interactive",
    "--json",
    "--mode", "container",
    "--host", "127.0.0.1",
    "--port", "59652",
    "--autostart", "lie",
    "--health-rhythm-minute", "1"
  ];

  const first = runCli(args);
  assert.equal(first.status, 0, first.stderr);
  const firstPayload = JSON.parse(first.stdout);
  assert.equal(firstPayload.ok, true);
  assert.equal(firstPayload.changed, true);

  const secretPath = path.join(root, "configure", "secret.pya");
  const secretText = await fs.readFile(secretPath, "utf8");
  assert.match(secretText, /managed by pyash configure orchestrator configure:start/);
  assert.match(secretText, /su name mode ob text "container" ya/);
  assert.match(secretText, /su name port ob text "59652" ya/);

  const second = runCli(args);
  assert.equal(second.status, 0, second.stderr);
  const secondPayload = JSON.parse(second.stdout);
  assert.equal(secondPayload.ok, true);
  assert.equal(secondPayload.changed, false);
});

maybeTest("configure mind dry-run does not write and apply writes defaults", async () => {
  const root = await makeRoot();
  const dry = runCli([
    "configure", "mind",
    "--root", root,
    "--non-interactive",
    "--dry-run",
    "--json",
    "--backend", "ollama command mind",
    "--host", "http://localhost:11434",
    "--model", "gpt-oss:latest"
  ]);
  assert.equal(dry.status, 0, dry.stderr);
  const dryPayload = JSON.parse(dry.stdout);
  assert.equal(dryPayload.ok, true);
  assert.equal(dryPayload.dryRun, true);
  await assert.rejects(() => fs.stat(path.join(root, "configure", "secret.pya")));

  const apply = runCli([
    "configure", "mind",
    "--root", root,
    "--non-interactive",
    "--json",
    "--backend", "ollama command mind",
    "--host", "http://localhost:11434",
    "--model", "gpt-oss:latest",
    "--test-now", "lie"
  ]);
  assert.equal(apply.status, 0, apply.stderr);
  const payload = JSON.parse(apply.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.changed, true);

  const secretPath = path.join(root, "configure", "secret.pya");
  const secretText = await fs.readFile(secretPath, "utf8");
  assert.match(secretText, /managed by pyash configure mind configure:start/);
  assert.match(secretText, /managed by pyash configure mind defaults:start/);
  assert.match(secretText, /exists su name mind backend be default ob name ollama command mind ya/);
});

maybeTest("configure mind test-now verifies selected ollama model is available", async () => {
  const root = await makeRoot();
  const server = http.createServer((req, res) => {
    if (req.url === "/api/tags") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        models: [
          { name: "gpt-oss:latest" },
          { name: "qwen3-vl:8b-instruct" }
        ]
      }));
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end("{}");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const host = `http://127.0.0.1:${address.port}`;
  try {
    const run = await runCliAsync([
      "configure", "mind",
      "--root", root,
      "--non-interactive",
      "--json",
      "--backend", "ollama command mind",
      "--host", host,
      "--model", "gpt-oss:latest",
      "--test-now", "truth"
    ]);
    assert.equal(run.status, 0, run.stderr);
    const payload = JSON.parse(run.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.live.ok, true);
    const checks = Array.isArray(payload.live.checks) ? payload.live.checks : [];
    assert.equal(checks.some((item) => item.name === "models listed" && item.ok === true), true);
    assert.equal(checks.some((item) => item.name === "model available" && item.ok === true), true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

maybeTest("configure mind test-now skips live model probe for non-ollama backends", async () => {
  const root = await makeRoot();
  const run = runCli([
    "configure", "mind",
    "--root", root,
    "--non-interactive",
    "--json",
    "--backend", "openai",
    "--host", "https://api.openai.com",
    "--model", "gpt-4o-mini",
    "--test-now", "truth"
  ]);
  assert.equal(run.status, 0, run.stderr);
  const payload = JSON.parse(run.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.live.ok, true);
  const checks = Array.isArray(payload.live.checks) ? payload.live.checks : [];
  assert.equal(checks.some((item) => item.name === "provider live check" && item.ok === true && item.skipped === true), true);

  const secretPath = path.join(root, "configure", "secret.pya");
  const secretText = await fs.readFile(secretPath, "utf8");
  assert.match(secretText, /su name backend ob text "openai command mind" ya/);
  assert.match(secretText, /su name model ob text "gpt-4o-mini" ya/);
});

maybeTest("configure mind accepts openai-codex backend alias", async () => {
  const root = await makeRoot();
  const run = runCli([
    "configure", "mind",
    "--root", root,
    "--non-interactive",
    "--json",
    "--backend", "openai-codex",
    "--host", "https://api.openai.com",
    "--model", "gpt-4o-mini",
    "--test-now", "lie"
  ]);
  assert.equal(run.status, 0, run.stderr);
  const payload = JSON.parse(run.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.config.backend, "openai command mind");

  const secretPath = path.join(root, "configure", "secret.pya");
  const secretText = await fs.readFile(secretPath, "utf8");
  assert.match(secretText, /su name backend ob text "openai command mind" ya/);
});

maybeTest("configure mind can run codex oauth login for openai-codex relay", async () => {
  const root = await makeRoot();
  const { binPath } = await makeMockCodexBin();
  const run = runCli([
    "configure", "mind",
    "--root", root,
    "--non-interactive",
    "--json",
    "--relay", "codex",
    "--set-default", "truth",
    "--backend", "openai-codex",
    "--host", "https://api.openai.com",
    "--model", "gpt-5-codex",
    "--codex-login", "truth",
    "--codex-bin", binPath,
    "--test-now", "lie"
  ]);
  assert.equal(run.status, 0, run.stderr);
  const payload = JSON.parse(run.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.config.source, "openai-codex");
  assert.equal(payload.codexAuth?.ok, true);
  assert.equal(payload.codexAuth?.action, "login");
  assert.equal(payload.codexAuth?.started?.loginId, "login-1");

  const secretPath = path.join(root, "configure", "secret.pya");
  const secretText = await fs.readFile(secretPath, "utf8");
  assert.match(secretText, /su name source ob text "openai-codex" ya/);
  assert.match(secretText, /su name relay codex source ob text "openai-codex" ya/);
  assert.match(secretText, /exists su name mind source ob text "openai-codex" be default ya/);
});

maybeTest("configure mind openai-codex defaults host and model when omitted", async () => {
  const root = await makeRoot();
  const run = runCli([
    "configure", "mind",
    "--root", root,
    "--non-interactive",
    "--json",
    "--relay", "codex",
    "--set-default", "truth",
    "--backend", "openai-codex",
    "--test-now", "lie"
  ]);
  assert.equal(run.status, 0, run.stderr);
  const payload = JSON.parse(run.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.config.source, "openai-codex");
  assert.equal(payload.config.host, "https://api.openai.com");
  assert.equal(payload.config.model, "gpt-5-codex");
  assert.equal(payload.config.reasoningEffort, "");
});

maybeTest("configure mind source switch ignores prior ollama host/model defaults", async () => {
  const root = await makeRoot();

  const first = runCli([
    "configure", "mind",
    "--root", root,
    "--non-interactive",
    "--json",
    "--relay", "local",
    "--set-default", "truth",
    "--backend", "ollama",
    "--host", "http://mriczo:11434",
    "--model", "qwen3-vl:8b-instruct",
    "--test-now", "lie"
  ]);
  assert.equal(first.status, 0, first.stderr);

  const second = runCli([
    "configure", "mind",
    "--root", root,
    "--non-interactive",
    "--json",
    "--relay", "codex",
    "--set-default", "truth",
    "--backend", "openai-codex",
    "--test-now", "lie"
  ]);
  assert.equal(second.status, 0, second.stderr);
  const payload = JSON.parse(second.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.config.source, "openai-codex");
  assert.equal(payload.config.host, "https://api.openai.com");
  assert.equal(payload.config.model, "gpt-5-codex");
});

maybeTest("configure mind stores reasoning effort when provided", async () => {
  const root = await makeRoot();
  const run = runCli([
    "configure", "mind",
    "--root", root,
    "--non-interactive",
    "--json",
    "--relay", "codex",
    "--set-default", "truth",
    "--backend", "openai-codex",
    "--host", "https://api.openai.com",
    "--model", "gpt-5.3-codex",
    "--reasoning-effort", "high",
    "--test-now", "lie"
  ]);
  assert.equal(run.status, 0, run.stderr);
  const payload = JSON.parse(run.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.config.reasoningEffort, "high");

  const secretPath = path.join(root, "configure", "secret.pya");
  const secretText = await fs.readFile(secretPath, "utf8");
  assert.match(secretText, /su name reasoning effort ob text "high" ya/);
  assert.match(secretText, /su name relay codex reasoning effort ob text "high" ya/);
  assert.match(secretText, /exists su name mind reasoning effort ob text "high" be default ya/);
});

maybeTest("configure mind supports multiple relays and one default relay", async () => {
  const root = await makeRoot();

  const first = runCli([
    "configure", "mind",
    "--root", root,
    "--non-interactive",
    "--json",
    "--relay", "local",
    "--set-default", "truth",
    "--backend", "ollama",
    "--host", "http://localhost:11434",
    "--model", "gpt-oss:latest",
    "--test-now", "lie"
  ]);
  assert.equal(first.status, 0, first.stderr);
  const firstPayload = JSON.parse(first.stdout);
  assert.equal(firstPayload.ok, true);
  assert.equal(firstPayload.config.defaultRelay, "local");

  const second = runCli([
    "configure", "mind",
    "--root", root,
    "--non-interactive",
    "--json",
    "--relay", "cloud",
    "--set-default", "lie",
    "--backend", "openai-api",
    "--host", "https://api.openai.com",
    "--model", "gpt-4o-mini",
    "--test-now", "lie"
  ]);
  assert.equal(second.status, 0, second.stderr);
  const secondPayload = JSON.parse(second.stdout);
  assert.equal(secondPayload.ok, true);
  assert.equal(secondPayload.config.defaultRelay, "local");
  assert.equal(secondPayload.config.relays.local.backend, "ollama command mind");
  assert.equal(secondPayload.config.relays.cloud.backend, "openai command mind");
  assert.equal(secondPayload.config.backend, "openai command mind");

  const secretPath = path.join(root, "configure", "secret.pya");
  const secretText = await fs.readFile(secretPath, "utf8");
  assert.match(secretText, /managed by pyash configure mind relays:start/);
  assert.match(secretText, /su name default relay ob text "local" ya/);
  assert.match(secretText, /su name relay local backend ob text "ollama command mind" ya/);
  assert.match(secretText, /su name relay cloud backend ob text "openai command mind" ya/);
  assert.match(secretText, /su name backend ob text "ollama command mind" ya/);
  assert.match(secretText, /exists su name mind relay default ob text "local" be default ya/);
});

maybeTest("configure intro json reports onboarding stage status", async () => {
  const root = await makeRoot();

  const before = runCli(["configure", "intro", "--root", root, "--json"]);
  assert.equal(before.status, 0, before.stderr);
  const beforePayload = JSON.parse(before.stdout);
  assert.equal(beforePayload.ok, true);
  assert.equal(beforePayload.status.channel, false);
  assert.equal(beforePayload.status.mind, false);
  assert.equal(beforePayload.status.agent, false);

  runCli([
    "configure", "channel", "matrix",
    "--root", root, "--non-interactive", "--json",
    "--homeserver", "https://matrix.org", "--room", "#pyash:matrix.org",
    "--auth-mode", "token", "--token", "abc123", "--test-now", "lie"
  ]);
  runCli([
    "configure", "mind",
    "--root", root, "--non-interactive", "--json",
    "--backend", "ollama command mind", "--host", "http://localhost:11434", "--model", "gpt-oss:latest",
    "--test-now", "lie"
  ]);
  runCli([
    "configure", "agent",
    "--root", root, "--non-interactive", "--json",
    "--agent", "builder", "--purpose", "Build things.",
    "--backend", "ollama", "--model", "gpt-oss:latest",
    "--bind-channel", "lie", "--smoke-test", "lie"
  ]);

  const after = runCli(["configure", "intro", "--root", root, "--json"]);
  assert.equal(after.status, 0, after.stderr);
  const afterPayload = JSON.parse(after.stdout);
  assert.equal(afterPayload.status.channel, true);
  assert.equal(afterPayload.status.mind, true);
  assert.equal(afterPayload.status.agent, true);
});

maybeTest("calendar health and list return json payload", async () => {
  const root = await makeRoot();
  const healthRun = runCli(["calendar", "health", "--root", root, "--json"]);
  assert.equal(healthRun.status, 0, healthRun.stderr);
  const healthPayload = JSON.parse(healthRun.stdout);
  assert.equal(healthPayload.ok, true);
  assert.equal(healthPayload.route, "calendar health");
  assert.equal(typeof healthPayload.result.running, "boolean");

  const listRun = runCli(["calendar", "list", "--root", root, "--json"]);
  assert.equal(listRun.status, 0, listRun.stderr);
  const listPayload = JSON.parse(listRun.stdout);
  assert.equal(listPayload.ok, true);
  assert.equal(listPayload.route, "calendar list");
  assert.equal(Array.isArray(listPayload.result.services), true);
});

maybeTest("calendar list supports agent filter and returns available/stopped service maps", async () => {
  const root = await makeRoot();
  const worldConduct = path.join(root, "world", "conduct");
  const agentConduct = path.join(root, "world", "house", "pyash-agent", "conduct");
  await fs.mkdir(worldConduct, { recursive: true });
  await fs.mkdir(agentConduct, { recursive: true });
  await fs.writeFile(
    path.join(worldConduct, "agent.pya"),
    'su name pyash-agent house directory ob filename "world/house/pyash-agent" ya\n',
    "utf8"
  );
  await fs.writeFile(path.join(worldConduct, "calendar.pya"), "", "utf8");
  await fs.writeFile(path.join(agentConduct, "calendar.pya"), [
    "su name heartbeat with wo tools vyah habit during minute 24 for name pyash-agent be calendar ya",
    "su name heartbeat lane ob text \"heartbeat\" ya"
  ].join("\n") + "\n", "utf8");
  await fs.mkdir(path.join(root, "world", "conduct"), { recursive: true });
  await fs.writeFile(
    path.join(root, "world", "conduct", "calendar.services.pya"),
    "su name heartbeat be disabled ya\n",
    "utf8"
  );

  const run = runCli(["calendar", "list", "--root", root, "--agent", "pyash-agent", "--json"]);
  assert.equal(run.status, 0, run.stderr);
  const payload = JSON.parse(run.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.agent, "pyash-agent");
  assert.equal(Array.isArray(payload.services), true);
  assert.equal(payload.services.includes("heartbeat"), true);
  assert.equal(Array.isArray(payload.available), true);
  assert.equal(payload.available.length, 0);
  assert.equal(Array.isArray(payload.stopped), true);
  assert.equal(payload.stopped.length, 1);
  assert.match(payload.stopped[0].sentence, /for name pyash-agent be calendar ya/);
});

maybeTest("calendar begin passes explicit world root to scheduler daemon", async () => {
  const root = await makeRoot();
  const worldRoot = path.join(root, "world");
  const beginRun = runCli(["calendar", "begin", "--root", root, "--json"]);
  assert.equal(beginRun.status, 0, beginRun.stderr);
  const beginPayload = JSON.parse(beginRun.stdout);
  assert.equal(beginPayload.ok, true);

  let observedWorldRoot = null;
  for (let i = 0; i < 20; i += 1) {
    const healthRun = runCli(["calendar", "health", "--root", root, "--json"]);
    assert.equal(healthRun.status, 0, healthRun.stderr);
    const healthPayload = JSON.parse(healthRun.stdout);
    assert.equal(healthPayload.ok, true);
    observedWorldRoot = healthPayload.result?.status?.worldRoot ?? null;
    if (observedWorldRoot) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.equal(observedWorldRoot, worldRoot);

  const stopRun = runCli(["calendar", "stop", "--root", root, "--json"]);
  assert.equal(stopRun.status, 0, stopRun.stderr);
});

maybeTest("channel bootstrap joins matrix room and resolves executive dm for a specific agent", async () => {
  const root = await makeRoot();
  const matrix = await startMatrixMockServer();
  try {
    const channelRun = await runCliAsync([
      "configure", "channel", "matrix",
      "--root", root,
      "--non-interactive",
      "--json",
      "--homeserver", matrix.homeserver,
      "--room", "#pyash:example.test",
      "--auth-mode", "shared-secret",
      "--registration-shared-secret", "shared-secret-value",
      "--write-agent-policy", "lie"
    ]);
    assert.equal(channelRun.status, 0, channelRun.stderr);

    const bootstrapRun = await runCliAsync([
      "channel", "bootstrap",
      "--root", root,
      "--agent", "accountant",
      "--executive", "@boss:example.test",
      "--json"
    ]);
    assert.equal(bootstrapRun.status, 0, bootstrapRun.stderr);
    const payload = JSON.parse(bootstrapRun.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.agentName, "accountant");
    assert.equal(payload.bootstrap?.joinedRoomId, "!main:example.test");
    assert.equal(payload.bootstrap?.executiveDm?.roomId, "!dm:example.test");

    const seenRegister = matrix.calls.some((call) =>
      call.method === "POST" && call.path === "/_synapse/admin/v1/register"
    );
    const seenLogin = matrix.calls.some((call) =>
      call.method === "POST" && call.path === "/_matrix/client/v3/login"
    );
    const seenJoin = matrix.calls.some((call) => call.method === "POST" && call.path === "/_matrix/client/v3/join/%23pyash%3Aexample.test");
    const seenCreateRoom = matrix.calls.some((call) => call.method === "POST" && call.path === "/_matrix/client/v3/createRoom");
    assert.equal(seenRegister, true);
    assert.equal(seenLogin, true);
    assert.equal(seenJoin, true);
    assert.equal(seenCreateRoom, true);
  } finally {
    await matrix.close();
  }
});

maybeTest("channel log returns not found when no newspaper exists", async () => {
  const root = await makeRoot();
  const run = runCli([
    "channel", "log",
    "--root", root,
    "--agent", "parity coder",
    "--channel", "matrix",
    "--json"
  ]);
  assert.equal(run.status, 0, run.stderr);
  const payload = JSON.parse(run.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.route, "channel log");
  assert.equal(payload.log.found, false);
});
