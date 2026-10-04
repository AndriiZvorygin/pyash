import { createHash } from "node:crypto";

import { appendWorkSchedulerEvent, readWorkSchedulerEvents } from "./history.mjs";
import { addWorkTask, listWorkTasks } from "./operator.mjs";
import { readWorkTaskStatus } from "./status.mjs";
import { isAwaitingExternalEvidence, isRetryableWorkBlock } from "./roadmap.mjs";
import { readWorkSchedulerHealth } from "./health.mjs";

export const BLOCKER_REPAIR_WINDOW_MS = 24 * 60 * 60 * 1000;

const WAKE_ACTIONS = new Set(["idle", "deferred", "admitted", "technical-blocked"]);

function text(value) {
  return String(value ?? "").trim();
}

function bool(value) {
  return value === true || /^(true|truth|yes|1)$/iu.test(text(value));
}

function dateValue(value, fallback = new Date()) {
  const date = value instanceof Date ? value : new Date(value || fallback);
  return Number.isFinite(date.getTime()) ? date : new Date(fallback);
}

function iso(value, fallback = new Date()) {
  return dateValue(value, fallback).toISOString();
}

function dayKey(value) {
  return iso(value).slice(0, 10);
}

function blockerReason(task) {
  return text(task?.checkpoint?.blocker || task?.message || task?.error);
}

function compact(value, limit = 600) {
  const body = text(value).replace(/\s+/gu, " ");
  return body.length <= limit ? body : `${body.slice(0, limit - 3)}...`;
}

function reasonKey(value) {
  return createHash("sha256").update(text(value)).digest("hex").slice(0, 12);
}

function usefulEvent(event) {
  if (bool(event.usefulWake) || bool(event.workStarted) || bool(event.materialProgress)) return true;
  if (["recovered", "policy-revalidated", "baseline-synced", "integration-reconciled"].includes(text(event.action))) return true;
  return text(event.action) === "admitted"
    && (bool(event.workStarted) || bool(event.usefulWake) || bool(event.materialProgress)
      || text(event.status) === "accepted" || text(event.integration) === "integrated");
}

export function assessPriorDayProductivity(events = [], {
  now = new Date(),
  windowMs = BLOCKER_REPAIR_WINDOW_MS
} = {}) {
  const end = dateValue(now);
  const start = new Date(end.getTime() - Math.max(1, Number(windowMs) || BLOCKER_REPAIR_WINDOW_MS));
  const recent = events.filter((event) => {
    const at = Date.parse(event?.at);
    return Number.isFinite(at) && at >= start.getTime() && at <= end.getTime();
  });
  const wakes = recent.filter((event) => WAKE_ACTIONS.has(text(event.action)));
  const useful = recent.filter(usefulEvent);
  return {
    windowStart: start.toISOString(),
    windowEnd: end.toISOString(),
    observedWakes: wakes.length,
    usefulEvents: useful.length,
    noUsefulWork: wakes.length > 0 && useful.length === 0,
    usefulEvent: useful[0] || null,
    lastWake: wakes.at(-1) || null
  };
}

function repairSource(task) {
  return task?.taskId || "";
}

function repairTaskId(sourceTaskId, source, now) {
  const sourceKey = sourceTaskId || source;
  return `blocker-repair-${sourceKey}-${dayKey(now)}`
    .replace(/[^a-zA-Z0-9._-]+/gu, "-")
    .replace(/-+/gu, "-")
    .replace(/^-|-$/gu, "");
}

function existingRepair(tasks, sourceTaskId, repairId) {
  return tasks.find((task) => task?.kind === "blocker-repair"
    && (task.taskId === repairId || task.workSpec?.blockerRepair?.sourceTaskId === sourceTaskId));
}

function globalBaselineCandidate(health, tasks, now) {
  const reason = [health?.["last decision"], health?.["baseline error"]]
    .map(text)
    .find((value) => /automation baseline sync blocked/iu.test(value)) || "";
  if (!/automation baseline sync blocked/iu.test(reason)) return null;
  const source = "automation-baseline-sync";
  const taskId = repairTaskId("automation-baseline-sync", source, now);
  if (existingRepair(tasks, source, taskId)) return null;
  return {
    taskId,
    title: "Repair the autonomous automation baseline blocker",
    priority: 1000,
    source,
    sourceTaskId: "",
    blockerClass: "technical",
    blocker: reason,
    promptText: [
      "Repair the current Pyash autonomous automation-baseline blocker so normal roadmap work can resume.",
      "Inspect the exact branch and merge state reported below. Use the existing integration and worktree conventions.",
      "Do not modify master, force-push, delete durable work, or hide a conflict. Reconcile semantically compatible automation history and record the concrete result.",
      "If the conflict is safely resolvable, repair it and run the focused scheduler/integration checks. If it requires a genuine semantic decision, leave the blocker intact and report the precise decision boundary.",
      `Observed blocker: ${reason}`
    ].join("\n"),
    acceptanceText: "The automation baseline can be synchronized safely, or the unresolved semantic boundary is durably diagnosed with evidence and no roadmap work is misclassified as complete.",
    contextText: "This is a bounded control-plane blocker repair. It does not replace or complete the source roadmap package.",
    repairId: reasonKey(reason),
    workSpec: {
      granularity: "bounded",
      blockerRepair: {
        source: "scheduler-health",
        sourceTaskId: "",
        blockerClass: "technical",
        blocker: reason,
        repairId: reasonKey(reason),
        triggeredAfterWindow: dayKey(now)
      }
    }
  };
}

