import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { spawnCodexAppServer, startCodexThread, runCodexTurn, threadIdFromResponse } from "../codex/app_server.mjs";
import { inspectWorkExecutionPreflight } from "./preflight.mjs";

const execFileAsync = promisify(execFile);

function text(value) {
  return String(value ?? "").trim();
}

async function git(cwd, ...args) {
  return execFileAsync("git", args, { cwd, maxBuffer: 4 * 1024 * 1024 });
}

async function removeWorktree(repository, worktree) {
  try {
    await git(repository, "worktree", "remove", "--force", worktree);
  } catch {}
}

export async function runSandboxSmoke({
  repositoryRoot = process.cwd(),
  threadSandbox = "workspace-write",
  turnSandboxPolicy = { type: "workspaceWrite" },
  model = process.env.PYA_WORKER_MODEL || "gpt-5.6-luna",
  timeoutMs = 180000
} = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-sandbox-smoke-"));
  const repository = path.join(root, "fixture");
  const worktree = path.join(root, "worktree");
  let client;
  try {
    await fs.mkdir(repository, { recursive: true });
    await git(repository, "init", "-q");
    await git(repository, "config", "user.email", "pyash-smoke@example.invalid");
    await git(repository, "config", "user.name", "Pyash Sandbox Smoke");
    await fs.writeFile(path.join(repository, "SMOKE.md"), "Create smoke-result.txt with exactly sandbox smoke passed, then run node test.mjs.\n", "utf8");
    await fs.writeFile(path.join(repository, "test.mjs"), "import fs from \"node:fs\"; if (fs.readFileSync(\"smoke-result.txt\", \"utf8\") !== \"sandbox smoke passed\\n\") process.exit(1); console.log(\"smoke test passed\");\n", "utf8");
    await git(repository, "add", "SMOKE.md", "test.mjs");
    await git(repository, "commit", "-qm", "sandbox smoke fixture");
    const revision = text((await git(repository, "rev-parse", "HEAD")).stdout);
    await git(repository, "worktree", "add", "--detach", worktree, revision);

    const preflight = await inspectWorkExecutionPreflight({
      repositoryRoot,
      worktreePath: worktree,
      threadSandbox,
      turnSandboxPolicy,
      model
    });
    if (!preflight.ok) return { status: "blocked", phase: "preflight", preflight, repository, worktree };

    client = await spawnCodexAppServer({});
    const started = await startCodexThread(client, { cwd: worktree, model, sandbox: threadSandbox });
    const threadId = threadIdFromResponse(started);
    const result = await runCodexTurn(client, {
      threadId,
      cwd: worktree,
      model,
      approvalPolicy: "never",
      sandboxPolicy: turnSandboxPolicy,
      requestIdentity: `pyash-sandbox-smoke-${Date.now()}`,
      timeoutMs,
      input: [{
        type: "text",
        text: "You are performing a disposable Pyash sandbox smoke test. Work only in the assigned worktree. Read SMOKE.md, create smoke-result.txt with exactly the requested contents, run node test.mjs, and report the file, command, output, and git status. Do not modify any other file and do not commit."
      }]
    });
    const smokeFile = path.join(worktree, "smoke-result.txt");
    let contents = "";
    try {
      contents = await fs.readFile(smokeFile, "utf8");
    } catch (error) {
      return {
        status: "failed",
        phase: "verification",
        sandbox: { thread: threadSandbox, turn: turnSandboxPolicy?.type || "workspaceWrite" },
        repository,
        worktree,
        preflight,
        threadId,
        turnId: result.turnId,
        result: result.text,
        events: result.events,
        error: `smoke result missing: ${text(error?.message || error)}`
      };
    }
    const test = await execFileAsync(process.execPath, ["test.mjs"], { cwd: worktree, maxBuffer: 1024 * 1024 });
    const status = text((await git(worktree, "status", "--short")).stdout);
    const diff = text((await git(worktree, "diff", "--no-ext-diff")).stdout);
    return {
      status: "passed",
      phase: "completed",
      sandbox: { thread: threadSandbox, turn: turnSandboxPolicy?.type || "workspaceWrite" },
      repository,
      worktree,
      preflight,
      threadId,
      turnId: result.turnId,
      result: result.text,
      file: { path: smokeFile, contents },
      test: { command: `${process.execPath} test.mjs`, output: text(test.stdout), status: test.status ?? 0 },
      gitStatus: status,
      diff
    };
  } catch (error) {
    return {
      status: "failed",
      phase: "execution",
      sandbox: { thread: threadSandbox, turn: turnSandboxPolicy?.type || "workspaceWrite" },
      repository,
      worktree,
      error: text(error?.message || error)
    };
  } finally {
    try {
      await client?.close?.();
    } catch {}
    await removeWorktree(repository, worktree);
    await fs.rm(root, { recursive: true, force: true });
  }
}
