import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { curateWorkBacklog } from "../../program/runtime/work/curator.mjs";
import { integrateAcceptedWork } from "../../program/runtime/work/integration.mjs";
import { appendWorkSchedulerEvent } from "../../program/runtime/work/history.mjs";
import { buildWorkDailyDigest } from "../../program/runtime/work/digest.mjs";
import { enqueueWorkTask } from "../../program/runtime/work/queue.mjs";
import { listWorkTasks } from "../../program/runtime/work/operator.mjs";
import { readWorkTaskStatus, writeWorkTaskStatus } from "../../program/runtime/work/status.mjs";

const execFileAsync = promisify(execFile);

async function git(cwd, ...args) {
  return execFileAsync("git", args, { cwd, maxBuffer: 4 * 1024 * 1024 });
}

async function world(prefix) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  const worldRoot = path.join(root, "world");
  await fs.mkdir(worldRoot, { recursive: true });
  return { root, worldRoot };
}

test("backlog curation creates bounded TODO-sourced substantial packages without duplicates", async () => {
  const { root, worldRoot } = await world("pyash-work-curator-");
  const repositoryRoot = path.join(root, "repo");
  await fs.mkdir(path.join(repositoryRoot, "documentation"), { recursive: true });
  await fs.writeFile(path.join(repositoryRoot, "documentation", "todo.md"), [
    "Higher-level translation paths parity",
    "Mind: plus streaming path and richer reply envelopes per mind.md.",
    "Add error-handling paths for ceremonies/sandpits using ret with be error."
  ].join("\n"));
  const preview = await curateWorkBacklog({ worldRoot, repositoryRoot, dryRun: true, maxTasks: 2 });
  assert.equal(preview.proposed.length, 2);
  assert.equal(preview.proposed[0].provenance.kind, "todo");
  const created = await curateWorkBacklog({ worldRoot, repositoryRoot, maxTasks: 2, now: "2026-08-09T04:00:00.000Z" });
  assert.equal(created.created.length, 2);
  assert.equal((await curateWorkBacklog({ worldRoot, repositoryRoot, dryRun: true })).proposed.length, 0);
  const stored = await listWorkTasks(worldRoot, { includeTerminal: true });
  assert.equal(stored[0].workSpec.granularity, "substantial");
  assert.match(stored[0].contextText, /Why now/u);
});

test("accepted work fast-forwards automation branch and blocks a stale base", async () => {
  const { root } = await world("pyash-work-integration-");
  const repositoryRoot = path.join(root, "repo");
  const worktreePath = path.join(root, "task");
  await fs.mkdir(repositoryRoot, { recursive: true });
  await git(repositoryRoot, "init", "-q");
  await git(repositoryRoot, "config", "user.email", "test@example.com");
  await git(repositoryRoot, "config", "user.name", "Pyash Test");
  await fs.writeFile(path.join(repositoryRoot, "README.md"), "base\n");
  await git(repositoryRoot, "add", "README.md");
  await git(repositoryRoot, "commit", "-qm", "base");
  const baseRevision = (await git(repositoryRoot, "rev-parse", "HEAD")).stdout.trim();
  await git(repositoryRoot, "branch", "automation/roadmap", baseRevision);
  await git(repositoryRoot, "worktree", "add", "--detach", worktreePath, baseRevision);
  await fs.writeFile(path.join(worktreePath, "README.md"), "automation\n");
  await git(worktreePath, "add", "README.md");
  await git(worktreePath, "commit", "-qm", "automation change");
  const integrated = await integrateAcceptedWork({
    repositoryRoot,
    worktreePath,
    baseRevision,
    branch: "automation/roadmap",
    now: "2026-08-09T05:00:00.000Z"
  });
  assert.equal(integrated.status, "integrated");
  assert.notEqual(integrated.commit, baseRevision);
  assert.equal((await git(repositoryRoot, "rev-parse", "refs/heads/automation/roadmap")).stdout.trim(), integrated.commit);
  await assert.rejects(
    integrateAcceptedWork({ repositoryRoot, worktreePath, baseRevision, branch: "automation/roadmap" }),
    /advanced from task base/u
  );
});

test("daily digest aggregates scheduler events and durable task progress", async () => {
  const { root, worldRoot } = await world("pyash-work-digest-");
  const repositoryRoot = path.join(root, "repo");
  await fs.mkdir(repositoryRoot, { recursive: true });
  await enqueueWorkTask(worldRoot, {
    taskId: "digest-task",
    owner: "background",
    kind: "roadmap",
    title: "Complete a substantial parity tranche",
    priority: 125,
    queuedAt: "2026-08-09T06:00:00.000Z",
    promptText: "Implement it.",
    acceptanceText: "Tests pass."
  });
  const task = await readWorkTaskStatus(worldRoot, "digest-task");
  await writeWorkTaskStatus(worldRoot, {
    ...task,
    status: "accepted",
    startedAt: "2026-08-09T06:10:00.000Z",
    finishedAt: "2026-08-09T06:40:00.000Z",
    checkpoint: {
      ...task.checkpoint,
      plan: { summary: "Plan the tranche." },
      implementation: { summary: "Implemented the tranche.", passes: 2 },
      review: { decision: "ACCEPT", explanation: "Evidence is sufficient." },
      workspace: { worktreePath: "/tmp/digest-worktree" }
    }
  });
  const capacity = {
    weekly: {
      identified: true,
      state: "available",
      usedPercent: 8,
      remainingPercent: 92,
      windowStartAt: "2026-08-03T00:00:00.000Z",
      resetAt: "2026-08-10T00:00:00.000Z"
    }
  };
  await appendWorkSchedulerEvent(worldRoot, { type: "admitted", taskId: "digest-task", capacity }, { now: "2026-08-09T06:15:00.000Z" });
  await appendWorkSchedulerEvent(worldRoot, { type: "idle", reason: "no eligible work", capacity }, { now: "2026-08-09T06:45:00.000Z" });
  const digest = await buildWorkDailyDigest({
    worldRoot,
    repositoryRoot,
    since: "2026-08-09T00:00:00.000Z",
    until: "2026-08-09T23:00:00.000Z",
    capacitySource: async () => capacity,
    now: "2026-08-09T23:00:00.000Z"
  });
  assert.match(digest.report, /Complete a substantial parity tranche/u);
  assert.match(digest.report, /Admitted: 1/u);
  assert.match(digest.report, /Digest status:/u);
  assert.match(digest.subject, /Pyash needs direction:/u);
});
