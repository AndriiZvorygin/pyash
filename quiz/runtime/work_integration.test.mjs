import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { enqueueWorkTask } from "../../program/runtime/work/queue.mjs";
import { readWorkTaskStatus, writeWorkTaskStatus } from "../../program/runtime/work/status.mjs";
import { inspectWorkBackground } from "../../program/runtime/work/runner.mjs";
import { runWorkIntegrationReconciliationOnce } from "../../program/runtime/work/integration_runner.mjs";

const execFileAsync = promisify(execFile);

async function git(cwd, ...args) {
  return execFileAsync("git", args, { cwd, maxBuffer: 4 * 1024 * 1024 });
}

async function world(prefix) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  const worldRoot = path.join(root, "world");
  const repositoryRoot = path.join(root, "repo");
  await fs.mkdir(worldRoot, { recursive: true });
  await fs.mkdir(repositoryRoot, { recursive: true });
  await git(repositoryRoot, "init", "-q");
  await git(repositoryRoot, "config", "user.email", "test@example.invalid");
  await git(repositoryRoot, "config", "user.name", "Pyash Integration Test");
  await fs.writeFile(path.join(repositoryRoot, "README.md"), "base\n");
  await git(repositoryRoot, "add", "README.md");
  await git(repositoryRoot, "commit", "-qm", "base");
  const baseRevision = (await git(repositoryRoot, "rev-parse", "HEAD")).stdout.trim();
  await git(repositoryRoot, "branch", "automation/roadmap", baseRevision);
  return { root, worldRoot, repositoryRoot, baseRevision };
}

function capacity() {
  return {
    state: "available",
    weekly: {
      identified: true,
      usedPercent: 10,
      remainingPercent: 90,
      windowStartAt: "2026-08-13T00:00:00.000Z",
      resetAt: "2026-08-20T00:00:00.000Z",
      windowMinutes: 10080
    }
  };
}

function blockedTask(taskId, title, priority, blocker, integrationStatus = "") {
  return {
    taskId,
    owner: "background",
    kind: "roadmap",
    title,
    priority,
    status: "blocked",
    queuedAt: "2026-08-17T00:00:00.000Z",
    acceptanceText: "The focused tests pass and Sol reviews the result.",
    promptText: "Preserve the intended capability on the current automation baseline.",
    contextText: "Existing accepted implementation evidence is recorded in the task checkpoint.",
    workSpec: { granularity: "substantial" },
    checkpoint: {
      blocker,
      integration: integrationStatus ? { status: integrationStatus } : {}
    }
  };
}

async function acceptedTranslationPrerequisite(worldRoot) {
  await enqueueWorkTask(worldRoot, {
    taskId: "roadmap-translation-parity-tranche",
    owner: "background",
    kind: "roadmap",
    title: "Complete translation parity",
    priority: 130,
    queuedAt: "2026-08-17T00:00:00.000Z",
    acceptanceText: "Interpreter and JavaScript parity pass.",
    promptText: "Complete translation parity."
  });
  const task = await readWorkTaskStatus(worldRoot, "roadmap-translation-parity-tranche");
  await writeWorkTaskStatus(worldRoot, {
    ...task,
    status: "accepted",
    checkpoint: {
      ...task.checkpoint,
      integration: { status: "integrated", commit: "translation-task", branchCommit: "translation-baseline" }
    }
  });
}

test("external-evidence work is excluded while integration reconciliation is selected", async () => {
  const { worldRoot } = await world("pyash-integration-selection-");
  await acceptedTranslationPrerequisite(worldRoot);
  await enqueueWorkTask(worldRoot, { ...blockedTask(
    "roadmap-mind-reply-envelope-streaming",
    "Mind reply envelopes and streaming",
    130,
    "Acceptance requires live Ollama evidence, but the required service is unavailable."
  ), status: "ready" });
  const mind = await readWorkTaskStatus(worldRoot, "roadmap-mind-reply-envelope-streaming");
  await writeWorkTaskStatus(worldRoot, { ...mind, status: "blocked" });
  await enqueueWorkTask(worldRoot, { ...blockedTask(
    "roadmap-ceremony-error-propagation",
    "Ceremony and sandpit error propagation",
    120,
    "automation branch integration blocked: merge conflict",
    "blocked"
  ), status: "ready" });
  const ceremony = await readWorkTaskStatus(worldRoot, "roadmap-ceremony-error-propagation");
  await writeWorkTaskStatus(worldRoot, { ...ceremony, status: "blocked" });
  const inspected = await inspectWorkBackground({
    worldRoot,
    owner: "background",
    capacitySource: async () => capacity(),
    policy: { enabled: true },
    now: "2026-08-18T12:00:00.000Z"
  });
  assert.equal(inspected.selected.taskId, "roadmap-ceremony-error-propagation");
  assert.deepEqual(inspected.externalEvidence.map((task) => task.taskId), ["roadmap-mind-reply-envelope-streaming"]);
  assert.deepEqual(inspected.recoverable.map((task) => task.taskId), ["roadmap-ceremony-error-propagation"]);
});

