import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { spawnCodexAppServer, startCodexThread, threadIdFromResponse } from "../codex/app_server.mjs";

const execFileAsync = promisify(execFile);

function text(value) {
  return String(value ?? "").trim();
}

function iso(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString();
}

async function command(cwd, args) {
  const result = await execFileAsync(args[0], args.slice(1), {
    cwd,
    maxBuffer: 1024 * 1024
  });
  return text(result.stdout);
}

async function close(client) {
  try {
    await client?.close?.();
  } catch {}
}

function failure(check, error, details = {}) {
  const reason = text(error?.message || error) || `${check} failed`;
  return {
    ok: false,
    status: "blocked",
    check,
    reason,
    error: reason,
    details
  };
}

export async function inspectWorkExecutionPreflight({
  repositoryRoot,
  worktreePath = repositoryRoot,
  appServerFactory = ({}) => spawnCodexAppServer({}),
  threadSandbox = "workspace-write",
  turnSandboxPolicy = { type: "workspaceWrite" },
  model = process.env.PYA_WORKER_MODEL || "gpt-5.6-luna",
  now = () => new Date()
} = {}) {
  const repository = path.resolve(text(repositoryRoot) || process.cwd());
  const worktree = path.resolve(text(worktreePath) || repository);
  const checks = {};
  const observedAt = iso(typeof now === "function" ? now() : now);

  try {
    const stat = await fs.stat(worktree);
    if (!stat.isDirectory()) return failure("worktree", new Error(`worktree is not a directory: ${worktree}`));
    checks.worktree = worktree;
    await fs.access(worktree, fs.constants.R_OK | fs.constants.W_OK);
    const probe = path.join(worktree, `.pyash-execution-preflight-${process.pid}-${Date.now()}`);
    await fs.writeFile(probe, "preflight\n", "utf8");
    await fs.unlink(probe);
    checks.writable = true;
  } catch (error) {
    return failure("worktree writable", error, { worktree });
  }

  try {
    checks.gitTop = await command(worktree, ["git", "rev-parse", "--show-toplevel"]);
    checks.gitStatus = await command(worktree, ["git", "status", "--short"]);
  } catch (error) {
    return failure("git", error, { worktree });
  }

  try {
    checks.node = await command(worktree, [process.execPath, "--version"]);
  } catch (error) {
    return failure("node", error, { worktree });
  }

  let client;
  try {
    client = await appServerFactory({
      role: "preflight",
      model,
      cwd: worktree,
      threadSandbox,
      turnSandboxPolicy
    });
    const started = typeof client?.startThread === "function"
      ? await client.startThread({ role: "preflight", cwd: worktree, model, sandbox: threadSandbox })
      : await startCodexThread(client, { cwd: worktree, model, sandbox: threadSandbox });
    checks.appServer = "initialized";
    checks.threadSandbox = threadSandbox;
    checks.turnSandbox = turnSandboxPolicy?.type || "workspaceWrite";
    checks.threadId = threadIdFromResponse(started);
    if (!checks.threadId) return failure("Codex thread initialization", new Error("thread/start returned no thread id"), checks);
    return {
      ok: true,
      status: "ready",
      observedAt,
      repository,
      worktree,
      checks
    };
  } catch (error) {
    return failure("Codex App Server/sandbox initialization", error, {
      ...checks,
      repository,
      worktree,
      threadSandbox,
      turnSandbox: turnSandboxPolicy?.type || "workspaceWrite"
    });
  } finally {
    await close(client);
  }
}

export function executionPreflightReason(result) {
  return result?.ok ? "execution preflight passed" : `execution environment blocked: ${text(result?.reason) || "preflight failed"}`;
}
