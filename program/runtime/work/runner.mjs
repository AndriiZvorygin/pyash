import { runWorkSupervisorOnce } from "./supervisor.mjs";
import { runWorkIntegrationReconciliationOnce } from "./integration_runner.mjs";
import { listQueuedWorkTasks, listRuntimeWorkTasks, queueDepth } from "./queue.mjs";
import { listWorkTasks, resumeExternalEvidenceTask } from "./operator.mjs";
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
import { isTechnicalContinuationBlock } from "./roadmap.mjs";
import { isAwaitingExternalEvidence } from "./roadmap.mjs";
import { deriveImplementationProgress } from "./progress.mjs";

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

async function probeUrl(url, fetchImpl, timeoutMs = 3000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { signal: controller.signal });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export async function probeExternalEvidenceTask(task, {
  fetchImpl = globalThis.fetch,
  env = process.env
} = {}) {
  const reason = text(task?.checkpoint?.blocker || task?.message || task?.error);
  const checks = [];
  if (/Ollama/iu.test(reason)) {
    const ollamaHost = text(env.OLLAMA_HOST) || "http://localhost:11434";
    let healthy = await probeUrl(`${ollamaHost.replace(/\/$/u, "")}/api/tags`, fetchImpl);
    if (healthy && /Ollama/iu.test(reason)) {
      try {
        const response = await fetchImpl(`${ollamaHost.replace(/\/$/u, "")}/api/tags`);
        const payload = await response.json();
        const names = (payload.models || []).map((model) => String(model.name || model.model || ""));
        healthy = names.includes(text(env.PYA_MIND_MODEL) || "qwen3.5:9b");
      } catch {
        healthy = false;
      }
    }
    checks.push({ name: "Ollama", healthy, endpoint: ollamaHost });
  }
  if (/search|60490/iu.test(reason)) {
    const searchMotor = text(env.PYA_WEB_SEARCH_MOTOR) || "http://localhost:60490/";
    let searchUrl = searchMotor;
    try {
      const parsed = new URL(searchMotor.endsWith("/search") ? searchMotor : `${searchMotor.replace(/\/$/u, "")}/search`);
      parsed.searchParams.set("q", "pyash");
      parsed.searchParams.set("format", "json");
      parsed.searchParams.set("count", "1");
      searchUrl = parsed.toString();
    } catch {}
    checks.push({ name: "web search", healthy: await probeUrl(searchUrl, fetchImpl), endpoint: searchUrl });
  }
  if (!checks.length) return { available: false, checked: false, reason: "no cheap external dependency probe configured" };
  const failed = checks.filter((check) => !check.healthy);
  return {
    available: failed.length === 0,
    checked: true,
    reason: failed.length ? `external dependency still unavailable: ${failed.map((check) => check.name).join(", ")}` : "external dependencies available",
    checks
  };
}

