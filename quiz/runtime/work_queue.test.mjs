import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  buildWorkTask,
  canTransitionWorkStatus,
  transitionWorkTask,
  isTerminalWorkStatus
} from "../../program/runtime/work/contract.mjs";
import {
  ackWorkTaskFail,
  ackWorkTaskSuccess,
  claimOldestWorkTask,
  enqueueWorkTask,
  ensureWorkQueueDirs,
  queueDepth
} from "../../program/runtime/work/queue.mjs";
import {
  readWorkTaskStatus,
  transitionWorkTaskStatus
} from "../../program/runtime/work/status.mjs";

async function makeWorldRoot(prefix) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  const worldRoot = path.join(root, "world");
  await fs.mkdir(worldRoot, { recursive: true });
  return worldRoot;
}

function task(overrides = {}) {
  return {
    taskId: "parity-task-1",
    owner: "luna",
    kind: "roadmap",
    title: "Close one parity gap",
    priority: 10,
    queuedAt: "2026-08-07T12:00:00.000Z",
    acceptanceText: "Targeted quiz passes and git diff check is clean.",
    promptText: "Fix the named parity gap and report the evidence.",
    retryMax: 2,
    ...overrides
  };
}

test("work task contract accepts bounded lifecycle and rejects terminal rewrites", () => {
  const initial = buildWorkTask(task());
  assert.equal(initial.status, "ready");
  assert.equal(canTransitionWorkStatus("ready", "planning"), true);
  assert.equal(canTransitionWorkStatus("accepted", "revision"), false);

  const planning = transitionWorkTask(initial, "planning", {
    now: "2026-08-07T12:01:00.000Z"
  });
  const implementing = transitionWorkTask(planning, "implementing", {
    now: "2026-08-07T12:02:00.000Z"
  });
  const limited = transitionWorkTask(implementing, "usage-limited", {
    now: "2026-08-07T12:03:00.000Z",
    message: "wait for quota reset"
  });
  assert.equal(limited.previousStatus, "implementing");
  assert.equal(isTerminalWorkStatus(limited.status), false);

  assert.throws(
    () => transitionWorkTask(limited, "accepted"),
    /invalid transition usage-limited -> accepted/
  );
});

test("work queue persists status, claims oldest task, and acknowledges success", async () => {
  const worldRoot = await makeWorldRoot("pyash-work-queue-");
  await enqueueWorkTask(worldRoot, task({
    taskId: "old-task",
    queuedAt: "2026-08-07T12:00:00.000Z"
  }));
  await enqueueWorkTask(worldRoot, task({
    taskId: "new-task",
    queuedAt: "2026-08-07T12:01:00.000Z"
  }));

  const before = await queueDepth(worldRoot);
  assert.equal(before.input, 2);
  const persisted = await readWorkTaskStatus(worldRoot, "old-task");
  assert.equal(persisted.status, "ready");
  assert.equal(persisted.acceptanceText, "Targeted quiz passes and git diff check is clean.");
  assert.deepEqual(persisted.workSpec, {});

  const claimed = await claimOldestWorkTask(worldRoot, { workerTag: "sol" });
  assert.equal(claimed.task.taskId, "old-task");
  assert.match(claimed.path, /holding[\\/]work[\\/]runtime[\\/]/);

  await transitionWorkTaskStatus(worldRoot, "old-task", "planning", {
    now: "2026-08-07T12:02:00.000Z",
    message: "plan recorded"
  });
  const planning = await readWorkTaskStatus(worldRoot, "old-task");
  assert.equal(planning.status, "planning");
  assert.equal(planning.message, "plan recorded");

  await ackWorkTaskSuccess(worldRoot, { runtimePath: claimed.path });
  const after = await queueDepth(worldRoot);
  assert.equal(after.input, 1);
  assert.equal(after.runtime, 0);
  const paths = await ensureWorkQueueDirs(worldRoot);
  const successes = await fs.readdir(paths.produceSuccessDir);
  assert.equal(successes.length, 1);
});

test("work status retains structured checkpoint data across a claimed runtime item", async () => {
  const worldRoot = await makeWorldRoot("pyash-work-checkpoint-");
  await enqueueWorkTask(worldRoot, task({
    taskId: "checkpoint-task",
    workSpec: { source: "roadmap", acceptance: { test: "node --test" } }
  }));
  const claimed = await claimOldestWorkTask(worldRoot, { workerTag: "supervisor" });
  await transitionWorkTaskStatus(worldRoot, "checkpoint-task", "planning", {
    now: "2026-08-07T12:02:00.000Z"
  });
  const { updateWorkTaskCheckpoint } = await import("../../program/runtime/work/status.mjs");
  await updateWorkTaskCheckpoint(worldRoot, "checkpoint-task", {
    workspace: {
      repository: "/repo",
      baseRevision: "abc123",
      worktreePath: "/tmp/worktree/checkpoint-task",
      mode: "git-worktree"
    },
    manager: { model: "gpt-5.6-sol", threadId: "sol-thread" },
    plan: { workOrder: "make the change" },
    implementation: { changedFiles: ["file.txt"], tests: ["node --test"], diff: "+file" },
    review: { decision: "ACCEPT", explanation: "meets criteria" },
    revisionCount: 1
  });
  const recovered = await readWorkTaskStatus(worldRoot, "checkpoint-task");
  assert.equal(recovered.workSpec.source, "roadmap");
  assert.equal(recovered.checkpoint.workspace.baseRevision, "abc123");
  assert.equal(recovered.checkpoint.manager.threadId, "sol-thread");
  assert.deepEqual(recovered.checkpoint.implementation.changedFiles, ["file.txt"]);
  assert.equal(recovered.checkpoint.review.decision, "ACCEPT");
  assert.equal(recovered.checkpoint.revisionCount, 1);
  await ackWorkTaskSuccess(worldRoot, { runtimePath: claimed.path });
});

test("work queue persists retry count and moves terminal failure to fail", async () => {
  const worldRoot = await makeWorldRoot("pyash-work-retry-");
  await enqueueWorkTask(worldRoot, task({ taskId: "retry-task", retryMax: 2 }));

  let claimed = await claimOldestWorkTask(worldRoot, { workerTag: "luna" });
  await ackWorkTaskFail(worldRoot, {
    runtimePath: claimed.path,
    retryCount: claimed.task.retryCount,
    retryMax: claimed.task.retryMax
  });
  assert.equal((await queueDepth(worldRoot)).input, 1);

  claimed = await claimOldestWorkTask(worldRoot, { workerTag: "luna" });
  assert.equal(claimed.task.retryCount, 1);
  await ackWorkTaskFail(worldRoot, {
    runtimePath: claimed.path,
    retryCount: claimed.task.retryCount,
    retryMax: claimed.task.retryMax
  });

  claimed = await claimOldestWorkTask(worldRoot, { workerTag: "luna" });
  assert.equal(claimed.task.retryCount, 2);
  await ackWorkTaskFail(worldRoot, {
    runtimePath: claimed.path,
    retryCount: claimed.task.retryCount,
    retryMax: claimed.task.retryMax
  });

  const depth = await queueDepth(worldRoot);
  assert.equal(depth.total, 0);
  const paths = await ensureWorkQueueDirs(worldRoot);
  const failures = await fs.readdir(paths.produceFailDir);
  assert.equal(failures.length, 1);
  const status = await readWorkTaskStatus(worldRoot, "retry-task");
  assert.equal(status.status, "failed");
  assert.equal(status.retryCount, 3);
  assert.equal(Number.isFinite(Date.parse(status.finishedAt)), true);
});
