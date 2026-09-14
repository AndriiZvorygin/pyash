import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { enqueueWorkTask } from "../../program/runtime/work/queue.mjs";
import { runWorkBackgroundOnce } from "../../program/runtime/work/runner.mjs";
import {
  findRecoverableOperationalWorkTasks,
  findPolicyRevalidationWorkTasks,
  isEligibleForTimeoutPolicyRevalidation,
  isRecoverableOperationalWorkTask,
  recoverOperationalWorkTask,
  revalidateTimeoutExhaustedWorkTask
} from "../../program/runtime/work/recovery.mjs";
import { isHumanDecisionBlock, isRetryableWorkBlock } from "../../program/runtime/work/roadmap.mjs";
import { listWorkTasks } from "../../program/runtime/work/operator.mjs";
import { readWorkTaskStatus, writeWorkTaskStatus } from "../../program/runtime/work/status.mjs";
import {
  currentTimeoutPolicy,
  LEGACY_TIMEOUT_POLICY,
  TIMEOUT_POLICY_MIGRATION_ID
} from "../../program/runtime/work/timeout_policy.mjs";

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

test("technical blockers are recoverable while semantic decisions are not", async () => {
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
  }, { now }), true);
  assert.equal(isRecoverableOperationalWorkTask({
    ...task,
    checkpoint: { blocker: "revision limit reached: Sol requested another pass", activeTurn: {} }
  }, { now }), true);
  assert.equal(isRetryableWorkBlock({
    ...task,
    checkpoint: { blocker: "revision limit reached: Sol requested another pass", activeTurn: {} }
  }), true);
  assert.equal(isHumanDecisionBlock({
    ...task,
    checkpoint: { blocker: "Sol review BLOCK: human decision required", activeTurn: {} }
  }), true);
  assert.equal(isHumanDecisionBlock({
    ...task,
    checkpoint: { blocker: "compiler bug: generated guard truncates body", activeTurn: {} }
  }), false);
  assert.equal(isRecoverableOperationalWorkTask({
    ...task,
    checkpoint: { blocker: "turn timeout", activeTurn: { state: "ambiguous", startedAt: "2026-08-12T11:45:00.000Z" } }
  }, { now }), false);
});

test("concrete Sol correction resumes in revision phase and preserves the review thread", async () => {
  const worldRoot = await world("pyash-work-recovery-revision-");
  await blockedTask(worldRoot, {
    taskId: "roadmap-concrete-correction",
    blocker: "revision limit reached: Sol requested another pass",
    activeTurn: {}
  });
  const current = await readWorkTaskStatus(worldRoot, "roadmap-concrete-correction");
  await writeWorkTaskStatus(worldRoot, {
    ...current,
    checkpoint: {
      ...current.checkpoint,
      worker: { ...current.checkpoint.worker, threadId: "luna-existing" },
      review: {
        decision: "REVISE",
        revisionInstructions: "Remove the false event and rerun the focused tests."
      }
    }
  });
  const recovered = await recoverOperationalWorkTask(worldRoot, "roadmap-concrete-correction", {
    now: "2026-08-12T12:00:00.000Z"
  });
  assert.equal(recovered.task.status, "revision");
  assert.equal(recovered.task.checkpoint.worker.threadId, "luna-existing");
  assert.equal(recovered.task.checkpoint.review.revisionInstructions, "Remove the false event and rerun the focused tests.");
  assert.equal(recovered.task.checkpoint.continuationCount, 1);
});

