import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  acquireSharedWorkspaceLease,
  prepareSharedCheckout
} from "../../program/runtime/work/workspace.mjs";
import { enqueueWorkTask, queueDepth } from "../../program/runtime/work/queue.mjs";
import { readWorkTaskStatus } from "../../program/runtime/work/status.mjs";
import { runWorkSupervisorOnce } from "../../program/runtime/work/supervisor.mjs";

const execFileAsync = promisify(execFile);

async function repositoryFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-shared-workspace-"));
  const repositoryRoot = path.join(root, "repo");
  const worldRoot = path.join(root, "world");
  await fs.mkdir(repositoryRoot, { recursive: true });
  await fs.mkdir(worldRoot, { recursive: true });
  await execFileAsync("git", ["init", "-q", repositoryRoot]);
  await execFileAsync("git", ["config", "user.email", "test@example.invalid"], { cwd: repositoryRoot });
  await execFileAsync("git", ["config", "user.name", "Pyash Workspace Test"], { cwd: repositoryRoot });
  await fs.writeFile(path.join(repositoryRoot, "README.md"), "clean\n");
  await execFileAsync("git", ["add", "README.md"], { cwd: repositoryRoot });
  await execFileAsync("git", ["commit", "-qm", "initial"], { cwd: repositoryRoot });
  await execFileAsync("git", ["branch", "automation/roadmap"], { cwd: repositoryRoot });
  return { root, repositoryRoot, worldRoot };
}

test("task execution uses the existing repository checkout without adding a worktree", async () => {
  const { repositoryRoot, worldRoot, root } = await repositoryFixture();
  const lease = await acquireSharedWorkspaceLease({ repositoryRoot, worldRoot });
  assert.equal(lease.status, "acquired");
  const before = (await execFileAsync("git", ["worktree", "list", "--porcelain"], { cwd: repositoryRoot })).stdout;
  const workspace = await prepareSharedCheckout({
    repositoryRoot,
    worldRoot,
    baseRef: "automation/roadmap",
    worktreePath: path.join(worldRoot, "holding", "work", "worktrees", "roadmap-task")
  });
  assert.equal(workspace.branch, "automation/roadmap");
  assert.equal((await execFileAsync("git", ["branch", "--show-current"], { cwd: repositoryRoot })).stdout.trim(), "automation/roadmap");
  await lease.release();
  assert.equal((await execFileAsync("git", ["branch", "--show-current"], { cwd: repositoryRoot })).stdout.trim(), "master");
  const after = (await execFileAsync("git", ["worktree", "list", "--porcelain"], { cwd: repositoryRoot })).stdout;

  assert.equal(workspace.worktreePath, repositoryRoot);
  assert.equal(workspace.mode, "shared-checkout");
  assert.equal(after, before);
  await assert.rejects(fs.access(path.join(worldRoot, "holding", "work", "worktrees", "roadmap-task")));
  await fs.rm(root, { recursive: true, force: true });
});

test("shared task workspace refuses to start on a dirty checkout", async () => {
  const { repositoryRoot, worldRoot, root } = await repositoryFixture();
  await fs.writeFile(path.join(repositoryRoot, "local-change.txt"), "preserve me\n");

  await assert.rejects(prepareSharedCheckout({ repositoryRoot, worldRoot }), /dirty shared repository/u);
  assert.equal(await fs.readFile(path.join(repositoryRoot, "local-change.txt"), "utf8"), "preserve me\n");
  await fs.rm(root, { recursive: true, force: true });
});

test("only one agent run can lease the shared repository at a time", async () => {
  const { repositoryRoot, worldRoot, root } = await repositoryFixture();
  const first = await acquireSharedWorkspaceLease({ repositoryRoot, worldRoot });
  assert.equal(first.status, "acquired");

  const concurrent = await acquireSharedWorkspaceLease({ repositoryRoot, worldRoot });
  assert.equal(concurrent.status, "busy");

  await first.release();
  const next = await acquireSharedWorkspaceLease({ repositoryRoot, worldRoot });
  assert.equal(next.status, "acquired");
  await next.release();
  await fs.rm(root, { recursive: true, force: true });
});

test("a dirty shared repository prevents the agent lease without changing files", async () => {
  const { repositoryRoot, worldRoot, root } = await repositoryFixture();
  const changePath = path.join(repositoryRoot, "local-change.txt");
  await fs.writeFile(changePath, "preserve me\n");

  const lease = await acquireSharedWorkspaceLease({ repositoryRoot, worldRoot });
  assert.equal(lease.status, "dirty");
  assert.equal(await fs.readFile(changePath, "utf8"), "preserve me\n");
  await fs.rm(root, { recursive: true, force: true });
});

test("branch restoration preserves uncommitted task output on the shared checkout", async () => {
  const { repositoryRoot, worldRoot, root } = await repositoryFixture();
  const lease = await acquireSharedWorkspaceLease({ repositoryRoot, worldRoot });
  await prepareSharedCheckout({ repositoryRoot, baseRef: "automation/roadmap" });
  const outputPath = path.join(repositoryRoot, "task-output.txt");
  await fs.writeFile(outputPath, "checkpoint this work\n");

  await lease.release();

  assert.equal((await execFileAsync("git", ["branch", "--show-current"], { cwd: repositoryRoot })).stdout.trim(), "automation/roadmap");
  assert.equal(await fs.readFile(outputPath, "utf8"), "checkpoint this work\n");
  await fs.rm(root, { recursive: true, force: true });
});

test("a dirty checkout defers queued work before claiming or starting an agent", async () => {
  const { repositoryRoot, worldRoot, root } = await repositoryFixture();
  await enqueueWorkTask(worldRoot, {
    taskId: "roadmap-held-task",
    owner: "background",
    kind: "roadmap",
    title: "Preserve queued work",
    acceptanceText: "The task remains queued until the checkout is clean.",
    promptText: "Make the bounded change."
  });
  const changePath = path.join(repositoryRoot, "local-change.txt");
  await fs.writeFile(changePath, "preserve me\n");

  const result = await runWorkSupervisorOnce({ repositoryRoot, worldRoot });

  assert.equal(result.claimed, false);
  assert.equal(result.status, "dirty");
  assert.equal((await queueDepth(worldRoot)).input, 1);
  assert.equal((await readWorkTaskStatus(worldRoot, "roadmap-held-task")).status, "ready");
  assert.equal(await fs.readFile(changePath, "utf8"), "preserve me\n");
  await fs.rm(root, { recursive: true, force: true });
});
