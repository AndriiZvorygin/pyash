import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const codexAccountPath = path.resolve("command/codex_account.mjs");

async function makeMockCodexBin() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-codex-mock-"));
  const binPath = path.join(dir, "codex");
  const script = `#!/usr/bin/env node
import readline from "node:readline";

const mode = process.argv[2] || "";
if (mode !== "app-server") {
  process.stderr.write("expected app-server mode\\n");
  process.exit(2);
}

const state = { authMode: null, account: null, loginId: "login-1" };
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

function send(payload) {
  process.stdout.write(JSON.stringify(payload) + "\\n");
}

rl.on("line", (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  const id = message?.id;
  const method = message?.method;
  if (method === "initialize") {
    send({ jsonrpc: "2.0", id, result: { ok: true } });
    return;
  }
  if (method === "initialized") return;
  if (method === "account/read") {
    send({
      jsonrpc: "2.0",
      id,
      result: {
        requiresOpenaiAuth: true,
        authMode: state.authMode,
        account: state.account
      }
    });
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
      state.account = { type: "chatgpt", id: "acct-1", email: "dev@example.com" };
      send({ jsonrpc: "2.0", method: "account/login/completed", params: { loginId: state.loginId, success: true } });
      send({ jsonrpc: "2.0", method: "account/updated", params: { authMode: "chatgpt" } });
    }, 15);
    return;
  }
  if (method === "account/login/cancel") {
    send({ jsonrpc: "2.0", id, result: {} });
    setTimeout(() => {
      send({
        jsonrpc: "2.0",
        method: "account/login/completed",
        params: { loginId: message?.params?.loginId || "unknown", success: false, error: "cancelled" }
      });
    }, 5);
    return;
  }
  if (method === "account/logout") {
    state.authMode = null;
    state.account = null;
    send({ jsonrpc: "2.0", id, result: {} });
    setTimeout(() => send({ jsonrpc: "2.0", method: "account/updated", params: { authMode: null } }), 5);
    return;
  }
  if (method === "account/rateLimits/read") {
    send({ jsonrpc: "2.0", id, result: { windowMinutes: 60, remaining: 42 } });
    return;
  }
  send({ jsonrpc: "2.0", id, error: { code: -32601, message: "method not found" } });
});
`;
  await fs.writeFile(binPath, script, "utf8");
  await fs.chmod(binPath, 0o755);
  return { dir, binPath };
}

function runCodexCli(args) {
  return spawnSync(process.execPath, [codexAccountPath, ...args], {
    encoding: "utf8"
  });
}

test("codex account login completes using app-server notifications", async () => {
  const { binPath } = await makeMockCodexBin();
  const run = runCodexCli(["login", "--json", "--codex-bin", binPath, "--wait-ms", "2000"]);
  assert.equal(run.status, 0, run.stderr);
  const payload = JSON.parse(run.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.action, "login");
  assert.equal(payload.started.loginId, "login-1");
  assert.equal(payload.account.authMode, "chatgpt");
  assert.match(payload.sshHint, /ssh -L 8765:127\.0\.0\.1:8765/);
});

test("codex account rate-limits and cancel actions return structured results", async () => {
  const { binPath } = await makeMockCodexBin();

  const limits = runCodexCli(["rate-limits", "--json", "--codex-bin", binPath]);
  assert.equal(limits.status, 0, limits.stderr);
  const limitsPayload = JSON.parse(limits.stdout);
  assert.equal(limitsPayload.ok, true);
  assert.equal(limitsPayload.action, "rate-limits");
  assert.equal(limitsPayload.limits.remaining, 42);

  const cancel = runCodexCli(["cancel", "--json", "--codex-bin", binPath, "--login-id", "login-1"]);
  assert.equal(cancel.status, 0, cancel.stderr);
  const cancelPayload = JSON.parse(cancel.stdout);
  assert.equal(cancelPayload.ok, true);
  assert.equal(cancelPayload.completed.success, false);
  assert.equal(cancelPayload.completed.error, "cancelled");
});