test("a focused Sol BLOCK for an unavailable required backend is not replayed as Luna work", async () => {
  const worldRoot = await world("pyash-work-recovery-convergence-block-");
  await blockedTask(worldRoot, {
    taskId: "roadmap-convergence-block",
    blocker: "required Ollama service unavailable",
    activeTurn: {}
  });
  const current = await readWorkTaskStatus(worldRoot, "roadmap-convergence-block");
  await writeWorkTaskStatus(worldRoot, {
    ...current,
    checkpoint: {
      ...current.checkpoint,
      review: { decision: "REVISE", revisionInstructions: "run the required live backend evidence" },
      convergence: {
        status: "blocked",
        decision: "BLOCK",
        rationale: "required live backend is unavailable",
        reviewedAt: "2026-08-12T12:00:00.000Z"
      }
    }
  });
  assert.equal(isRecoverableOperationalWorkTask(await readWorkTaskStatus(worldRoot, "roadmap-convergence-block"), {
    now: "2026-08-12T13:00:00.000Z"
  }), false);
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

test("known timed-out turns remain ambiguous and preserve workspace evidence", async () => {
  const worldRoot = await world("pyash-work-recovery-evidence-");
  await blockedTask(worldRoot, {
    taskId: "roadmap-timeout-evidence",
    blocker: "turn timeout (hard)",
    activeTurn: {
      phase: "implementation",
      role: "worker",
      threadId: "luna-thread",
      turnId: "luna-turn",
      requestIdentity: "timeout-evidence-request",
      state: "ambiguous",
      startedAt: "2026-08-10T00:00:00.000Z",
      timeoutType: "hard",
      lastActivityAt: "2026-08-10T00:14:00.000Z",
      meaningfulActivityCount: 4
    }
  });
  const current = await readWorkTaskStatus(worldRoot, "roadmap-timeout-evidence");
  await writeWorkTaskStatus(worldRoot, {
    ...current,
    checkpoint: {
      ...current.checkpoint,
      workspace: { ...current.checkpoint.workspace, worktreePath: "/tmp/timeout-evidence" },
      interruption: {
        ...current.checkpoint.interruption,
        workspaceEvidence: {
          capturedAt: "2026-08-10T00:15:00.000Z",
          revision: "luna-commit",
          changedFiles: ["hello.txt"],
          diff: "+hello"
        }
      }
    }
  });
  const recovered = await recoverOperationalWorkTask(worldRoot, "roadmap-timeout-evidence", {
    now: "2026-08-10T01:00:00.000Z"
  });
  assert.equal(recovered, null);
  const unchanged = await readWorkTaskStatus(worldRoot, "roadmap-timeout-evidence");
  assert.equal(unchanged.checkpoint.activeTurn.state, "ambiguous");
  assert.equal(unchanged.checkpoint.activeTurn.turnId, "luna-turn");
  assert.equal(unchanged.checkpoint.interruption.workspaceEvidence.revision, "luna-commit");
  assert.deepEqual(unchanged.checkpoint.interruption.workspaceEvidence.changedFiles, ["hello.txt"]);
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

test("a concrete revision outranks a higher-priority timeout and a new candidate", async () => {
  const worldRoot = await world("pyash-work-recovery-correction-priority-");
  await blockedTask(worldRoot, {
    taskId: "roadmap-timeout-higher-priority",
    priority: 130,
    blocker: "turn timeout",
    activeTurn: { state: "ambiguous", startedAt: "2026-08-10T00:00:00.000Z" }
  });
  await blockedTask(worldRoot, {
    taskId: "roadmap-concrete-correction-priority",
    priority: 90,
    blocker: "revision limit reached: concrete correction remains",
    activeTurn: {}
  });
  const correction = await readWorkTaskStatus(worldRoot, "roadmap-concrete-correction-priority");
  await writeWorkTaskStatus(worldRoot, {
    ...correction,
    checkpoint: {
      ...correction.checkpoint,
      review: { decision: "REVISE", revisionInstructions: "Remove the false event." }
    }
  });
  await enqueueWorkTask(worldRoot, {
    taskId: "roadmap-new-candidate-after-correction",
    owner: "background",
    kind: "roadmap",
    title: "new candidate",
    priority: 150,
    promptText: "Implement the new package.",
    acceptanceText: "Focused tests pass.",
    workSpec: { granularity: "substantial" }
  });
  const result = await runWorkBackgroundOnce({
    worldRoot,
    owner: "background",
    policy: { enabled: true },
    capacitySource: async () => ({
      state: "available",
      weekly: { identified: true, usedPercent: 10, remainingPercent: 90, windowStartAt: "2026-08-10T00:00:00.000Z", resetAt: "2026-08-17T00:00:00.000Z", windowMinutes: 10080 }
    }),
    executionPreflight: async ({ selected }) => {
      assert.equal(selected.taskId, "roadmap-concrete-correction-priority");
      return { ok: true, status: "ready", check: "fake preflight" };
    },
    supervisor: async ({ taskId }) => ({ claimed: true, taskId, status: "revision" }),
    now: "2026-08-12T12:00:00.000Z"
  });
  assert.equal(result.admitted, true);
  assert.equal(result.selected, "roadmap-concrete-correction-priority");
  assert.equal(result.recovery.task.status, "revision");
});

test("integration conflicts enter a durable reconciliation phase", async () => {
  const worldRoot = await world("pyash-work-recovery-integration-");
  await blockedTask(worldRoot, {
    taskId: "roadmap-integration-reconciliation",
    priority: 100,
    blocker: "automation branch integration blocked: merge conflict",
    activeTurn: {}
  });
  const recovered = await recoverOperationalWorkTask(worldRoot, "roadmap-integration-reconciliation", {
    now: "2026-08-12T12:00:00.000Z"
  });
  assert.equal(recovered.task.status, "revision");
  assert.equal(recovered.task.checkpoint.integration.status, "reconciliation");
  assert.match(recovered.task.checkpoint.lastAction, /integration reconciliation/iu);
});

test("an ordinary integration conflict becomes retryable reconciliation work", async () => {
  const worldRoot = await world("pyash-work-recovery-integration-blocked-");
  await blockedTask(worldRoot, {
    taskId: "roadmap-integration-reconciliation-blocked",
    blocker: "automation branch integration blocked: merge conflict",
    activeTurn: {}
  });
  const current = await readWorkTaskStatus(worldRoot, "roadmap-integration-reconciliation-blocked");
  await writeWorkTaskStatus(worldRoot, {
    ...current,
    checkpoint: { ...current.checkpoint, integration: { status: "blocked" } }
  });
  const recovered = await recoverOperationalWorkTask(worldRoot, "roadmap-integration-reconciliation-blocked", {
    now: "2026-08-12T12:00:00.000Z"
  });
  assert.equal(recovered.task.checkpoint.integration.status, "reconciliation");
});

test("an exhausted legacy timeout receives exactly one policy revalidation", async () => {
  const worldRoot = await world("pyash-work-policy-revalidation-");
  await blockedTask(worldRoot, {
    taskId: "roadmap-legacy-timeout-revalidation",
    blocker: "turn timeout",
    activeTurn: {
      phase: "implementation",
      role: "worker",
      threadId: "luna-thread",
      requestIdentity: "legacy-timeout-request",
      state: "ambiguous",
      startedAt: "2026-08-10T00:00:00.000Z"
    }
  });
  const current = await readWorkTaskStatus(worldRoot, "roadmap-legacy-timeout-revalidation");
  await writeWorkTaskStatus(worldRoot, {
    ...current,
    checkpoint: {
      ...current.checkpoint,
      recoveryCount: 2,
      worker: { ...current.checkpoint.worker, threadId: "luna-thread" },
      workspace: { ...current.checkpoint.workspace, worktreePath: "/tmp/legacy-timeout-revalidation" },
      interruption: {
        ...current.checkpoint.interruption,
        workspaceEvidence: { revision: "preserved-commit", changedFiles: ["src/example.mjs"] }
      }
    }
  });
  const policy = currentTimeoutPolicy({
    fallbackTimeoutMs: 900000,
    inactivityTimeoutMs: 900000,
    hardTimeoutMs: 1800000
  });
  const candidate = await readWorkTaskStatus(worldRoot, "roadmap-legacy-timeout-revalidation");
  assert.equal(candidate.checkpoint.timeoutPolicy.policyVersion, "");
  assert.equal(isEligibleForTimeoutPolicyRevalidation(candidate, {
    currentPolicy: policy,
    now: "2026-08-12T12:00:00.000Z"
  }), true);
  assert.equal(await revalidateTimeoutExhaustedWorkTask(worldRoot, candidate.taskId, {
    currentPolicy: policy,
    preflightPassed: false,
    now: "2026-08-12T12:00:00.000Z"
  }), null);
  const revalidated = await revalidateTimeoutExhaustedWorkTask(worldRoot, candidate.taskId, {
    currentPolicy: policy,
    preflightPassed: true,
    resumePhase: "reviewing",
    now: "2026-08-12T12:00:00.000Z"
  });
  assert.equal(revalidated.task.status, "reviewing");
  assert.equal(revalidated.task.checkpoint.recoveryCount, 2);
  assert.equal(revalidated.task.checkpoint.policyRevalidation.migrationId, TIMEOUT_POLICY_MIGRATION_ID);
  assert.equal(revalidated.task.checkpoint.policyRevalidation.attempts, 1);
  assert.equal(revalidated.task.checkpoint.policyRevalidation.fromPolicy.hardTimeoutMs, 900000);
  assert.equal(revalidated.task.checkpoint.policyRevalidation.toPolicy.hardTimeoutMs, 1800000);
  assert.equal(revalidated.task.checkpoint.activeTurn.state, "");
  assert.equal(revalidated.task.checkpoint.turnHistory.at(-1).state, "abandoned");
  assert.equal(revalidated.task.checkpoint.worker.threadId, "luna-thread");
  assert.equal(await revalidateTimeoutExhaustedWorkTask(worldRoot, candidate.taskId, {
    currentPolicy: policy,
    preflightPassed: true,
    now: "2026-08-12T13:00:00.000Z"
  }), null);
});

test("policy revalidation excludes current-policy, external, human, ambiguous, and evidence-free tasks", async () => {
  const currentPolicy = currentTimeoutPolicy({ inactivityTimeoutMs: 900000, hardTimeoutMs: 1800000 });
  const base = {
    taskId: "roadmap-policy-check",
    status: "blocked",
    kind: "roadmap",
    workSpec: { granularity: "substantial" },
    checkpoint: {
      blocker: "turn timeout",
      workspace: { worktreePath: "/tmp/policy-check" },
      interruption: { workspaceEvidence: { changedFiles: ["src/example.mjs"] } },
      activeTurn: { state: "ambiguous", startedAt: "2026-08-10T00:00:00.000Z" },
      recoveryCount: 2
    }
  };
  assert.equal(isEligibleForTimeoutPolicyRevalidation({
    ...base,
    checkpoint: { ...base.checkpoint, timeoutPolicy: currentPolicy }
  }, { currentPolicy }), false);
  assert.equal(isEligibleForTimeoutPolicyRevalidation({
    ...base,
    checkpoint: { ...base.checkpoint, blocker: "fixture-free Ollama evidence unavailable" }
  }, { currentPolicy }), false);
  assert.equal(isEligibleForTimeoutPolicyRevalidation({
    ...base,
    checkpoint: { ...base.checkpoint, blocker: "Sol review BLOCK: human decision required" }
  }, { currentPolicy }), false);
  assert.equal(isEligibleForTimeoutPolicyRevalidation({
    ...base,
    checkpoint: {
      ...base.checkpoint,
      activeTurn: { ...base.checkpoint.activeTurn, turnId: "remote-turn" }
    }
  }, { currentPolicy }), false);
  assert.equal(isEligibleForTimeoutPolicyRevalidation({
    ...base,
    checkpoint: {
      ...base.checkpoint,
      interruption: { workspaceEvidence: {} }
    }
  }, { currentPolicy }), false);
  assert.equal(LEGACY_TIMEOUT_POLICY.activityAware, false);
});

test("policy revalidation candidates retain priority and survive status serialization", async () => {
  const worldRoot = await world("pyash-work-policy-revalidation-list-");
  for (const [taskId, priority] of [["roadmap-policy-low", 60], ["roadmap-policy-high", 80]]) {
    await blockedTask(worldRoot, {
      taskId,
      priority,
      activeTurn: { phase: "implementation", state: "ambiguous", startedAt: "2026-08-10T00:00:00.000Z" }
    });
    const current = await readWorkTaskStatus(worldRoot, taskId);
    await writeWorkTaskStatus(worldRoot, {
      ...current,
      checkpoint: {
        ...current.checkpoint,
        recoveryCount: 2,
        workspace: { ...current.checkpoint.workspace, worktreePath: `/tmp/${taskId}` },
        interruption: { workspaceEvidence: { changedFiles: ["src/example.mjs"] } }
      }
    });
  }
  const candidates = await findPolicyRevalidationWorkTasks(worldRoot, {
    currentPolicy: currentTimeoutPolicy({ inactivityTimeoutMs: 900000, hardTimeoutMs: 1800000 }),
    now: "2026-08-12T12:00:00.000Z"
  });
  assert.deepEqual(candidates.map((task) => task.taskId), ["roadmap-policy-high", "roadmap-policy-low"]);
  const first = await revalidateTimeoutExhaustedWorkTask(worldRoot, "roadmap-policy-high", {
    currentPolicy: currentTimeoutPolicy({ inactivityTimeoutMs: 900000, hardTimeoutMs: 1800000 }),
    preflightPassed: true,
    now: "2026-08-12T12:00:00.000Z"
  });
  const stored = await readWorkTaskStatus(worldRoot, first.task.taskId);
  assert.equal(stored.checkpoint.policyRevalidation.attempts, 1);
  assert.equal(stored.checkpoint.policyRevalidation.toPolicy.activityAware, true);
  assert.equal(stored.checkpoint.recoveryCount, 2);
});