function isIntegrationCandidate(task) {
  return ["blocked", "reconciliation", "revision"].includes(task?.checkpoint?.integration?.status);
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
  externalEvidenceProbe = null,
  now = () => new Date()
} = {}) {
  let eligible = await eligibleWork(worldRoot, owner);
  let recoverable = await findRecoverableOperationalWorkTasks(worldRoot, {
      owner,
      now,
      staleTurnMs: policy.staleOperationalTurnMs,
      maxRecoveryCount: policy.maxOperationalRecoveries
    });
  let allTasks = await listWorkTasks(worldRoot, { includeTerminal: true });
  let blocked = allTasks
    .filter((task) => !owner || task.owner === owner)
    .filter((task) => isTechnicalContinuationBlock(task));
  let externalEvidence = allTasks
    .filter((task) => !owner || task.owner === owner)
    .filter((task) => isAwaitingExternalEvidence(task));
  let temporarilyUnexecutableTechnical = blocked
    .filter((task) => !recoverable.some((candidate) => candidate.taskId === task.taskId));
  const resumedExternal = [];
  if (externalEvidenceProbe) {
    for (const task of externalEvidence) {
      const probe = await externalEvidenceProbe(task);
      if (!probe?.available) continue;
      const resumed = await resumeExternalEvidenceTask(worldRoot, task.taskId, probe, { now });
      if (resumed?.taskId) resumedExternal.push({ taskId: resumed.taskId, probe });
    }
    if (resumedExternal.length) {
      eligible = await eligibleWork(worldRoot, owner);
      recoverable = await findRecoverableOperationalWorkTasks(worldRoot, {
        owner,
        now,
        staleTurnMs: policy.staleOperationalTurnMs,
        maxRecoveryCount: policy.maxOperationalRecoveries
      });
      allTasks = await listWorkTasks(worldRoot, { includeTerminal: true });
      blocked = allTasks
        .filter((task) => !owner || task.owner === owner)
        .filter((task) => isTechnicalContinuationBlock(task));
      externalEvidence = allTasks
        .filter((task) => !owner || task.owner === owner)
        .filter((task) => isAwaitingExternalEvidence(task));
      temporarilyUnexecutableTechnical = blocked
        .filter((task) => !recoverable.some((candidate) => candidate.taskId === task.taskId));
    }
  }
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
    technicalBlocked: blocked,
    temporarilyUnexecutableTechnical,
    externalEvidence,
    resumedExternal,
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
  integrationSupervisor = runWorkIntegrationReconciliationOnce,
  supervisorOptions = {},
  repositoryRoot = process.cwd(),
  curate = false,
  baselineSync = null,
  executionPreflight = null,
  externalEvidenceProbe = null,
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
      staleTurnMs: policy.staleOperationalTurnMs,
      maxRecoveryCount: policy.maxOperationalRecoveries,
      now
    })
    : null;
  const { eligible, recoverable, temporarilyUnexecutableTechnical, externalEvidence, capacity, admission } = await inspectWorkBackground({
    worldRoot,
    owner,
    policy,
    capacitySource,
    foregroundActive,
    externalEvidenceProbe,
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
    const externalOnly = admission.reason === "no eligible work" && externalEvidence.length > 0;
    const technicalUnavailable = admission.reason === "no eligible work" && temporarilyUnexecutableTechnical.length > 0;
    const reason = externalOnly
      ? "awaiting external evidence"
      : technicalUnavailable ? "technical continuation unavailable" : admission.reason;
    const idle = reason === "no eligible work";
    const action = externalOnly || technicalUnavailable ? "technical-blocked" : idle ? "idle" : "deferred";
    await emitWorkEvent(onEvent, externalOnly || technicalUnavailable ? "technical-blocked" : "deferred", {
      reason,
      capacity,
      eligible: taskCount,
      blocked: temporarilyUnexecutableTechnical.map((task) => task.taskId)
    }, { now });
    const health = {
      ...baseHealth,
      "deferred wakes": String((Number(prior["deferred wakes"]) || 0) + (idle || technicalUnavailable ? 0 : 1)),
      "idle wakes": String((Number(prior["idle wakes"]) || 0) + (idle ? 1 : 0)),
      "technical continuation unavailable wakes": String((Number(prior["technical continuation unavailable wakes"]) || 0) + (technicalUnavailable ? 1 : 0)),
      "external evidence wakes": String((Number(prior["external evidence wakes"]) || 0) + (externalOnly ? 1 : 0)),
      "blocked before model wakes": String((Number(prior["blocked before model wakes"]) || 0) + (externalOnly || technicalUnavailable ? 1 : 0))
    };
    await writeWorkSchedulerHealth(worldRoot, health);
    await appendWorkSchedulerEvent(worldRoot, {
      type: action,
      reason,
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
        reason,
        capacity,
        action: "deferred"
      });
    }
    const report = idle
      ? renderWorkIdleReport({ result: { reason, eligible: taskCount }, capacity })
      : renderWorkDeferredReport({ result: { reason, eligible: taskCount }, capacity });
    return {
      admitted: false,
      reason,
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
      await emitWorkEvent(onEvent, "technical-blocked", {
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
        "technical continuation unavailable wakes": String((Number(prior["technical continuation unavailable wakes"]) || 0) + 1)
      });
      await appendWorkSchedulerEvent(worldRoot, {
        type: "technical-blocked",
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
      await emitWorkEvent(onEvent, "technical-blocked", { reason, selected: selected.taskId }, { now });
      await writeWorkSchedulerHealth(worldRoot, {
        ...baseHealth,
        "last decision": reason,
        "baseline status": "blocked",
        "baseline error": text(error?.message || error),
        "technical continuation unavailable wakes": String((Number(prior["technical continuation unavailable wakes"]) || 0) + 1)
      });
      await appendWorkSchedulerEvent(worldRoot, {
        type: "technical-blocked",
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
  const selectedIntegration = isIntegrationCandidate(selected);
  const beforeTask = await readWorkTaskStatus(worldRoot, selected.taskId);
  const beforeProgress = deriveImplementationProgress(beforeTask?.checkpoint || selected.checkpoint || {});
  let result;
  try {
    const selectedSupervisor = selectedIntegration ? integrationSupervisor : supervisor;
    result = await selectedSupervisor({
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
  const finalTaskBeforeHealth = await readWorkTaskStatus(worldRoot, selected.taskId);
  const finalProgress = deriveImplementationProgress(finalTaskBeforeHealth?.checkpoint || selected.checkpoint || {});
  const materialProgress = selectedIntegration
    ? Number(finalTaskBeforeHealth?.checkpoint?.integration?.reconciliation?.materialAttempts || 0)
      > Number(beforeTask?.checkpoint?.integration?.reconciliation?.materialAttempts || 0)
      || finalProgress.materialProgressPasses > beforeProgress.materialProgressPasses
    : finalProgress.materialProgressPasses > beforeProgress.materialProgressPasses;
  const useful = Boolean(recovery || materialProgress || result.status === "accepted" || result.integration?.status === "integrated" || ["reviewing", "revision"].includes(result.status) && result.message);
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
      + (["accepted", "blocked", "failed"].includes(result.status) ? 1 : 0)),
    "work-started wakes": String((Number(prior["work-started wakes"]) || 0) + 1),
    "useful wakes": String((Number(prior["useful wakes"]) || 0) + (useful ? 1 : 0)),
    "material-progress wakes": String((Number(prior["material-progress wakes"]) || 0) + (materialProgress ? 1 : 0)),
    "blocked before model wakes": String(Number(prior["blocked before model wakes"]) || 0),
    "external evidence wakes": String(Number(prior["external evidence wakes"]) || 0)
  };
  await writeWorkSchedulerHealth(worldRoot, health);
  const finalTask = finalTaskBeforeHealth || await readWorkTaskStatus(worldRoot, selected.taskId);
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
    baseline: baseline.status,
    workStarted: true,
    usefulWake: useful,
    materialProgress,
    integration: selectedIntegration ? finalTask?.checkpoint?.integration?.status || "" : ""
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
