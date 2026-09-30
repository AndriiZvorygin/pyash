import fs from "node:fs/promises";
import path from "node:path";

import { addWorkTask, listWorkTasks } from "./operator.mjs";
import { findPolicyRevalidationWorkTasks, findRecoverableOperationalWorkTasks } from "./recovery.mjs";
import {
  autonomousRoadmapPackages,
  isAwaitingExternalEvidence,
  isRetryableWorkBlock,
  roadmapDependencyStatus,
  validateRoadmapDependencies
} from "./roadmap.mjs";

function text(value) {
  return String(value ?? "").trim();
}

function iso(now) {
  const value = typeof now === "function" ? now() : now || new Date();
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString();
}

function sourceKey(candidate) {
  return `${candidate.sourcePath}:${candidate.sourceAnchor}`;
}

async function sourceText(repositoryRoot, candidate) {
  try {
    return await fs.readFile(path.join(repositoryRoot, candidate.sourcePath), "utf8");
  } catch {
    return "";
  }
}

function sourceRecord(candidate, source) {
  const offset = source.indexOf(candidate.sourceAnchor);
  const line = offset < 0 ? 0 : source.slice(0, offset).split("\n").length;
  return {
    kind: candidate.sourcePath.includes("todo") ? "todo" : "roadmap",
    path: candidate.sourcePath,
    anchor: candidate.sourceAnchor,
    line,
    key: sourceKey(candidate),
    whyNow: candidate.whyNow
  };
}

const EXECUTABLE_TASK_STATUSES = new Set([
  "ready",
  "planning",
  "implementing",
  "reviewing",
  "revision",
  "reconciliation",
  "integration-reconciliation",
  "integration-revision",
  "usage-limited"
]);

function taskForPackage(item, tasks) {
  return tasks.find((task) => task.taskId === item.taskId)
    || tasks.find((task) => task.workSpec?.provenance?.key === `${item.sourcePath}:${item.sourceAnchor}`);
}

/**
 * The digest and scheduler must agree about what the roadmap can actually
 * supply. An absent candidate is visible roadmap work, but it is not
 * executable until curation proposes/materializes it in the current wake.
 */
export function buildExecutableSupply({ tasks = [], roadmap = {}, curation = {}, durableCandidates = null } = {}) {
  roadmap = roadmap || {};
  const proposed = new Set([
    ...(curation.created || []),
    ...(curation.proposed || []).map((item) => item.taskId)
  ]);
  const packages = roadmap.packages || [];
  const runnablePackages = packages
    .filter((item) => ["ACTIVE", "QUEUED", "CANDIDATE"].includes(item.status))
    .filter((item) => item.dependencyStatus?.satisfied !== false)
    .filter((item) => {
      const task = taskForPackage(item, tasks);
      return task
        ? EXECUTABLE_TASK_STATUSES.has(task.status)
        : proposed.has(item.taskId);
    });
  const dependencyWaiting = packages
    .filter((item) => item.dependencyStatus?.satisfied === false)
    .map((item) => ({
      taskId: item.taskId,
      title: item.title,
      unmet: item.dependencyStatus.unmet || []
    }));
  const packagesByTaskId = new Map(packages.map((item) => [item.taskId, item]));
  const dependencySatisfiedTask = (task) => {
    const item = packagesByTaskId.get(task.taskId)
      || packages.find((candidate) => task.workSpec?.provenance?.key === `${candidate.sourcePath}:${candidate.sourceAnchor}`);
    return !item || item.dependencyStatus?.satisfied !== false;
  };
  const durable = (durableCandidates || tasks)
    .filter((task) => durableCandidates || EXECUTABLE_TASK_STATUSES.has(task.status))
    .filter(dependencySatisfiedTask)
    .map((task) => ({ taskId: task.taskId, title: task.title, priority: task.priority, source: "durable-task" }));
  const packageSupply = runnablePackages.map((item) => ({
    taskId: item.taskId,
    title: item.title,
    priority: item.priority,
    source: "roadmap-package"
  }));
  const runnable = [...durable, ...packageSupply]
    .filter((candidate, index, values) => values.findIndex((item) => item.taskId === candidate.taskId) === index)
    .sort((left, right) => Number(right.priority || 0) - Number(left.priority || 0));
  const candidatePackages = packages
    .filter((item) => ["ACTIVE", "QUEUED", "CANDIDATE"].includes(item.status))
    .filter((item) => item.dependencyStatus?.satisfied !== false)
    .filter((item) => !runnablePackages.some((runnable) => runnable.taskId === item.taskId));
  return {
    runnable,
    runnablePackages,
    candidatePackages,
    dependencyWaiting
  };
}

