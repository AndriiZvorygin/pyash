import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { enqueueWorkTask } from "../../program/runtime/work/queue.mjs";
import { readWorkTaskStatus, writeWorkTaskStatus } from "../../program/runtime/work/status.mjs";
import {
  classifyTurnLiveness,
  reconcileWorkTaskTurn,
  TURN_LIVENESS
} from "../../program/runtime/work/turn_reconciliation.mjs";

async function world(prefix) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  const worldRoot = path.join(root, "world");
  await fs.mkdir(worldRoot, { recursive: true });
  return worldRoot;
}

function taskInput(taskId) {
  return {
    taskId,
    owner: "background",
    kind: "roadmap",
    title: taskId,
    priority: 100,
    queuedAt: "2026-09-01T00:00:00.000Z",
    promptText: "Complete the bounded roadmap package.",
    acceptanceText: "The focused tests pass."
  };
}

async function blockedTask(worldRoot, {
  taskId,
  blocker = "turn timeout",
  activeTurn,
  checkpoint = {}
} = {}) {
  await enqueueWorkTask(worldRoot, taskInput(taskId));
  const current = await readWorkTaskStatus(worldRoot, taskId);
  return writeWorkTaskStatus(worldRoot, {
    ...current,
    status: "blocked",
    message: blocker,
    error: blocker,
    checkpoint: {
      ...current.checkpoint,
      blocker,
      activeTurn,
      ...checkpoint
    }
  });
}

function fakeAppServer({
  threadId,
  state = "idle",
  turnState = "interrupted",
  turnId = "old-turn",
  updatedAt = "2026-09-01T00:00:00.000Z"
} = {}) {
  const requests = [];
  const thread = {
    id: threadId,
    status: { type: state },
    updatedAt,
    recencyAt: updatedAt,
    sessionId: `session-${threadId}`,
    turns: [{ id: turnId, status: turnState }]
  };
  return {
    requests,
    factory: async () => ({
      child: { pid: 999999 },
      request: async (method) => {
        requests.push(method);
        if (method === "thread/read" || method === "thread/resume") return { thread };
        throw new Error(`unexpected request: ${method}`);
      },
      close: async () => {}
    })
  };
}

function reconcileOptions(fake, now = "2026-09-11T12:00:00.000Z") {
  return {
    now: () => new Date(now),
    processProbe: () => false,
    appServerFactory: fake.factory
  };
}

test("turn liveness distinguishes live, stale, completed and ambiguous evidence", () => {
  assert.equal(classifyTurnLiveness({
    localOwnerAlive: true,
    remoteState: "idle",
    remoteTurn: { status: "interrupted" }
  }), TURN_LIVENESS.LIVE);
  assert.equal(classifyTurnLiveness({
    appServerAlive: true,
    remoteState: "idle",
    remoteTurn: { status: "interrupted" }
  }), TURN_LIVENESS.LIVE);
  assert.equal(classifyTurnLiveness({
    remoteState: "active",
    remoteTurn: { status: "inProgress" }
  }), TURN_LIVENESS.LIVE);
  assert.equal(classifyTurnLiveness({
    remoteState: "idle",
    remoteTurn: { id: "turn", status: "interrupted" },
    activeTurn: { turnId: "turn" }
  }), TURN_LIVENESS.STALE);
  assert.equal(classifyTurnLiveness({
    remoteState: "idle",
    remoteTurn: { id: "turn", status: "completed" },
    activeTurn: { turnId: "turn" }
  }), TURN_LIVENESS.COMPLETED_UNRECONCILED);
  assert.equal(classifyTurnLiveness({
    remoteState: "idle",
    remoteTurn: null,
    remoteUpdatedAt: "2026-09-11T11:45:00.000Z",
    now: "2026-09-11T12:00:00.000Z"
  }), TURN_LIVENESS.AMBIGUOUS);
});

