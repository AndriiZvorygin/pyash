import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const cliPath = path.resolve("command/pyash.mjs");

function runCli(args, opts = {}) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    encoding: "utf8",
    ...opts
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
  const channelsPath = path.join(root, "world", "house", "parity coder", "conduct", "channels.pya");
  const calendarPath = path.join(root, "world", "house", "parity coder", "conduct", "calendar.pya");
  const secretText = await fs.readFile(secretPath, "utf8");
  const channelsText = await fs.readFile(channelsPath, "utf8");
  const calendarText = await fs.readFile(calendarPath, "utf8");
  assert.match(secretText, /managed by pyash configure matrix channel:start/);
  assert.match(secretText, /managed by pyash configure channel configure:start/);
  assert.match(channelsText, /managed by pyash configure matrix channel conduct:start/);
  assert.match(calendarText, /su name matrix poll for name parity coder with wo tools vyah habit during minute 1 be calendar ya/);

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
    "--health-minute", "1"
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

test("configure intro json reports onboarding stage status", async () => {
  const root = await makeRoot();

  const before = runCli(["configure", "intro", "--root", root, "--json"]);
  assert.equal(before.status, 0, before.stderr);
  const beforePayload = JSON.parse(before.stdout);
  assert.equal(beforePayload.ok, true);
  assert.equal(beforePayload.status.orchestrator, false);
  assert.equal(beforePayload.status.channel, false);
  assert.equal(beforePayload.status.mind, false);
  assert.equal(beforePayload.status.agent, false);

  runCli([
    "configure", "orchestrator",
    "--root", root, "--non-interactive", "--json",
    "--mode", "container", "--host", "127.0.0.1", "--port", "59652",
    "--autostart", "truth", "--health-minute", "1"
  ]);
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
  assert.equal(afterPayload.status.orchestrator, true);
  assert.equal(afterPayload.status.channel, true);
  assert.equal(afterPayload.status.mind, true);
  assert.equal(afterPayload.status.agent, true);
});
