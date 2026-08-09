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

async function eligibleWork(worldRoot, owner) {
  const [input, runtime] = await Promise.all([
    listQueuedWorkTasks(worldRoot, { owner }),
    listRuntimeWorkTasks(worldRoot, { owner })
  ]);
  return [...runtime, ...input]
    .filter((entry) => !["accepted", "failed", "blocked"].includes(entry.task.status))
    .sort((left, right) => {
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
  const capacity = await capacitySource({ now: typeof now === "function" ? now() : now });
  const admission = admitBackgroundWork({
    capacity,
    policy: { ...DEFAULT_BACKGROUND_POLICY, ...policy },
    foregroundActive: typeof foregroundActive === "function" ? await foregroundActive() : foregroundActive,
    hasEligibleWork: eligible.length > 0,
    now: typeof now === "function" ? now() : now
  });
  return {
    eligible,
    capacity,
    admission,
    selected: eligible[0]?.task || null
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
  const { eligible, capacity, admission } = await inspectWorkBackground({
    worldRoot,
    owner,
    policy,
    capacitySource,
    foregroundActive,
    now
  });
  await emitWorkEvent(onEvent, "capacity", {
    capacity,
    admitted: admission.admit,
    reason: admission.reason,
    eligible: eligible.length
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
      eligible: eligible.length
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
      taskCount: eligible.length,
      selected: eligible[0]?.task?.taskId || ""
    }, { now });
    if (eligible[0]?.task) {
      await updateWorkTaskCheckpoint(worldRoot, eligible[0].task.taskId, {
        interruption: {
          phase: eligible[0].task.status,
          at: wake,
          reason: admission.reason,
          lastTurnId: eligible[0].task.checkpoint.activeTurn.turnId || ""
        },
        lastAction: `deferred: ${admission.reason}`
      });
      await appendWorkOutcome(worldRoot, eligible[0].task, {
        reason: admission.reason,
        capacity,
        action: "deferred"
      });
    }
    const report = admission.reason === "no eligible work"
      ? renderWorkIdleReport({ result: { reason: admission.reason, eligible: eligible.length }, capacity })
      : renderWorkDeferredReport({ result: { reason: admission.reason, eligible: eligible.length }, capacity });
    return {
      admitted: false,
      reason: admission.reason,
      capacity,
      eligible: eligible.length,
      report,
      queue: await queueDepth(worldRoot),
      curation
    };
  }
  const selected = eligible[0]?.task || null;
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
      taskCount: 0
    }, { now });
    return {
      admitted: false,
      reason: "no eligible work",
      capacity,
      eligible: 0,
      report: renderWorkIdleReport({ result: { reason: "no eligible work", eligible: 0 }, capacity }),
      curation
    };
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
    "last admitted task": result.taskId || selected.taskId,
    "last completed task": ["accepted", "blocked", "failed"].includes(result.status) ? result.taskId || selected.taskId : prior["last completed task"] || "",
    "current task": ["accepted", "blocked", "failed", "idle"].includes(result.status) ? "" : result.taskId || selected.taskId,
    "last error": result.error || "",
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
    taskCount: eligible.length,
    selected: selected.taskId
  }, { now });
  return {
    admitted: true,
    reason: admission.reason,
    capacity,
    selected: selected.taskId,
    report: renderWorkTaskReport(finalTask || selected),
    curation,
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
