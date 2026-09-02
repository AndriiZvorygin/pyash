import { buildWorkTask, transitionWorkTask } from "./contract.mjs";
import {
  enqueueWorkTask,
  findWorkTaskEnvelope,
  updateWorkTaskEnvelope
} from "./queue.mjs";
import { mergeWorkCheckpoint } from "./checkpoint.mjs";
import { listWorkTasks } from "./operator.mjs";
import {
  isAwaitingExternalEvidence,
  isHumanDecisionBlock,
  isRetryableWorkBlock
} from "./roadmap.mjs";
import { readWorkTaskStatus } from "./status.mjs";
import {
  currentTimeoutPolicy,
  inferTimeoutPolicy,
  isMateriallyDifferentTimeoutPolicy,
  TIMEOUT_POLICY_MIGRATION_ID
} from "./timeout_policy.mjs";

export const DEFAULT_STALE_OPERATIONAL_TURN_MS = 30 * 60 * 1000;
export const DEFAULT_MAX_OPERATIONAL_RECOVERIES = 2;

function text(value) {
  return String(value ?? "").trim();
}

function nowDate(now) {
  const value = typeof now === "function" ? now() : now || new Date();
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : new Date();
}

function isSubstantialRoadmapTask(task) {
  return task?.kind === "roadmap"
    && (task.workSpec?.granularity === "substantial" || task.taskId.startsWith("roadmap-"));
}

function hasConcreteRevision(task) {
  if (task?.checkpoint?.convergence?.status === "blocked"
    && task?.checkpoint?.convergence?.decision === "BLOCK") return false;
  return Boolean(String(task?.checkpoint?.review?.revisionInstructions || "").trim());
}

function hasIntegrationConflict(task) {
  const reason = `${text(task?.checkpoint?.blocker)} ${text(task?.message)} ${text(task?.error)}`;
  return /integration|cherry-pick|rebase|merge conflict/iu.test(reason);
}

function isTurnTimeout(task) {
  return /turn timeout/iu.test(`${text(task?.checkpoint?.blocker)} ${text(task?.message)} ${text(task?.error)} ${text(task?.checkpoint?.interruption?.reason)}`);
}

function hasPreservedEvidence(task) {
  const checkpoint = task?.checkpoint || {};
  const evidence = checkpoint.interruption?.workspaceEvidence || {};
  const implementation = checkpoint.implementation || {};
  return Boolean(
    text(implementation.commit)
    || implementation.changedFiles?.length
    || text(implementation.diff)
    || implementation.tests?.length
    || evidence.changedFiles?.length
    || text(evidence.diff)
  );
}

function activeTurnAge(task, now) {
  const active = task?.checkpoint?.activeTurn || {};
  const source = active.startedAt || task?.checkpoint?.interruption?.at || "";
  const started = Date.parse(source);
  return Number.isFinite(started) ? Math.max(0, now.getTime() - started) : null;
}

function hasRecentOrLiveAmbiguousTurn(task, now, staleTurnMs) {
  const active = task?.checkpoint?.activeTurn || {};
  if (!active.state) return false;
  if (active.state === "ambiguous") {
    if (active.turnId) return true;
    const age = activeTurnAge(task, now);
    const operational = /turn timeout|sandbox|app server|process exit|execution environment/iu.test(
      `${text(active.ambiguity)} ${text(task.checkpoint?.blocker)}`
    );
    const activeWriter = /active writer|thread .* writer/iu.test(
      `${text(active.ambiguity)} ${text(task.checkpoint?.blocker)}`
    );
    if (activeWriter && (Number(task.checkpoint?.recoveryCount) || 0) > 0) return false;
    return !(operational && age != null && age >= staleTurnMs);
  }
  return active.state === "started"
    || active.state === "awaiting-completion"
    || (active.state === "completed" && active.resultCaptured !== true);
}

export function isRecoverableOperationalWorkTask(task, {
  now = new Date(),
  staleTurnMs = DEFAULT_STALE_OPERATIONAL_TURN_MS,
  maxRecoveryCount = DEFAULT_MAX_OPERATIONAL_RECOVERIES
} = {}) {
  if (!isSubstantialRoadmapTask(task)) return false;
  if (!task || !["blocked", "failed"].includes(task.status)) return false;
  if (!isRetryableWorkBlock(task)) return false;
  if (/sol review block|human decision/iu.test(
    `${text(task.checkpoint?.blocker)} ${text(task.message)} ${text(task.error)}`
  )) return false;
  const integration = hasIntegrationConflict(task);
  if (task.checkpoint?.integration?.status === "integration-blocked") return false;
  if (!hasConcreteRevision(task) && !integration && (Number(task.checkpoint?.recoveryCount) || 0) >= maxRecoveryCount) return false;
  return !hasRecentOrLiveAmbiguousTurn(task, nowDate(now), Math.max(1, Number(staleTurnMs) || DEFAULT_STALE_OPERATIONAL_TURN_MS));
}

