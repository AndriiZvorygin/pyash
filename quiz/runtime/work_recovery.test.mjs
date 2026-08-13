import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { enqueueWorkTask } from "../../program/runtime/work/queue.mjs";
import { runWorkBackgroundOnce } from "../../program/runtime/work/runner.mjs";
import {
  findRecoverableOperationalWorkTasks,
  isRecoverableOperationalWorkTask,
  recoverOperationalWorkTask
} from "../../program/runtime/work/recovery.mjs";
import { listWorkTasks } from "../../program/runtime/work/operator.mjs";
import { readWorkTaskStatus, writeWorkTaskStatus } from "../../program/runtime/work/status.mjs";

async function world(prefix) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  const worldRoot = path.join(root, "world");
  await fs.mkdir(worldRoot, { recursive: true });
  return worldRoot;
}

async function blockedTask(worldRoot, {
  taskId,
  priority = 100,
  blocker = "turn timeout",
  activeTurn = {},
  kind = "roadmap",
  granularity = "substantial"
} = {}) {
  await enqueueWorkTask(worldRoot, {
    taskId,
    owner: "background",
    kind,
    title: taskId,
    priority,
    promptText: "Implement the bounded package.",
    acceptanceText: "Focused tests pass.",
    workSpec: { granularity }
  });
  const task = await readWorkTaskStatus(worldRoot, taskId);
  return writeWorkTaskStatus(worldRoot, {
    ...task,
    status: "blocked",
    message: blocker,
    error: blocker,
    checkpoint: {
      ...task.checkpoint,
      blocker,
      activeTurn
    }
  });
}

test("stale operational timeout is recoverable but live or human blockers are not", async () => {
  const old = "2026-08-10T00:00:00.000Z";
  const now = "2026-08-12T12:00:00.000Z";
  const task = {
    taskId: "roadmap-timeout",
    status: "blocked",
    kind: "roadmap",
    workSpec: { granularity: "substantial" },
    checkpoint: {
      blocker: "turn timeout",
      activeTurn: { state: "ambiguous", startedAt: old, turnId: "" }
    }
  };
  assert.equal(isRecoverableOperationalWorkTask(task, { now }), true);
  assert.equal(isRecoverableOperationalWorkTask({
    ...task,
    checkpoint: { ...task.checkpoint, activeTurn: { state: "ambiguous", startedAt: old, turnId: "remote-turn" } }
  }, { now }), false);
  assert.equal(isRecoverableOperationalWorkTask({
    ...task,
    checkpoint: { blocker: "Sol review BLOCK: human decision required", activeTurn: {} }
  }, { now }), false);
  assert.equal(isRecoverableOperationalWorkTask({
    ...task,
    checkpoint: { blocker: "automation branch integration blocked: merge conflict", activeTurn: {} }
  }, { now }), false);
  assert.equal(isRecoverableOperationalWorkTask({
    ...task,
    checkpoint: { blocker: "turn timeout", activeTurn: { state: "ambiguous", startedAt: "2026-08-12T11:45:00.000Z" } }
  }, { now }), false);
});

test("recovery preserves the blocker and cannot revive the same task twice", async () => {
  const worldRoot = await world("pyash-work-recovery-history-");
  await blockedTask(worldRoot, {
    taskId: "roadmap-recover-once",
    blocker: "turn timeout while starting Luna",
    activeTurn: { state: "ambiguous", startedAt: "2026-08-10T00:00:00.000Z" }
  });
  const recovered = await recoverOperationalWorkTask(worldRoot, "roadmap-recover-once", {
    now: "2026-08-12T12:00:00.000Z"
  });
  assert.equal(recovered.task.status, "ready");
  assert.equal(recovered.task.checkpoint.recoveryCount, 1);
  assert.equal(recovered.task.checkpoint.recoveryHistory[0].previousBlocker, "turn timeout while starting Luna");
  assert.equal(recovered.task.checkpoint.activeTurn.state, "");
  assert.equal(await recoverOperationalWorkTask(worldRoot, "roadmap-recover-once", {
    now: "2026-08-12T13:00:00.000Z"
  }), null);
  assert.deepEqual((await findRecoverableOperationalWorkTasks(worldRoot)).map((task) => task.taskId), []);
});

