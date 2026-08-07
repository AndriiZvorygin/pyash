import { runWorkSupervisorOnce } from "./supervisor.mjs";
import { listQueuedWorkTasks, listRuntimeWorkTasks, queueDepth } from "./queue.mjs";
import { readCodexCapacity, admitBackgroundWork, DEFAULT_BACKGROUND_POLICY } from "./capacity.mjs";
import { appendWorkOutcome } from "./outcome.mjs";
import { readWorkSchedulerHealth, writeWorkSchedulerHealth } from "./health.mjs";
import { readWorkTaskStatus, updateWorkTaskCheckpoint } from "./status.mjs";

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

export async function runWorkBackgroundOnce({
  worldRoot,
  owner = "",
  policy = {},
  capacitySource = readCodexCapacity,
  foregroundActive = false,
  supervisor = runWorkSupervisorOnce,
  supervisorOptions = {},
  now = () => new Date()
} = {}) {
  const wake = nowIso(now);
  const eligible = await eligibleWork(worldRoot, owner);
  const capacity = eligible.length
    ? await capacitySource({ now: typeof now === "function" ? now() : now })
    : { state: "unknown", available: null, usedPercent: null, resetAt: "" };
  const admission = admitBackgroundWork({
    capacity,
    policy: { ...DEFAULT_BACKGROUND_POLICY, ...policy },
    foregroundActive: typeof foregroundActive === "function" ? await foregroundActive() : foregroundActive,
    hasEligibleWork: eligible.length > 0,
    now: typeof now === "function" ? now() : now
  });
  const prior = await readWorkSchedulerHealth(worldRoot);
  const baseHealth = {
    ...prior,
    "last wake": wake,
    "capacity state": capacity.state,
    "capacity used percent": capacity.usedPercent == null ? "" : String(capacity.usedPercent),
    "capacity reset at": capacity.resetAt || "",
    "last decision": admission.reason
  };
  if (!admission.admit) {
    await writeWorkSchedulerHealth(worldRoot, baseHealth);
    if (eligible[0]?.task) await appendWorkOutcome(worldRoot, eligible[0].task, {
      reason: admission.reason,
      capacity,
      action: "deferred"
    });
    return {
      admitted: false,
      reason: admission.reason,
      capacity,
      eligible: eligible.length,
      queue: await queueDepth(worldRoot)
    };
  }
  const selected = eligible[0]?.task || null;
  if (!selected) {
    await writeWorkSchedulerHealth(worldRoot, baseHealth);
    return { admitted: false, reason: "no eligible work", capacity, eligible: 0 };
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
      now
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
    "last error": result.error || ""
  };
  await writeWorkSchedulerHealth(worldRoot, health);
  const finalTask = await readWorkTaskStatus(worldRoot, selected.taskId);
  await appendWorkOutcome(worldRoot, finalTask || { ...selected, ...(result.taskId ? { status: result.status } : {}) }, {
    reason: admission.reason,
    capacity,
    action: "admitted"
  });
  return { admitted: true, reason: admission.reason, capacity, selected: selected.taskId, ...result };
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
