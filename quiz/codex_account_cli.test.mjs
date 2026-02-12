import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const codexAccountPath = path.resolve("command/codex_account.mjs");
const nodeStdoutProbe = spawnSync(process.execPath, ["-e", "console.log('ok')"], { encoding: "utf8" });
const canCaptureNodeChildStdout = String(nodeStdoutProbe.stdout ?? "").trim() === "ok";

async function makeMockCodexBin() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-codex-mock-"));
  const binPath = path.join(dir, "codex");
  const script = `#!/usr/bin/env bash
set -euo pipefail

mode="\${1:-}"
if [[ "$mode" != "app-server" ]]; then
  echo "expected app-server mode" >&2
  exit 2
fi

auth_mode="null"
account="null"
login_id="login-1"

json_id() {
  local line="$1"
  local id
  id="$(printf '%s' "$line" | sed -n 's/.*"id"[[:space:]]*:[[:space:]]*\\([0-9][0-9]*\\).*/\\1/p' | head -n1 || true)"
  if [[ -z "$id" ]]; then
    id="0"
  fi
  printf '%s' "$id"
}

while IFS= read -r line; do
  id="$(json_id "$line")"
  if [[ "$line" == *'"method":"initialize"'* ]]; then
    printf '{"jsonrpc":"2.0","id":%s,"result":{"ok":true}}\\n' "$id"
    continue
  fi
  if [[ "$line" == *'"method":"initialized"'* ]]; then
    continue
  fi
  if [[ "$line" == *'"method":"account/read"'* ]]; then
    printf '{"jsonrpc":"2.0","id":%s,"result":{"requiresOpenaiAuth":true,"authMode":%s,"account":%s}}\\n' "$id" "$auth_mode" "$account"
    continue
  fi
  if [[ "$line" == *'"method":"account/login/start"'* ]]; then
    printf '{"jsonrpc":"2.0","id":%s,"result":{"type":"chatgpt","loginId":"%s","authUrl":"https://chatgpt.com/auth?redirect_uri=http%%3A%%2F%%2Flocalhost%%3A8765%%2Fauth%%2Fcallback"}}\\n' "$id" "$login_id"
    (
      sleep 0.02
      echo '{"jsonrpc":"2.0","method":"account/login/completed","params":{"loginId":"login-1","success":true}}'
      echo '{"jsonrpc":"2.0","method":"account/updated","params":{"authMode":"chatgpt"}}'
    ) &
    auth_mode='"chatgpt"'
    account='{"type":"chatgpt","id":"acct-1","email":"dev@example.com"}'
    continue
  fi
  if [[ "$line" == *'"method":"account/login/cancel"'* ]]; then
    login_cancel_id="$(printf '%s' "$line" | sed -n 's/.*"loginId"[[:space:]]*:[[:space:]]*"\\([^"]*\\)".*/\\1/p' | head -n1)"
    if [[ -z "$login_cancel_id" ]]; then
      login_cancel_id="unknown"
    fi
    printf '{"jsonrpc":"2.0","id":%s,"result":{}}\\n' "$id"
    (
      sleep 0.01
      printf '{"jsonrpc":"2.0","method":"account/login/completed","params":{"loginId":"%s","success":false,"error":"cancelled"}}\\n' "$login_cancel_id"
    ) &
    continue
  fi
  if [[ "$line" == *'"method":"account/logout"'* ]]; then
    auth_mode="null"
    account="null"
    printf '{"jsonrpc":"2.0","id":%s,"result":{}}\\n' "$id"
    (
      sleep 0.01
      echo '{"jsonrpc":"2.0","method":"account/updated","params":{"authMode":null}}'
    ) &
    continue
  fi
  if [[ "$line" == *'"method":"account/rateLimits/read"'* ]]; then
    printf '{"jsonrpc":"2.0","id":%s,"result":{"windowMinutes":60,"remaining":42}}\\n' "$id"
    continue
  fi
  if [[ "$line" == *'"method":"model/list"'* ]]; then
    if [[ "$line" == *'"cursor":"page-2"'* ]]; then
      printf '{"jsonrpc":"2.0","id":%s,"result":{"models":[{"id":"gpt-5.2-codex","displayName":"GPT-5.2 Codex","isDefault":false}],"nextCursor":null}}\\n' "$id"
    else
      printf '{"jsonrpc":"2.0","id":%s,"result":{"models":[{"id":"gpt-5-codex","displayName":"GPT-5 Codex","isDefault":true,"inputModalities":["text"],"supportedReasoningEfforts":[{"reasoningEffort":"low"},{"reasoningEffort":"medium"},{"reasoningEffort":"high"}],"defaultReasoningEffort":"medium"}],"nextCursor":"page-2"}}\\n' "$id"
    fi
    continue
  fi
  printf '{"jsonrpc":"2.0","id":%s,"error":{"code":-32601,"message":"method not found"}}\\n' "$id"
done
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

test("codex account login completes using app-server notifications", async (t) => {
  if (!canCaptureNodeChildStdout) t.skip("environment cannot capture node child stdout");
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

test("codex account rate-limits and cancel actions return structured results", async (t) => {
  if (!canCaptureNodeChildStdout) t.skip("environment cannot capture node child stdout");
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

test("codex account models lists paginated model ids with default marker", async (t) => {
  if (!canCaptureNodeChildStdout) t.skip("environment cannot capture node child stdout");
  const { binPath } = await makeMockCodexBin();
  const run = runCodexCli(["models", "--json", "--codex-bin", binPath, "--limit", "1"]);
  assert.equal(run.status, 0, run.stderr);
  const payload = JSON.parse(run.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.action, "models");
  assert.equal(payload.pages, 2);
  assert.equal(Array.isArray(payload.models), true);
  assert.equal(payload.models.length, 2);
  assert.equal(payload.models[0].id, "gpt-5-codex");
  assert.equal(payload.models[0].isDefault, true);
  assert.equal(payload.models[0].defaultReasoningEffort, "medium");
  assert.deepEqual(payload.models[0].reasoningEffort, ["low", "medium", "high"]);
  assert.deepEqual(payload.models[1].inputModalities, ["text", "image"]);
});