test("a live integration turn makes the next package the fallback candidate", async () => {
  const { worldRoot } = await world("pyash-integration-fallback-");
  await acceptedTranslationPrerequisite(worldRoot);
  await enqueueWorkTask(worldRoot, {
    ...blockedTask("roadmap-ceremony-error-propagation", "Ceremony errors", 120, "integration reconciliation timed out", "reconciliation"),
    status: "ready",
    checkpoint: { activeTurn: { state: "ambiguous", startedAt: "2026-08-18T11:55:00.000Z", requestIdentity: "live-turn" }, integration: { status: "reconciliation" } }
  });
  const first = await readWorkTaskStatus(worldRoot, "roadmap-ceremony-error-propagation");
  await writeWorkTaskStatus(worldRoot, { ...first, status: "blocked" });
  await enqueueWorkTask(worldRoot, {
    ...blockedTask("roadmap-register-state-ground-truth", "Register state", 115, "automation branch integration blocked: merge conflict", "blocked"),
    status: "ready"
  });
  const second = await readWorkTaskStatus(worldRoot, "roadmap-register-state-ground-truth");
  await writeWorkTaskStatus(worldRoot, { ...second, status: "blocked" });
  const inspected = await inspectWorkBackground({
    worldRoot,
    owner: "background",
    capacitySource: async () => capacity(),
    policy: { enabled: true },
    now: "2026-08-18T12:00:00.000Z"
  });
  assert.equal(inspected.selected.taskId, "roadmap-register-state-ground-truth");
});

test("Luna reconciliation on the current automation baseline integrates after Sol ACCEPT", async () => {
  const { worldRoot, repositoryRoot, baseRevision } = await world("pyash-integration-run-");
  const taskId = "roadmap-ceremony-error-propagation";
  await enqueueWorkTask(worldRoot, {
    ...blockedTask(taskId, "Ceremony and sandpit error propagation", 120, "merge conflict", "reconciliation"),
    status: "ready",
    checkpoint: {
      workspace: { repository: repositoryRoot, baseRevision, worktreePath: path.join(repositoryRoot, "old-task-worktree") },
      plan: { workOrder: "Preserve truthful ceremony errors and run focused regression tests." },
      implementation: { summary: "Accepted task implementation on the old baseline.", commit: baseRevision },
      integration: { status: "reconciliation", reconciliation: { taskBaseRevision: baseRevision, taskCommit: baseRevision } }
    }
  });
  const clients = new Map();
  class FakeClient {
    constructor(role) { this.role = role; }
    async startThread() { return { thread: { id: `${this.role}-thread` } }; }
    async resumeThread(options) { return { thread: { id: options.threadId } }; }
    async runTurn(options) {
      if (this.role === "worker") {
        await fs.writeFile(path.join(options.cwd, "reconciled.txt"), "semantic reconciliation\n");
        await git(options.cwd, "add", "reconciled.txt");
        await git(options.cwd, "commit", "-qm", "reconcile ceremony capability");
        const revision = (await git(options.cwd, "rev-parse", "HEAD")).stdout.trim();
        return {
          turnId: "worker-reconcile",
          text: `SUMMARY: Reapplied the ceremony capability on the current baseline.\nCHANGED FILES: reconciled.txt\nTESTS: node --test quiz/ceremony.test.mjs passes\nBLOCKERS: \nUNCERTAINTY: none\nREVIEW READY: yes\nCONFLICTS RESOLVED: 1\nCOMMIT: ${revision}`
        };
      }
      return { turnId: "manager-review", text: "DECISION: ACCEPT\nRATIONALE: The semantic capability and focused evidence are preserved." };
    }
    async close() {}
  }
  const result = await runWorkIntegrationReconciliationOnce({
    worldRoot,
    repositoryRoot,
    owner: "background",
    taskId,
    integrationBranch: "automation/roadmap",
    appServerFactory: async ({ role }) => {
      if (!clients.has(role)) clients.set(role, new FakeClient(role));
      return clients.get(role);
    },
    now: "2026-08-18T12:10:00.000Z"
  });
  assert.equal(result.status, "accepted");
  const task = await readWorkTaskStatus(worldRoot, taskId);
  assert.equal(task.status, "accepted");
  assert.equal(task.checkpoint.integration.status, "integrated");
  assert.equal(task.checkpoint.integration.reconciliation.materialAttempts, 1);
  assert.equal(task.checkpoint.integration.reconciliation.conflictsResolved, 1);
  assert.equal((await git(repositoryRoot, "show", "refs/heads/automation/roadmap:reconciled.txt")).stdout, "semantic reconciliation\n");
});
