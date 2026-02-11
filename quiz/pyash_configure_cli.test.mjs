import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn, spawnSync } from "node:child_process";

const cliPath = path.resolve("command/pyash.mjs");

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

test("configure channel list emits matrix caterer", () => {
  const run = runCli(["configure", "channel", "list", "--json"]);
  assert.equal(run.status, 0, run.stderr);
  const payload = JSON.parse(run.stdout);
  assert.equal(payload.ok, true);
  assert.equal(Array.isArray(payload.caterers), true);
  assert.equal(payload.caterers.some((item) => item.name === "matrix"), true);
});

test("configure channel matrix dry-run does not write files", async () => {
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

test("configure channel matrix apply writes managed blocks and is idempotent", async () => {
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
  const channelsPath = path.join(root, "world", "house", "parity coder", "conduct", "channels.pya");
  const calendarPath = path.join(root, "world", "house", "parity coder", "conduct", "calendar.pya");
  const secretText = await fs.readFile(secretPath, "utf8");
  const worldChannelsText = await fs.readFile(worldChannelsPath, "utf8");
  const channelsText = await fs.readFile(channelsPath, "utf8");
  const calendarText = await fs.readFile(calendarPath, "utf8");
  assert.match(secretText, /managed by pyash configure matrix channel:start/);
  assert.match(secretText, /managed by pyash configure channel configure:start/);
  assert.match(worldChannelsText, /managed by pyash configure matrix channel world conduct:start/);
  assert.match(channelsText, /managed by pyash configure matrix channel conduct:start/);
  assert.match(calendarText, /su name channel poll for name parity coder with ve text "matrix" vyah habit during minute 1 be calendar ya/);

  const second = runCli(args);
  assert.equal(second.status, 0, second.stderr);
  const secondPayload = JSON.parse(second.stdout);
  assert.equal(secondPayload.ok, true);
  assert.equal(secondPayload.changed, false);
});

test("configure channel matrix scrubs legacy matrix seed lines from agent policy", async () => {
  const root = await makeRoot();
  const channelPath = path.join(root, "world", "house", "parity coder", "conduct", "channels.pya");
  await fs.mkdir(path.dirname(channelPath), { recursive: true });
  await fs.writeFile(channelPath, [
    "su name matrix channel ob bool truth ya",
    "su name matrix mention gate ob bool lie ya",
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
  assert.match(text, /su name matrix room ob text "#pyash:matrix\.org" ya/);
});

test("configure channel matrix shared-secret mode reuses provided token idempotently", async () => {
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

test("configure channel matrix appservice mode validates registration and persists mode fields", async () => {
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
  assert.equal(payload.config.mode, "appservice");
  assert.equal(payload.config.longPollMs, 45000);
  assert.equal(payload.appservice?.senderLocalpart, "pyash-agent");
  assert.equal(payload.appservice?.hasAsToken, true);
  assert.equal(payload.appservice?.hasHsToken, true);

  const secretPath = path.join(root, "configure", "secret.pya");
  const channelsPath = path.join(root, "world", "house", "pyash-agent", "conduct", "channels.pya");
  const secretText = await fs.readFile(secretPath, "utf8");
  const channelsText = await fs.readFile(channelsPath, "utf8");
  assert.match(secretText, /su name mode ob text "appservice" ya/);
  assert.match(secretText, /su name long poll ms ob text "45000" ya/);
  assert.match(secretText, /su name bridge service file ob text/);
  assert.match(channelsText, /su name matrix mode ob text "appservice" ya/);
  assert.match(channelsText, /su name matrix long poll ms ob text "45000" ya/);
  assert.match(channelsText, /su name matrix bridge service file ob text/);
});

test("configure channel matrix appservice mode defaults registration path to configure/secret/matrix.yaml", async () => {
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
  assert.equal(payload.config.mode, "appservice");
  assert.equal(payload.config.appserviceRegistration, "configure/secret/matrix.yaml");
  assert.equal(payload.appservice?.path, registrationPath);
  assert.equal(payload.appservice?.senderLocalpart, "pyash-agent");
});

test("configure channel matrix doctor fails with missing config", async () => {
  const root = await makeRoot();
  const run = runCli(["configure", "channel", "matrix", "doctor", "--root", root, "--json"]);
  assert.equal(run.status, 1, "doctor should fail for missing config");
  const payload = JSON.parse(run.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.issues.some((item) => item.code === "missing_config"), true);
});

test("configure channel matrix test fails when verification fails", async () => {
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

test("configure agent dry-run does not write house files", async () => {
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

test("configure agent apply writes runtime and binds channel when available", async () => {
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
  assert.equal(firstPayload.channelWrite.ok, true);

  const runtimePath = path.join(root, "world", "house", "builder", "conduct", "runtime.pya");
  const channelsPath = path.join(root, "world", "house", "builder", "conduct", "channels.pya");
  const runtimeText = await fs.readFile(runtimePath, "utf8");
  const channelsText = await fs.readFile(channelsPath, "utf8");
  assert.match(runtimeText, /managed by pyash configure agent runtime:start/);
  assert.match(channelsText, /managed by pyash configure matrix channel conduct:start/);

  const second = runCli(args);
  assert.equal(second.status, 0, second.stderr);
  const secondPayload = JSON.parse(second.stdout);
  assert.equal(secondPayload.ok, true);
  assert.equal(secondPayload.changed, false);
});

test("configure agent list returns configured agents", async () => {
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

test("configure agent list excludes houses without configured conduct", async () => {
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

test("configure agent improve reuses existing runtime defaults", async () => {
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

test("configure agent delete removes existing house", async () => {
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

test("configure agent interactive opens management menu", async () => {
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

test("configure orchestrator apply writes managed config and is idempotent", async () => {
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

test("configure mind dry-run does not write and apply writes defaults", async () => {
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

test("configure mind test-now verifies selected ollama model is available", async () => {
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

test("configure mind test-now skips live model probe for non-ollama backends", async () => {
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

test("configure mind accepts openai-codex backend alias", async () => {
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

test("configure mind can run codex oauth login for openai-codex relay", async () => {
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

test("configure mind openai-codex defaults host and model when omitted", async () => {
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

test("configure mind source switch ignores prior ollama host/model defaults", async () => {
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

test("configure mind stores reasoning effort when provided", async () => {
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

test("configure mind supports multiple relays and one default relay", async () => {
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

test("configure intro json reports onboarding stage status", async () => {
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

test("calendar health and list return json payload", async () => {
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

test("calendar list supports agent filter and returns available/stopped service maps", async () => {
  const root = await makeRoot();
  const worldConduct = path.join(root, "world", "conduct");
  const agentConduct = path.join(root, "world", "house", "pyash-agent", "conduct");
  await fs.mkdir(worldConduct, { recursive: true });
  await fs.mkdir(agentConduct, { recursive: true });
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

test("calendar begin passes explicit world root to scheduler daemon", async () => {
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

test("channel log returns not found when no newspaper exists", async () => {
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
