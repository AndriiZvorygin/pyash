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
  const secretText = await fs.readFile(secretPath, "utf8");
  const channelsText = await fs.readFile(channelsPath, "utf8");
  assert.match(secretText, /managed by pyash configure matrix channel:start/);
  assert.match(secretText, /managed by pyash configure channel configure:start/);
  assert.match(channelsText, /managed by pyash configure matrix channel conduct:start/);

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
