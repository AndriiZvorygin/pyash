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