export function isEligibleForTimeoutPolicyRevalidation(task, {
  now = new Date(),
  staleTurnMs = DEFAULT_STALE_OPERATIONAL_TURN_MS,
  maxRecoveryCount = DEFAULT_MAX_OPERATIONAL_RECOVERIES,
  currentPolicy = currentTimeoutPolicy(),
  migrationId = TIMEOUT_POLICY_MIGRATION_ID
} = {}) {
  if (!isSubstantialRoadmapTask(task)) return false;
  if (!task || !["blocked", "failed"].includes(task.status)) return false;
  if (!isTurnTimeout(task) || !isRetryableWorkBlock(task)) return false;
  if (isAwaitingExternalEvidence(task) || isHumanDecisionBlock(task)) return false;
  if (hasIntegrationConflict(task) || task.checkpoint?.integration?.status === "integration-blocked") return false;
  if (task.checkpoint?.convergence?.decision === "BLOCK"
    || task.checkpoint?.convergence?.status === "blocked"
    || Number(task.checkpoint?.implementation?.consecutiveNoProgressPasses || 0) >= 2) return false;
  if ((Number(task.checkpoint?.recoveryCount) || 0) < maxRecoveryCount) return false;
  const fromPolicy = inferTimeoutPolicy(task.checkpoint);
  if (!fromPolicy || !isMateriallyDifferentTimeoutPolicy(fromPolicy, currentPolicy)) return false;
  const migration = task.checkpoint?.policyRevalidation || {};
  if (migration.migrationId === migrationId && (Number(migration.attempts) || 0) >= 1) return false;
  if (migration.migrationId && migration.migrationId !== migrationId) return false;
  if (!text(task.checkpoint?.workspace?.worktreePath) || !hasPreservedEvidence(task)) return false;
  if (task.checkpoint?.activeTurn?.turnId) return false;
  if (hasRecentOrLiveAmbiguousTurn(task, nowDate(now), Math.max(1, Number(staleTurnMs) || DEFAULT_STALE_OPERATIONAL_TURN_MS))) return false;
  return true;
}

function revalidationRecord(task, date, currentPolicy, migrationId) {
  return {
    migrationId,
    reason: "timeout policy upgraded from fixed wall-clock to activity-aware execution",
    fromPolicy: inferTimeoutPolicy(task.checkpoint),
    toPolicy: currentPolicy,
    grantedAt: date.toISOString(),
    attempts: 1,
    lastAttemptAt: date.toISOString(),
    outcome: "granted",
    blocker: text(task.checkpoint?.blocker || task.message || task.error)
  };
}