test("stale Sol writer with a preserved commit becomes a read-only review continuation", async () => {
  const worldRoot = await world("pyash-turn-reconcile-hq-");
  const oldThreadId = "sol-stale-thread";
  const task = await blockedTask(worldRoot, {
    taskId: "hq-chief-briefing",
    blocker: "thread sol-stale-thread already has an active writer",
    activeTurn: {
      phase: "reviewing",
      role: "manager",
      threadId: oldThreadId,
      turnId: "sol-review-turn",
      requestIdentity: "review-hq-chief-briefing",
      state: "ambiguous",
      startedAt: "2026-09-02T15:14:08.890Z"
    },
    checkpoint: {
      manager: { threadId: oldThreadId },
      implementation: { commit: "2cc901b6" },
      recoveryCount: 2,
      resumeCount: 4
    }
  });
  const fake = fakeAppServer({ threadId: oldThreadId, turnId: "sol-review-turn" });
  const result = await reconcileWorkTaskTurn(worldRoot, task.taskId, reconcileOptions(fake));
  assert.equal(result.classification, TURN_LIVENESS.STALE);
  assert.equal(result.safeToResume, true);
  assert.equal(result.replacementThread, true);
  assert.equal(result.task.status, "reviewing");
  assert.equal(result.task.solThreadId, "");
  assert.equal(result.task.checkpoint.manager.threadId, "");
  assert.deepEqual(result.task.checkpoint.manager.previousThreadIds, [oldThreadId]);
  assert.equal(result.task.checkpoint.implementation.commit, "2cc901b6");
  assert.equal(result.task.checkpoint.recoveryCount, 2);
  assert.equal(result.task.checkpoint.resumeCount, 5);
  assert.equal(result.task.checkpoint.turnReconciliation.classification, "STALE");
  assert.equal(result.task.checkpoint.turnReconciliation.safeToResume, true);
  assert.equal(result.task.checkpoint.turnReconciliation.lastActivityAt, "2026-09-01T00:00:00.000Z");
  assert.equal(result.task.checkpoint.turnReconciliation.remoteSessionId, `session-${oldThreadId}`);
  assert.equal(result.task.checkpoint.turnHistory.at(-1).state, "abandoned");
  assert.deepEqual(fake.requests, ["thread/read", "thread/resume"]);
  const persisted = await readWorkTaskStatus(worldRoot, task.taskId);
  assert.equal(persisted.checkpoint.turnReconciliation.classification, "STALE");
  assert.equal(persisted.checkpoint.turnReconciliation.safeToResume, true);
});

test("stale routine reviewer preserves its history and permits a fresh review thread", async () => {
  const worldRoot = await world("pyash-turn-reconcile-reviewer-");
  const oldThreadId = "luna-reviewer-stale-thread";
  const task = await blockedTask(worldRoot, {
    taskId: "stale-reviewer-task",
    blocker: "thread luna-reviewer-stale-thread already has an active writer",
    activeTurn: {
      phase: "reviewing",
      role: "reviewer",
      threadId: oldThreadId,
      turnId: "review-turn",
      requestIdentity: "review-stale-reviewer-task",
      state: "ambiguous",
      startedAt: "2026-09-02T15:14:08.890Z"
    },
    checkpoint: {
      reviewer: { role: "reviewer", model: "gpt-5.6-luna", threadId: oldThreadId },
      implementation: { commit: "preserved-implementation" },
      recoveryCount: 3,
      convergence: { reviewCount: 2 }
    }
  });
  const fake = fakeAppServer({ threadId: oldThreadId, turnId: "review-turn" });
  const result = await reconcileWorkTaskTurn(worldRoot, task.taskId, reconcileOptions(fake));
  assert.equal(result.classification, TURN_LIVENESS.STALE);
  assert.equal(result.safeToResume, true);
  assert.equal(result.task.status, "reviewing");
  assert.equal(result.task.checkpoint.turnReconciliation.role, "reviewer");
  assert.equal(result.task.checkpoint.reviewer.threadId, "");
  assert.deepEqual(result.task.checkpoint.reviewer.previousThreadIds, [oldThreadId]);
  assert.equal(result.task.checkpoint.manager.threadId, "");
  assert.equal(result.task.checkpoint.worker.threadId, "");
  assert.equal(result.task.checkpoint.recoveryCount, 3);
  assert.equal(result.task.checkpoint.convergence.reviewCount, 2);
  assert.equal(result.task.checkpoint.turnHistory.at(-1).threadId, oldThreadId);
  assert.equal(result.task.checkpoint.turnHistory.at(-1).state, "abandoned");
});

test("stale Luna ownership preserves an uncommitted worktree diff for continuation", async () => {
  const worldRoot = await world("pyash-turn-reconcile-library-");
  const task = await blockedTask(worldRoot, {
    taskId: "roadmap-library-refinement-cache",
    blocker: "turn timeout (hard)",
    activeTurn: {
      phase: "implementing",
      role: "worker",
      threadId: "luna-stale-thread",
      turnId: "luna-hard-turn",
      requestIdentity: "implementation-library-refinement-cache",
      state: "ambiguous",
      startedAt: "2026-09-09T17:14:24.565Z",
      lastActivityAt: "2026-09-09T17:29:03.468Z"
    },
    checkpoint: {
      worker: { threadId: "luna-stale-thread" },
      workspace: { worktreePath: "/tmp/library-refinement-cache" },
      interruption: {
        workspaceEvidence: { changedFiles: ["program/library/refinement_cache.mjs"], diff: "+cache" }
      },
      recoveryCount: 2
    }
  });
  const fake = fakeAppServer({ threadId: "luna-stale-thread", turnId: "luna-hard-turn" });
  const result = await reconcileWorkTaskTurn(worldRoot, task.taskId, {
    ...reconcileOptions(fake),
    evidenceFactory: async () => ({
      revision: "base-revision",
      changedFiles: ["program/library/refinement_cache.mjs"],
      diff: "+cache",
      status: " M program/library/refinement_cache.mjs"
    })
  });
  assert.equal(result.classification, TURN_LIVENESS.STALE);
  assert.equal(result.safeToResume, true);
  assert.equal(result.task.status, "implementing");
  assert.equal(result.task.lunaThreadId, "");
  assert.deepEqual(result.task.checkpoint.worker.previousThreadIds, ["luna-stale-thread"]);
  assert.deepEqual(result.task.checkpoint.interruption.workspaceEvidence.changedFiles, ["program/library/refinement_cache.mjs"]);
  assert.equal(result.task.checkpoint.recoveryCount, 2);
  assert.equal(result.task.checkpoint.turnReconciliation.safeToResume, true);
});