function taskCandidate(task, tasks, now) {
  if (!task || !["blocked", "failed"].includes(task.status)) return null;
  if (task.kind === "blocker-repair" || task.workSpec?.archived) return null;
  const reason = blockerReason(task);
  const external = isAwaitingExternalEvidence(task);
  const technical = isRetryableWorkBlock(task);
  if (!external && !technical) return null;
  const sourceTaskId = repairSource(task);
  const source = external ? "external-evidence" : "technical-continuation";
  const taskId = repairTaskId(sourceTaskId, source, now);
  if (existingRepair(tasks, sourceTaskId, taskId)) return null;
  const remoteRepair = /mriczo|60490|ollama|fixture-free|container|endpoint|search/iu.test(reason);
  return {
    taskId,
    title: `Repair blocker for ${task.title}`,
    priority: Number(task.priority || 0) + 500,
    source,
    sourceTaskId,
    blockerClass: external ? "external-evidence" : "technical",
    blocker: reason,
    promptText: [
      `Remove the current blocker for the existing Pyash WorkTask ${sourceTaskId}.`,
      "Do not implement the source task from scratch and do not mark it accepted.",
      "Diagnose the blocker using durable task evidence, then repair only the required local or remote infrastructure/configuration path.",
      "Use existing Pyash deployment conventions and the existing checkout on any remote host; do not create a parallel repository or service layout.",
      "Do not expose credentials or copy secrets into reports. Preserve the original task history and record exact verification evidence.",
      remoteRepair ? "For remote services, inspect the existing host/container and configuration first; reload only the identified service, then run the smallest real endpoint probe." : "Keep the repair bounded and verify the original blocker with a deterministic focused probe.",
      `Current blocker: ${reason}`
    ].join("\n"),
    acceptanceText: "The source task's blocker is either removed with a deterministic verification record, or its remaining external/human boundary is precisely diagnosed without changing source-task acceptance.",
    contextText: `Source task: ${sourceTaskId}. This repair is a bounded prerequisite-removal action and must preserve the source task's WorkTask identity, checkpoint, and acceptance boundary.`,
    repairId: reasonKey(reason),
    workSpec: {
      granularity: "bounded",
      blockerRepair: {
        source: "work-task",
        sourceTaskId,
        blockerClass: external ? "external-evidence" : "technical",
        blocker: reason,
        repairId: reasonKey(reason),
        triggeredAfterWindow: dayKey(now)
      }
    }
  };
}

export function findBlockerRepairCandidate({ tasks = [], health = {}, now = new Date() } = {}) {
  const currentDay = dayKey(now);
  const existingCurrentRepair = tasks.find((task) => task?.kind === "blocker-repair"
    && task.workSpec?.blockerRepair?.triggeredAfterWindow === currentDay
    && !["accepted", "failed", "blocked"].includes(task.status));
  if (existingCurrentRepair) return null;
  const global = globalBaselineCandidate(health, tasks, now);
  if (global) return global;
  return tasks
    .map((task) => taskCandidate(task, tasks, now))
    .filter(Boolean)
    .sort((left, right) => Number(right.priority) - Number(left.priority))[0] || null;
}

export async function prepareBlockerRepair({
  worldRoot,
  owner = "background",
  now = new Date(),
  windowMs = BLOCKER_REPAIR_WINDOW_MS,
  dryRun = false
} = {}) {
  const end = dateValue(typeof now === "function" ? now() : now);
  const [events, tasks, health] = await Promise.all([
    readWorkSchedulerEvents(worldRoot, { since: new Date(end.getTime() - windowMs).toISOString(), until: end.toISOString() }),
    listWorkTasks(worldRoot, { includeTerminal: true }),
    readWorkSchedulerHealth(worldRoot)
  ]);
  const productivity = assessPriorDayProductivity(events, { now: end, windowMs });
  if (!productivity.noUsefulWork) {
    return { activated: false, reason: "prior day contained useful work", productivity, candidate: null, task: null };
  }
  const candidate = findBlockerRepairCandidate({
    tasks: tasks.filter((task) => !owner || task.owner === owner),
    health,
    now: end
  });
  if (!candidate) {
    return { activated: false, reason: "no bounded technical or external blocker repair candidate", productivity, candidate: null, task: null };
  }
  if (dryRun) return { activated: true, created: false, reason: "prior day had no useful work", productivity, candidate, task: null };
  await addWorkTask(worldRoot, {
    taskId: candidate.taskId,
    owner,
    kind: "blocker-repair",
    title: candidate.title,
    promptText: candidate.promptText,
    acceptanceText: candidate.acceptanceText,
    contextText: candidate.contextText,
    priority: candidate.priority,
    retryMax: 1,
    queuedAt: end.toISOString(),
    workSpec: candidate.workSpec
  });
  const task = await readWorkTaskStatus(worldRoot, candidate.taskId);
  await appendWorkSchedulerEvent(worldRoot, {
    action: "blocker-repair-prepared",
    taskId: task.taskId,
    selected: task.taskId,
    reason: candidate.blocker,
    blockerRepair: true,
    repairSourceTaskId: candidate.sourceTaskId,
    repairBlockerClass: candidate.blockerClass,
    repairAttempt: candidate.workSpec.blockerRepair.triggeredAfterWindow
  }, { now: end });
  return { activated: true, created: true, reason: "prior day had no useful work", productivity, candidate, task };
}