export async function curateWorkBacklog({
  worldRoot,
  repositoryRoot = process.cwd(),
  owner = "background",
  threshold = 1,
  maxTasks = 3,
  dryRun = false,
  candidateAvailability = null,
  forceCandidates = false,
  staleTurnMs,
  maxRecoveryCount,
  now = () => new Date()
} = {}) {
  const tasks = await listWorkTasks(worldRoot, { includeTerminal: true });
  const active = tasks.filter((task) => !["accepted", "failed", "blocked"].includes(task.status));
  const candidates = autonomousRoadmapPackages();
  const dependencyDefects = validateRoadmapDependencies(candidates);
  const dependencyWaiting = new Map(candidates.map((candidate) => [candidate.taskId, roadmapDependencyStatus(candidate, {
    tasks,
    packages: candidates,
    dependencyDefects
  })]));
  const taskDependencySatisfied = (task) => {
    const candidate = candidates.find((item) => item.taskId === task.taskId);
    return !candidate || dependencyWaiting.get(candidate.taskId)?.satisfied !== false;
  };
  const dependencySatisfiedActive = active.filter(taskDependencySatisfied);
  const temporarilyUnavailableActive = [];
  const runnableActive = [];
  for (const task of dependencySatisfiedActive) {
    if (typeof candidateAvailability !== "function") {
      runnableActive.push(task);
      continue;
    }
    let availability;
    try {
      availability = await candidateAvailability({ task, owner, repositoryRoot, now });
    } catch (error) {
      availability = { available: true, reason: "availability probe failed open", error: text(error?.message || error) };
    }
    if (availability?.available === false) {
      temporarilyUnavailableActive.push({
        taskId: task.taskId,
        title: task.title,
        reason: text(availability.reason) || "temporarily unavailable",
        detail: text(availability.error)
      });
    } else {
      runnableActive.push(task);
    }
  }
  const retryableTechnical = tasks.filter((task) => isRetryableWorkBlock(task));
  const recoverableTechnicalAll = await findRecoverableOperationalWorkTasks(worldRoot, {
    owner,
    now,
    staleTurnMs,
    maxRecoveryCount
  });
  const policyRevalidation = await findPolicyRevalidationWorkTasks(worldRoot, {
    owner,
    now,
    staleTurnMs,
    maxRecoveryCount
  });
  const recoverableTechnical = recoverableTechnicalAll.filter(taskDependencySatisfied);
  const recoverableIds = new Set(recoverableTechnical.map((task) => task.taskId));
  const temporarilyUnexecutableTechnical = retryableTechnical
    .filter(taskDependencySatisfied)
    .filter((task) => !recoverableIds.has(task.taskId))
    .map((task) => task.taskId);
  const awaitingExternalEvidence = tasks.filter((task) => isAwaitingExternalEvidence(task));
  const resultShape = {
    retryableTechnical: retryableTechnical.map((task) => task.taskId),
    retryable: retryableTechnical.map((task) => task.taskId),
    recoverableTechnical: recoverableTechnical.map((task) => task.taskId),
    policyRevalidation: policyRevalidation.map((task) => task.taskId),
    temporarilyUnexecutableTechnical,
    awaitingExternalEvidence: awaitingExternalEvidence.map((task) => task.taskId),
    runnableActive: runnableActive.length,
    temporarilyUnavailableActive
  };
  if (!forceCandidates && runnableActive.length >= Math.max(0, Number(threshold) || 0)) {
    return {
      created: [],
      proposed: [],
      needsDirection: false,
      reason: "backlog threshold satisfied",
      active: active.length,
      runnableActive: runnableActive.length,
      ...resultShape,
      dependencyBlocked: [],
      dependencyDefects: []
    };
  }
  if (!forceCandidates && recoverableTechnical.length) {
    return {
      created: [],
      proposed: [],
      needsDirection: false,
      reason: "retryable operational work remains",
      active: active.length,
      runnableActive: runnableActive.length,
      ...resultShape,
      dependencyBlocked: [],
      dependencyDefects: []
    };
  }
  if (!forceCandidates && policyRevalidation.length) {
    return {
      created: [],
      proposed: [],
      needsDirection: false,
      reason: "timeout policy revalidation remains",
      active: active.length,
      runnableActive: runnableActive.length,
      ...resultShape,
      dependencyBlocked: [],
      dependencyDefects: []
    };
  }
  const sources = new Map();
  for (const candidate of candidates) sources.set(candidate.taskId, await sourceText(repositoryRoot, candidate));
  const known = new Set(tasks.flatMap((task) => [
    task.taskId,
    task.workSpec?.provenance?.key
  ].filter(Boolean)));
  const proposed = candidates
    .filter((candidate) => sources.get(candidate.taskId)?.includes(candidate.sourceAnchor))
    .filter((candidate) => !known.has(candidate.taskId) && !known.has(sourceKey(candidate)))
    .filter((candidate) => dependencyWaiting.get(candidate.taskId)?.satisfied !== false)
    .slice(0, Math.max(0, Number(maxTasks) || 0))
    .map((candidate) => ({
      ...candidate,
      provenance: sourceRecord(candidate, sources.get(candidate.taskId) || "")
    }));
  const credibleCandidates = candidates.filter((candidate) => sources.get(candidate.taskId)?.includes(candidate.sourceAnchor))
    .filter((candidate) => !known.has(candidate.taskId) && !known.has(sourceKey(candidate)))
    .filter((candidate) => dependencyWaiting.get(candidate.taskId)?.satisfied !== false);
  const dependencyBlocked = candidates
    .filter((candidate) => dependencyWaiting.get(candidate.taskId)?.satisfied === false)
    .map((candidate) => ({
      taskId: candidate.taskId,
      dependsOnTaskIds: candidate.dependsOnTaskIds || [],
      unmet: dependencyWaiting.get(candidate.taskId)?.unmet || []
    }));
  if (dryRun) {
    return {
      created: [],
      proposed,
      needsDirection: runnableActive.length === 0
        && proposed.length === 0
        && credibleCandidates.length === 0
        && retryableTechnical.length === 0
        && awaitingExternalEvidence.length === 0,
      reason: proposed.length ? "curated current TODO" : credibleCandidates.length ? "ready queue empty; roadmap candidates remain" : "fresh reconciliation found no credible roadmap work",
      active: active.length,
      runnableActive: runnableActive.length,
      ...resultShape,
      dependencyBlocked,
      dependencyDefects: dependencyDefects.defects
    };
  }
  const created = [];
  for (const candidate of proposed) {
    await addWorkTask(worldRoot, {
      taskId: candidate.taskId,
      owner,
      kind: "roadmap",
      title: candidate.title,
      promptText: candidate.prompt,
      acceptanceText: candidate.acceptance,
      contextText: `Pyash-first policy. Source: ${candidate.provenance.path}:${candidate.provenance.line}. Why now: ${candidate.whyNow}`,
      priority: candidate.priority,
      retryMax: 1,
      queuedAt: iso(now),
      workSpec: {
        granularity: "substantial",
        pyashFirst: true,
        provenance: candidate.provenance,
        packageId: candidate.taskId,
        dependsOnTaskIds: candidate.dependsOnTaskIds || [],
        whyMatters: candidate.whyMatters,
        dependencies: candidate.dependencies,
        intendedScope: candidate.scope,
        nonGoals: candidate.nonGoals
      }
    });
    created.push(candidate.taskId);
    known.add(candidate.taskId);
    known.add(candidate.provenance.key);
  }
  return {
    created,
    proposed,
    needsDirection: runnableActive.length === 0
      && created.length === 0
      && credibleCandidates.length === 0
      && retryableTechnical.length === 0
      && awaitingExternalEvidence.length === 0,
    reason: created.length ? "curated current TODO" : credibleCandidates.length ? "ready queue empty; roadmap candidates remain" : "fresh reconciliation found no credible roadmap work",
    active: active.length,
    runnableActive: runnableActive.length,
    ...resultShape,
    dependencyBlocked,
    dependencyDefects: dependencyDefects.defects
  };
}

export function curatedCandidates() {
  return autonomousRoadmapPackages();
}