test("stale evidence-free mind turn remains blocked without replay permission", async () => {
  const worldRoot = await world("pyash-turn-reconcile-mind-");
  const task = await blockedTask(worldRoot, {
    taskId: "roadmap-mind-reply-envelope-streaming-follow-up-5",
    activeTurn: {
      phase: "implementing",
      role: "worker",
      threadId: "mind-stale-thread",
      turnId: "mind-old-turn",
      requestIdentity: "implementation-mind-streaming-follow-up-5",
      state: "ambiguous",
      startedAt: "2026-08-23T01:17:06.678Z"
    },
    checkpoint: {
      worker: { threadId: "mind-stale-thread" },
      recoveryCount: 2
    }
  });
  const fake = fakeAppServer({ threadId: "mind-stale-thread", turnId: "mind-old-turn" });
  const result = await reconcileWorkTaskTurn(worldRoot, task.taskId, reconcileOptions(fake));
  assert.equal(result.classification, TURN_LIVENESS.STALE);
  assert.equal(result.safeToResume, false);
  assert.equal(result.task.status, "blocked");
  assert.equal(result.task.checkpoint.worker.threadId, "mind-stale-thread");
  assert.equal(result.task.checkpoint.recoveryCount, 2);
  assert.equal(result.task.checkpoint.turnReconciliation.safeToResume, false);
  assert.match(result.task.checkpoint.lastAction, /evidence is insufficient/iu);
});

test("a live writer remains protected and consumes no recovery or convergence state", async () => {
  const worldRoot = await world("pyash-turn-reconcile-live-");
  const task = await blockedTask(worldRoot, {
    taskId: "live-writer-task",
    blocker: "thread live-thread already has an active writer",
    activeTurn: {
      phase: "reviewing",
      role: "manager",
      threadId: "live-thread",
      turnId: "live-turn",
      requestIdentity: "review-live-writer-task",
      state: "started",
      startedAt: "2026-09-11T11:59:00.000Z",
      lastActivityAt: "2026-09-11T11:59:45.000Z"
    },
    checkpoint: {
      manager: { threadId: "live-thread" },
      implementation: { commit: "preserved-commit" },
      recoveryCount: 2,
      convergence: { reviewCount: 3 }
    }
  });
  const fake = fakeAppServer({
    threadId: "live-thread",
    state: "active",
    turnState: "inProgress",
    turnId: "live-turn",
    updatedAt: "2026-09-11T11:59:50.000Z"
  });
  const result = await reconcileWorkTaskTurn(worldRoot, task.taskId, reconcileOptions(fake));
  assert.equal(result.classification, TURN_LIVENESS.LIVE);
  assert.equal(result.safeToResume, false);
  assert.equal(result.task.status, "blocked");
  assert.equal(result.task.checkpoint.manager.threadId, "live-thread");
  assert.equal(result.task.checkpoint.recoveryCount, 2);
  assert.equal(result.task.checkpoint.convergence.reviewCount, 3);
});

test("completed local result is reconciled without creating a replacement turn", async () => {
  const worldRoot = await world("pyash-turn-reconcile-complete-");
  const task = await blockedTask(worldRoot, {
    taskId: "completed-unreconciled-task",
    activeTurn: {
      phase: "reviewing",
      role: "manager",
      threadId: "completed-thread",
      turnId: "completed-turn",
      requestIdentity: "review-completed-task",
      state: "completed",
      resultCaptured: false,
      startedAt: "2026-09-10T00:00:00.000Z",
      result: { text: "ACCEPT", status: "completed" }
    },
    checkpoint: {
      manager: { threadId: "completed-thread" },
      implementation: { commit: "preserved-commit" }
    }
  });
  const fake = fakeAppServer({ threadId: "completed-thread", turnId: "completed-turn", turnState: "completed" });
  const result = await reconcileWorkTaskTurn(worldRoot, task.taskId, reconcileOptions(fake));
  assert.equal(result.classification, TURN_LIVENESS.COMPLETED_UNRECONCILED);
  assert.equal(result.task.status, "reviewing");
  assert.equal(result.task.checkpoint.activeTurn.state, "completed");
  assert.equal(result.task.checkpoint.recoveryCount, 0);
  assert.equal(fake.requests.includes("turn/start"), false);
});