test("active-writer recovery preserves the old thread and isolates the replacement worktree", async () => {
  const worldRoot = await world("pyash-work-recovery-replacement-");
  await blockedTask(worldRoot, {
    taskId: "roadmap-active-writer",
    blocker: "thread luna-thread already has an active writer",
    activeTurn: { state: "ambiguous", startedAt: "2026-08-12T12:00:00.000Z" }
  });
  const task = await readWorkTaskStatus(worldRoot, "roadmap-active-writer");
  await writeWorkTaskStatus(worldRoot, {
    ...task,
    checkpoint: {
      ...task.checkpoint,
      recoveryCount: 1,
      worker: { ...task.checkpoint.worker, threadId: "luna-thread" },
      workspace: { ...task.checkpoint.workspace, worktreePath: "/tmp/roadmap-active-writer" }
    }
  });
  const recovered = await recoverOperationalWorkTask(worldRoot, "roadmap-active-writer", {
    now: "2026-08-12T12:01:00.000Z"
  });
  assert.equal(recovered.task.status, "ready");
  assert.equal(recovered.task.checkpoint.worker.threadId, "");
  assert.deepEqual(recovered.task.checkpoint.worker.previousThreadIds, ["luna-thread"]);
  assert.equal(recovered.task.checkpoint.workspace.worktreePath, "/tmp/roadmap-active-writer-replacement-1");
  assert.equal(recovered.task.checkpoint.workspace.replacementOf, "/tmp/roadmap-active-writer");
});

test("healthy preflight recovers operational roadmap work before a new ready package", async () => {
  const worldRoot = await world("pyash-work-recovery-runner-");
  await blockedTask(worldRoot, {
    taskId: "roadmap-operational-first",
    priority: 90,
    blocker: "turn timeout",
    activeTurn: { state: "ambiguous", startedAt: "2026-08-10T00:00:00.000Z" }
  });
  await enqueueWorkTask(worldRoot, {
    taskId: "roadmap-new-candidate",
    owner: "background",
    kind: "roadmap",
    title: "new candidate",
    priority: 140,
    promptText: "Implement the new package.",
    acceptanceText: "Focused tests pass.",
    workSpec: { granularity: "substantial" }
  });
  const events = [];
  const result = await runWorkBackgroundOnce({
    worldRoot,
    owner: "background",
    policy: { enabled: true },
    capacitySource: async () => ({
      state: "available",
      weekly: {
        identified: true,
        state: "available",
        usedPercent: 10,
        remainingPercent: 90,
        windowStartAt: "2026-08-10T00:00:00.000Z",
        resetAt: "2026-08-17T00:00:00.000Z",
        windowMinutes: 10080
      }
    }),
    executionPreflight: async ({ selected }) => {
      assert.equal(selected.taskId, "roadmap-operational-first");
      return { ok: true, status: "ready", check: "fake preflight" };
    },
    supervisor: async ({ taskId }) => ({ claimed: true, taskId, status: "implementing" }),
    now: "2026-08-12T12:00:00.000Z",
    onEvent: async (event) => events.push(event)
  });
  assert.equal(result.admitted, true);
  assert.equal(result.selected, "roadmap-operational-first");
  assert.equal(result.recovery.task.checkpoint.recoveryCount, 1);
  assert.equal(events.some((event) => event.type === "recovered"), true);
  const stored = await listWorkTasks(worldRoot, { includeTerminal: true });
  assert.equal(stored.find((task) => task.taskId === "roadmap-operational-first").checkpoint.recoveryCount, 1);
});