export async function revalidateTimeoutExhaustedWorkTask(worldRoot, taskId, {
  now = new Date(),
  staleTurnMs = DEFAULT_STALE_OPERATIONAL_TURN_MS,
  maxRecoveryCount = DEFAULT_MAX_OPERATIONAL_RECOVERIES,
  currentPolicy = currentTimeoutPolicy(),
  migrationId = TIMEOUT_POLICY_MIGRATION_ID,
  preflightPassed = false,
  resumePhase = "ready"
} = {}) {
  if (preflightPassed !== true) return null;
  const current = await readWorkTaskStatus(worldRoot, taskId);
  if (!isEligibleForTimeoutPolicyRevalidation(current, {
    now,
    staleTurnMs,
    maxRecoveryCount,
    currentPolicy,
    migrationId
  })) return null;
  const date = nowDate(now);
  const phase = text(resumePhase) || "ready";
  const abandonedTurn = current.checkpoint.activeTurn?.state
    ? {
      ...current.checkpoint.activeTurn,
      state: "abandoned",
      ambiguity: current.checkpoint.activeTurn.ambiguity || "old timeout turn superseded by timeout policy migration"
    }
    : null;
  const turnHistory = abandonedTurn
    && !current.checkpoint.turnHistory.some((entry) => (
      entry.requestIdentity
      && entry.requestIdentity === abandonedTurn.requestIdentity
      && entry.state === "abandoned"
    ))
    ? [...current.checkpoint.turnHistory, abandonedTurn]
    : current.checkpoint.turnHistory;
  const transitioned = transitionWorkTask(current, phase, {
    now: date,
    message: "revalidated once after timeout policy upgrade",
    error: ""
  });
  const next = buildWorkTask({
    ...transitioned,
    message: "revalidated once after timeout policy upgrade",
    error: "",
    checkpoint: mergeWorkCheckpoint(transitioned.checkpoint, {
      activeTurn: {},
      blocker: "",
      timeoutPolicy: currentPolicy,
      policyRevalidation: revalidationRecord(current, date, currentPolicy, migrationId),
      resumeCount: (current.checkpoint.resumeCount || 0) + 1,
      interruption: {
        phase,
        at: date.toISOString(),
        reason: "one bounded revalidation granted because the previous timeout policy was superseded",
        lastTurnId: current.checkpoint.activeTurn?.turnId || current.checkpoint.interruption?.lastTurnId || "",
        workspaceEvidence: current.checkpoint.interruption?.workspaceEvidence || {}
      },
      turnHistory,
      lastAction: `policy revalidation granted; resuming ${phase}`
    })
  });
  const envelope = await findWorkTaskEnvelope(worldRoot, taskId, { owner: current.owner });
  if (envelope) await updateWorkTaskEnvelope(worldRoot, envelope, next);
  else await enqueueWorkTask(worldRoot, next);
  return {
    task: next,
    fromPolicy: inferTimeoutPolicy(current.checkpoint),
    toPolicy: currentPolicy,
    migrationId,
    phase,
    recoveryCount: next.checkpoint.recoveryCount
  };
}

function recoveryRecord(task, now, reason) {
  const active = task.checkpoint?.activeTurn || {};
  return {
    at: now.toISOString(),
    previousBlocker: text(task.checkpoint?.blocker || task.message || task.error),
    reason,
    previousPhase: text(task.checkpoint?.interruption?.phase || active.phase),
    previousTurnId: text(active.turnId || task.checkpoint?.interruption?.lastTurnId),
    staleTurn: active.state === "ambiguous"
  };
}

export async function recoverOperationalWorkTask(worldRoot, taskId, {
  now = new Date(),
  staleTurnMs = DEFAULT_STALE_OPERATIONAL_TURN_MS,
  maxRecoveryCount = DEFAULT_MAX_OPERATIONAL_RECOVERIES
} = {}) {
  const current = await readWorkTaskStatus(worldRoot, taskId);
  if (!isRecoverableOperationalWorkTask(current, { now, staleTurnMs, maxRecoveryCount })) return null;
  const date = nowDate(now);
  const reason = "recovered because execution preflight passed after an operational blocker";
  const record = recoveryRecord(current, date, reason);
  const previousBlocker = record.previousBlocker;
  const replacement = /active writer|thread .* writer/iu.test(previousBlocker)
    && (Number(current.checkpoint?.recoveryCount) || 0) > 0;
  const oldWorktree = current.checkpoint?.workspace?.worktreePath || "";
  const replacementPath = replacement
    ? `${oldWorktree}-replacement-${(Number(current.checkpoint?.recoveryCount) || 0)}`
    : "";
  const previousThreadId = current.checkpoint?.worker?.threadId || "";
  const abandonedTurn = current.checkpoint?.activeTurn?.state
    ? {
      ...current.checkpoint.activeTurn,
      state: "abandoned",
      ambiguity: current.checkpoint.activeTurn.ambiguity || previousBlocker
    }
    : null;
  const turnHistory = abandonedTurn
    && !current.checkpoint.turnHistory.some((entry) => (
      entry.requestIdentity
      && entry.requestIdentity === abandonedTurn.requestIdentity
      && entry.state === "abandoned"
    ))
    ? [...current.checkpoint.turnHistory, abandonedTurn]
    : current.checkpoint.turnHistory;
  const continuation = hasConcreteRevision(current);
  const integration = hasIntegrationConflict(current);
  const transitioned = transitionWorkTask(current, continuation || integration ? "revision" : "ready", {
    now: date,
    message: reason,
    error: ""
  });
  const next = buildWorkTask({
    ...transitioned,
    message: reason,
    error: "",
    checkpoint: mergeWorkCheckpoint(transitioned.checkpoint, {
      activeTurn: {},
      blocker: "",
      workspace: replacement
        ? { worktreePath: replacementPath, replacementOf: oldWorktree }
        : {},
      worker: replacement
        ? {
          threadId: "",
          previousThreadIds: [
            ...(current.checkpoint?.worker?.previousThreadIds || []),
            ...(previousThreadId ? [previousThreadId] : [])
          ]
        }
        : {},
      interruption: {
        workspaceEvidence: current.checkpoint?.interruption?.workspaceEvidence || {}
      },
      turnHistory,
      recoveryCount: (current.checkpoint?.recoveryCount || 0) + (continuation ? 0 : 1),
      integration: integration ? {
        status: "reconciliation",
        error: previousBlocker,
        reconciliation: {
          taskBaseRevision: current.checkpoint?.workspace?.baseRevision || "",
          taskCommit: current.checkpoint?.implementation?.commit || ""
        }
      } : {},
      recoveryHistory: [...(current.checkpoint?.recoveryHistory || []), record],
      lastAction: continuation
        ? "recovered technical revision; continuing concrete Sol correction"
        : integration
          ? "entered automation integration reconciliation"
          : reason,
      continuationCount: continuation || integration
        ? (current.checkpoint?.continuationCount || 0) + 1
        : current.checkpoint?.continuationCount || 0
    })
  });
  const envelope = await findWorkTaskEnvelope(worldRoot, taskId, { owner: current.owner });
  if (envelope) await updateWorkTaskEnvelope(worldRoot, envelope, next);
  else await enqueueWorkTask(worldRoot, next);
  return {
    task: next,
    previousBlocker: record.previousBlocker,
    reason,
    recoveryCount: next.checkpoint.recoveryCount,
    staleTurn: record.staleTurn,
    replacementWorktree: replacementPath,
    previousThreadId
  };
}

