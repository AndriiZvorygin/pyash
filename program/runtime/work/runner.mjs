import { runWorkSupervisorOnce } from "./supervisor.mjs";
import { listQueuedWorkTasks, listRuntimeWorkTasks, queueDepth } from "./queue.mjs";
import { readCodexCapacity, admitBackgroundWork, DEFAULT_BACKGROUND_POLICY } from "./capacity.mjs";
import { appendWorkOutcome } from "./outcome.mjs";
import { readWorkSchedulerHealth, writeWorkSchedulerHealth } from "./health.mjs";
import { readWorkTaskStatus, updateWorkTaskCheckpoint } from "./status.mjs";
import { emitWorkEvent } from "./observer.mjs";
import { renderWorkDeferredReport, renderWorkIdleReport, renderWorkTaskReport } from "./report.mjs";
import { curateWorkBacklog } from "./curator.mjs";
import { appendWorkSchedulerEvent } from "./history.mjs";
import {
  findRecoverableOperationalWorkTasks,
  recoverOperationalWorkTask
} from "./recovery.mjs";

function text(value) {
  return String(value ?? "").trim();
}

function truthy(value) {
  return /^(truth|true|yes|1|y)$/i.test(text(value));
}

function nowIso(now) {
  const value = typeof now === "function" ? now() : now || new Date();
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : String(value);
}

const ACTIVE_WORK_STATUSES = new Set(["planning", "implementing", "reviewing", "revision", "usage-limited"]);

function selectWorkCandidate(eligible, recoverable) {
  return eligible.find((entry) => ACTIVE_WORK_STATUSES.has(entry.task.status))?.task
    || recoverable[0]
    || eligible[0]?.task
    || null;
}

async function eligibleWork(worldRoot, owner) {
  const [input, runtime] = await Promise.all([
    listQueuedWorkTasks(worldRoot, { owner }),
    listRuntimeWorkTasks(worldRoot, { owner })
  ]);
  const candidates = await Promise.all([...runtime, ...input].map(async (entry) => {
    const persisted = await readWorkTaskStatus(worldRoot, entry.task.taskId);
    return persisted
      ? { ...entry, task: { ...entry.task, ...persisted, checkpoint: persisted.checkpoint || entry.task.checkpoint } }
      : entry;
  }));
  return candidates
    .filter((entry) => !["accepted", "failed", "blocked"].includes(entry.task.status))
    .sort((left, right) => {
      const lifecycle = Number(!ACTIVE_WORK_STATUSES.has(left.task.status)) - Number(!ACTIVE_WORK_STATUSES.has(right.task.status));
      if (lifecycle) return lifecycle;
      const priority = Number(right.task.priority) - Number(left.task.priority);
      if (priority) return priority;
      const queued = Date.parse(left.task.queuedAt) - Date.parse(right.task.queuedAt);
      if (queued) return queued;
      return left.task.taskId.localeCompare(right.task.taskId);
    });
}

export async function inspectWorkBackground({
  worldRoot,
  owner = "",
  policy = {},
  capacitySource = readCodexCapacity,
  foregroundActive = false,
  now = () => new Date()
} = {}) {
  const eligible = await eligibleWork(worldRoot, owner);
  const recoverable = await findRecoverableOperationalWorkTasks(worldRoot, {
    owner,
    now,
    staleTurnMs: policy.staleOperationalTurnMs,
    maxRecoveryCount: policy.maxOperationalRecoveries
  });
  const capacity = await capacitySource({ now: typeof now === "function" ? now() : now });
  const admission = admitBackgroundWork({
    capacity,
    policy: { ...DEFAULT_BACKGROUND_POLICY, ...policy },
    foregroundActive: typeof foregroundActive === "function" ? await foregroundActive() : foregroundActive,
    hasEligibleWork: eligible.length > 0 || recoverable.length > 0,
    now: typeof now === "function" ? now() : now
  });
  return {
    eligible,
    recoverable,
    capacity,
    admission,
    selected: selectWorkCandidate(eligible, recoverable)
  };
}

