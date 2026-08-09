import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { inspectWorkExecutionPreflight } from "../../program/runtime/work/preflight.mjs";

const execFileAsync = promisify(execFile);

async function repository(prefix) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  await execFileAsync("git", ["init", "-q"], { cwd: root });
  return root;
}

test("execution preflight checks the worktree without starting a model turn", async () => {
  const root = await repository("pyash-preflight-");
  const calls = [];
  const result = await inspectWorkExecutionPreflight({
    repositoryRoot: root,
    worktreePath: root,
    threadSandbox: "workspace-write",
    turnSandboxPolicy: { type: "workspaceWrite" },
    appServerFactory: async () => ({
      async startThread(options) {
        calls.push(options);
        return { thread: { id: "preflight-thread" } };
      },
      async close() {}
    })
  });
  assert.equal(result.ok, true);
  assert.equal(result.status, "ready");
  assert.equal(result.checks.threadId, "preflight-thread");
  assert.equal(result.checks.node.startsWith("v"), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].sandbox, "workspace-write");
});

test("execution preflight preserves sandbox initialization failure as infrastructure state", async () => {
  const root = await repository("pyash-preflight-fail-");
  const result = await inspectWorkExecutionPreflight({
    repositoryRoot: root,
    worktreePath: root,
    appServerFactory: async () => {
      throw new Error("bwrap: loopback: Failed RTM_NEWADDR: Operation not permitted");
    }
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, "blocked");
  assert.equal(result.check, "Codex App Server/sandbox initialization");
  assert.match(result.reason, /RTM_NEWADDR/u);
});