export async function findRecoverableOperationalWorkTasks(worldRoot, {
  owner = "",
  now = new Date(),
  staleTurnMs = DEFAULT_STALE_OPERATIONAL_TURN_MS,
  maxRecoveryCount = DEFAULT_MAX_OPERATIONAL_RECOVERIES
} = {}) {
  const tasks = await listWorkTasks(worldRoot, { includeTerminal: true });
  return tasks
    .filter((task) => !owner || task.owner === owner)
    .filter((task) => isRecoverableOperationalWorkTask(task, { now, staleTurnMs, maxRecoveryCount }))
    .sort((left, right) => {
      const leftCorrection = hasConcreteRevision(left) ? 1 : 0;
      const rightCorrection = hasConcreteRevision(right) ? 1 : 0;
      if (leftCorrection !== rightCorrection) return rightCorrection - leftCorrection;
      const leftStalled = Number(left.checkpoint?.integration?.reconciliation?.consecutiveNoProgressAttempts || 0) > 0 ? 1 : 0;
      const rightStalled = Number(right.checkpoint?.integration?.reconciliation?.consecutiveNoProgressAttempts || 0) > 0 ? 1 : 0;
      if (leftStalled !== rightStalled) return leftStalled - rightStalled;
      const priority = Number(right.priority) - Number(left.priority);
      if (priority) return priority;
      const queued = Date.parse(left.queuedAt) - Date.parse(right.queuedAt);
      if (queued) return queued;
      return left.taskId.localeCompare(right.taskId);
    });
}

export async function findPolicyRevalidationWorkTasks(worldRoot, {
  owner = "",
  now = new Date(),
  staleTurnMs = DEFAULT_STALE_OPERATIONAL_TURN_MS,
  maxRecoveryCount = DEFAULT_MAX_OPERATIONAL_RECOVERIES,
  currentPolicy = currentTimeoutPolicy(),
  migrationId = TIMEOUT_POLICY_MIGRATION_ID
} = {}) {
  const tasks = await listWorkTasks(worldRoot, { includeTerminal: true });
  return tasks
    .filter((task) => !owner || task.owner === owner)
    .filter((task) => isEligibleForTimeoutPolicyRevalidation(task, {
      now,
      staleTurnMs,
      maxRecoveryCount,
      currentPolicy,
      migrationId
    }))
    .sort((left, right) => {
      const priority = Number(right.priority) - Number(left.priority);
      if (priority) return priority;
      const queued = Date.parse(left.queuedAt) - Date.parse(right.queuedAt);
      if (queued) return queued;
      return left.taskId.localeCompare(right.taskId);
    });
}
import path from "node:path";