export async function runWorkBackgroundOnce({
  worldRoot,
  owner = "",
  policy = {},
  capacitySource = readCodexCapacity,
  foregroundActive = false,
  supervisor = runWorkSupervisorOnce,
  supervisorOptions = {},
  repositoryRoot = process.cwd(),
  curate = false,
  baselineSync = null,
  executionPreflight = null,
  onEvent = null,
  now = () => new Date()
} = {}) {
  const wake = nowIso(now);
  const curation = curate
    ? await curateWorkBacklog({
      worldRoot,
      repositoryRoot,
      owner,
      threshold: policy.curationThreshold ?? DEFAULT_BACKGROUND_POLICY.curationThreshold,
      maxTasks: policy.curationMaxTasks ?? DEFAULT_BACKGROUND_POLICY.curationMaxTasks,
      now
    })
    : null;
  const { eligible, recoverable, capacity, admission } = await inspectWorkBackground({
    worldRoot,
    owner,
    policy,
    capacitySource,
    foregroundActive,
    now
  });
  const taskCount = eligible.length + recoverable.length;
  await emitWorkEvent(onEvent, "capacity", {
    capacity,
    admitted: admission.admit,
    reason: admission.reason,
    eligible: eligible.length,
    recoverable: recoverable.length
  }, { now });
  const prior = await readWorkSchedulerHealth(worldRoot);
  const baseHealth = {
    ...prior,
    "last wake": wake,
    "capacity state": capacity.state,
    "weekly identified": capacity.weekly?.identified === true ? "true" : "false",
    "weekly used percent": capacity.weekly?.usedPercent == null ? "" : String(capacity.weekly.usedPercent),
    "weekly remaining percent": capacity.weekly?.remainingPercent == null ? "" : String(capacity.weekly.remainingPercent),
    "weekly reset at": capacity.weekly?.resetAt || "",
    "weekly window start": capacity.weekly?.windowStartAt || "",
    "weekly window minutes": capacity.weekly?.windowMinutes == null ? "" : String(capacity.weekly.windowMinutes),
    "weekly raw": JSON.stringify(capacity.weekly?.raw || {}),
    "capacity raw": JSON.stringify(capacity.raw || {}),
    "capacity observed at": capacity.observedAt || "",
    "weekly pacing floor": admission.pacing?.minimumRemainingPercent == null
      ? ""
      : String(admission.pacing.minimumRemainingPercent),
    "weekly pacing headroom": admission.pacing?.headroomPercent == null
      ? ""
      : String(admission.pacing.headroomPercent),
    "weekly reserve percent": String(policy.reservePercent ?? DEFAULT_BACKGROUND_POLICY.reservePercent),
    "capacity used percent": capacity.usedPercent == null ? "" : String(capacity.usedPercent),
    "capacity reset at": capacity.resetAt || "",
    "last decision": admission.reason,
    "hourly wakes": String((Number(prior["hourly wakes"]) || 0) + 1),
    "curation result": curation?.reason || prior["curation result"] || "",
    "curated tasks": curation?.created?.join(", ") || prior["curated tasks"] || ""
  };
  if (!admission.admit) {
    await emitWorkEvent(onEvent, "deferred", {
      reason: admission.reason,
      capacity,
      eligible: taskCount
    }, { now });
    const idle = admission.reason === "no eligible work";
    const health = {
      ...baseHealth,
      "deferred wakes": String((Number(prior["deferred wakes"]) || 0) + (idle ? 0 : 1)),
      "idle wakes": String((Number(prior["idle wakes"]) || 0) + (idle ? 1 : 0))
    };
    await writeWorkSchedulerHealth(worldRoot, health);
    await appendWorkSchedulerEvent(worldRoot, {
      type: idle ? "idle" : "deferred",
      reason: admission.reason,
      capacity,
      pacing: admission.pacing,
      taskCount,
      selected: selectWorkCandidate(eligible, recoverable)?.taskId || ""
    }, { now });
    const deferredTask = selectWorkCandidate(eligible, recoverable);
    if (deferredTask) {
      await updateWorkTaskCheckpoint(worldRoot, deferredTask.taskId, {
        interruption: {
          phase: deferredTask.status,
          at: wake,
          reason: admission.reason,
          lastTurnId: deferredTask.checkpoint.activeTurn.turnId || ""
        },
        lastAction: `deferred: ${admission.reason}`
      });
      await appendWorkOutcome(worldRoot, deferredTask, {
        reason: admission.reason,
        capacity,
        action: "deferred"
      });
    }
    const report = admission.reason === "no eligible work"
      ? renderWorkIdleReport({ result: { reason: admission.reason, eligible: taskCount }, capacity })
      : renderWorkDeferredReport({ result: { reason: admission.reason, eligible: taskCount }, capacity });
    return {
      admitted: false,
      reason: admission.reason,
      capacity,
      eligible: taskCount,
      report,
      queue: await queueDepth(worldRoot),
      curation
    };
  }
  let selected = selectWorkCandidate(eligible, recoverable);
  if (!selected) {
    await writeWorkSchedulerHealth(worldRoot, {
      ...baseHealth,
      "idle wakes": String((Number(prior["idle wakes"]) || 0) + 1)
    });
    await appendWorkSchedulerEvent(worldRoot, {
      type: "idle",
      reason: "no eligible work",
      capacity,
      pacing: admission.pacing,
      taskCount
    }, { now });
    return {
      admitted: false,
      reason: "no eligible work",
      capacity,
      eligible: taskCount,
      report: renderWorkIdleReport({ result: { reason: "no eligible work", eligible: taskCount }, capacity }),
      curation
    };
  }
  let preflight = { status: executionPreflight ? "pending" : "not-configured" };
  if (executionPreflight) {
    try {
      preflight = await executionPreflight({
        repositoryRoot,
        selected,
        worktreePath: selected.checkpoint?.workspace?.worktreePath || repositoryRoot,
        now
      });
    } catch (error) {
      preflight = {
        ok: false,
        status: "blocked",
        reason: text(error?.message || error),
        error: text(error?.message || error)
      };
    }
    if (!preflight?.ok) {
      const reason = `execution environment blocked: ${text(preflight?.reason) || "preflight failed"}`;
      await emitWorkEvent(onEvent, "deferred", {
        reason,
        selected: selected.taskId,
        preflight
      }, { now });
      await writeWorkSchedulerHealth(worldRoot, {
        ...baseHealth,
        "last decision": reason,
        "execution preflight status": "blocked",
        "execution preflight check": preflight?.check || "",
        "execution preflight reason": text(preflight?.reason) || reason,
        "execution preflight observed at": preflight?.observedAt || wake,
        "deferred wakes": String((Number(prior["deferred wakes"]) || 0) + 1)
      });
      await appendWorkSchedulerEvent(worldRoot, {
        type: "deferred",
        reason,
        capacity,
        pacing: admission.pacing,
        taskCount,
        selected: selected.taskId,
        preflight: "blocked"
      }, { now });
      return {
        admitted: false,
        reason,
        capacity,
        eligible: taskCount,
        selected: selected.taskId,
        preflight,
        report: renderWorkDeferredReport({ result: { reason, eligible: taskCount }, capacity }),
        queue: await queueDepth(worldRoot),
        curation
      };
    }
  }
  let recovery = null;
  if (recoverable.some((task) => task.taskId === selected.taskId)) {
    recovery = await recoverOperationalWorkTask(worldRoot, selected.taskId, {
      now,
      staleTurnMs: policy.staleOperationalTurnMs,
      maxRecoveryCount: policy.maxOperationalRecoveries
    });
    if (!recovery) {
      const reason = "operational recovery unavailable: task still has an ambiguous or live turn";
      await emitWorkEvent(onEvent, "deferred", {
        reason,
        selected: selected.taskId,
        preflight
      }, { now });
      await writeWorkSchedulerHealth(worldRoot, {
        ...baseHealth,
        "last decision": reason,
        "deferred wakes": String((Number(prior["deferred wakes"]) || 0) + 1)
      });
      await appendWorkSchedulerEvent(worldRoot, {
        type: "deferred",
        reason,
        capacity,
        pacing: admission.pacing,
        taskCount,
        selected: selected.taskId,
        preflight: "ready"
      }, { now });
      return {
        admitted: false,
        reason,
        capacity,
        eligible: taskCount,
        selected: selected.taskId,
        preflight,
        report: renderWorkDeferredReport({ result: { reason, eligible: taskCount }, capacity }),
        queue: await queueDepth(worldRoot),
        curation
      };
    }
    selected = recovery.task;
    await emitWorkEvent(onEvent, "recovered", {
      previousBlocker: recovery.previousBlocker,
      reason: recovery.reason,
      recoveryCount: recovery.recoveryCount,
      staleTurn: recovery.staleTurn,
      replacementWorktree: recovery.replacementWorktree,
      previousThreadId: recovery.previousThreadId,
      phase: selected.status
    }, { now });
    await appendWorkSchedulerEvent(worldRoot, {
      type: "recovered",
      taskId: selected.taskId,
      status: selected.status,
      reason: recovery.reason,
      previousBlocker: recovery.previousBlocker,
      recoveryCount: recovery.recoveryCount,
      replacementWorktree: recovery.replacementWorktree,
      previousThreadId: recovery.previousThreadId,
      capacity,
      pacing: admission.pacing,
      taskCount,
      selected: selected.taskId,
      preflight: "ready"
    }, { now });
  }
  const activeRuntime = eligible.some(({ task }) => ACTIVE_WORK_STATUSES.has(task.status));
  let baseline = { status: baselineSync ? (activeRuntime ? "skipped-active-task" : "pending") : "not-configured" };
  if (baselineSync && !activeRuntime) {
    try {
      baseline = await baselineSync({ repositoryRoot, selected, now });
      await emitWorkEvent(onEvent, "baseline-synced", {
        status: baseline.status,
        branch: baseline.branch,
        commit: baseline.commit,
        selected: selected.taskId
      }, { now });
    } catch (error) {
      const reason = `automation baseline sync blocked: ${text(error?.message || error)}`;
      await emitWorkEvent(onEvent, "deferred", { reason, selected: selected.taskId }, { now });
      await writeWorkSchedulerHealth(worldRoot, {
        ...baseHealth,
        "last decision": reason,
        "baseline status": "blocked",
        "baseline error": text(error?.message || error),
        "deferred wakes": String((Number(prior["deferred wakes"]) || 0) + 1)
      });
      await appendWorkSchedulerEvent(worldRoot, {
        type: "deferred",
        reason,
        capacity,
        pacing: admission.pacing,
        taskCount,
        selected: selected.taskId,
        baseline: "blocked"
      }, { now });
      return {
        admitted: false,
        reason,
        capacity,
        eligible: taskCount,
        selected: selected.taskId,
        baseline: { status: "blocked", error: text(error?.message || error) },
        report: renderWorkDeferredReport({ result: { reason, eligible: taskCount }, capacity }),
        queue: await queueDepth(worldRoot),
        curation
      };
    }
  }
  await updateWorkTaskCheckpoint(worldRoot, selected.taskId, {
    selectionReason: admission.reason,
    lastAction: "admitted by background runner"
  });
  let result;
  try {
    result = await supervisor({
      ...supervisorOptions,
      worldRoot,
      owner,
      taskId: selected.taskId,
      now,
      onEvent
    });
  } catch (error) {
    result = {
      claimed: true,
      taskId: selected.taskId,
      status: "failed",
      error: text(error?.message || error)
    };
  }
  const health = {
    ...baseHealth,
    "execution preflight status": preflight.status || (preflight.ok ? "ready" : ""),
    "execution preflight check": preflight.check || "",
    "execution preflight reason": preflight.reason || "",
    "execution preflight observed at": preflight.observedAt || "",
    "baseline status": baseline.status,
    "baseline commit": baseline.commit || "",
    "last admitted task": result.taskId || selected.taskId,
    "last completed task": ["accepted", "blocked", "failed"].includes(result.status) ? result.taskId || selected.taskId : prior["last completed task"] || "",
    "current task": ["accepted", "blocked", "failed", "idle"].includes(result.status) ? "" : result.taskId || selected.taskId,
    "last error": result.error || "",
    "last recovered task": recovery?.task.taskId || prior["last recovered task"] || "",
    "last recovery reason": recovery?.reason || prior["last recovery reason"] || "",
    "admitted wakes": String((Number(prior["admitted wakes"]) || 0) + 1),
    "completed tasks": String((Number(prior["completed tasks"]) || 0)
      + (["accepted", "blocked", "failed"].includes(result.status) ? 1 : 0))
  };
  await writeWorkSchedulerHealth(worldRoot, health);
  const finalTask = await readWorkTaskStatus(worldRoot, selected.taskId);
  await appendWorkOutcome(worldRoot, finalTask || { ...selected, ...(result.taskId ? { status: result.status } : {}) }, {
    reason: admission.reason,
    capacity,
    action: "admitted"
  });
  await appendWorkSchedulerEvent(worldRoot, {
    type: "admitted",
    taskId: selected.taskId,
    status: result.status,
    reason: admission.reason,
    capacity,
    pacing: admission.pacing,
    taskCount,
    selected: selected.taskId,
    baseline: baseline.status
  }, { now });
  return {
    admitted: true,
    reason: admission.reason,
    capacity,
    selected: selected.taskId,
    report: renderWorkTaskReport(finalTask || selected),
    curation,
    baseline,
    preflight,
    recovery,
    ...result
  };
}

export async function runWorkBackgroundContinuous({
  intervalMs = DEFAULT_BACKGROUND_POLICY.pollIntervalMs,
  maxTasksPerWake = DEFAULT_BACKGROUND_POLICY.maxTasksPerWake,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  maxCycles = 0,
  ...options
} = {}) {
  const results = [];
  let cycles = 0;
  let processed = 0;
  while (!maxCycles || cycles < maxCycles) {
    cycles += 1;
    const result = await runWorkBackgroundOnce(options);
    results.push(result);
    if (result.admitted) processed += 1;
    if (processed >= Math.max(1, Number(maxTasksPerWake) || 1)) {
      processed = 0;
      await sleep(Math.max(1, Number(intervalMs) || DEFAULT_BACKGROUND_POLICY.pollIntervalMs));
    } else if (!result.admitted) {
      await sleep(Math.max(1, Number(intervalMs) || DEFAULT_BACKGROUND_POLICY.pollIntervalMs));
    }
  }
  return results;
}

export function backgroundEnabledFromEnv(env = process.env) {
  return truthy(env.PYA_BACKGROUND_WORK);
}
