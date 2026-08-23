import fs from "node:fs/promises";
import path from "node:path";

import { addWorkTask, listWorkTasks } from "./operator.mjs";
import { findRecoverableOperationalWorkTasks } from "./recovery.mjs";
import { autonomousRoadmapPackages, isAwaitingExternalEvidence, isRetryableWorkBlock } from "./roadmap.mjs";

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

export async function curateWorkBacklog({
  worldRoot,
  repositoryRoot = process.cwd(),
  owner = "background",
  threshold = 1,
  maxTasks = 3,
  dryRun = false,
  staleTurnMs,
  maxRecoveryCount,
  now = () => new Date()
} = {}) {
  const tasks = await listWorkTasks(worldRoot, { includeTerminal: true });
  const active = tasks.filter((task) => !["accepted", "failed", "blocked"].includes(task.status));
  const retryableTechnical = tasks.filter((task) => isRetryableWorkBlock(task));
  const recoverableTechnical = await findRecoverableOperationalWorkTasks(worldRoot, {
    owner,
    now,
    staleTurnMs,
    maxRecoveryCount
  });
  const recoverableIds = new Set(recoverableTechnical.map((task) => task.taskId));
  const temporarilyUnexecutableTechnical = retryableTechnical
    .filter((task) => !recoverableIds.has(task.taskId))
    .map((task) => task.taskId);
  const awaitingExternalEvidence = tasks.filter((task) => isAwaitingExternalEvidence(task));
  const resultShape = {
    retryableTechnical: retryableTechnical.map((task) => task.taskId),
    retryable: retryableTechnical.map((task) => task.taskId),
    recoverableTechnical: recoverableTechnical.map((task) => task.taskId),
    temporarilyUnexecutableTechnical,
    awaitingExternalEvidence: awaitingExternalEvidence.map((task) => task.taskId)
  };
  if (active.length >= Math.max(0, Number(threshold) || 0)) {
    return {
      created: [],
      proposed: [],
      needsDirection: false,
      reason: "backlog threshold satisfied",
      active: active.length,
      ...resultShape
    };
  }
  if (recoverableTechnical.length) {
    return {
      created: [],
      proposed: [],
      needsDirection: false,
      reason: "retryable operational work remains",
      active: active.length,
      ...resultShape
    };
  }
  const candidates = autonomousRoadmapPackages();
  const sources = new Map();
  for (const candidate of candidates) sources.set(candidate.taskId, await sourceText(repositoryRoot, candidate));
  const known = new Set(tasks.flatMap((task) => [
    task.taskId,
    task.workSpec?.provenance?.key
  ].filter(Boolean)));
  const proposed = candidates
    .filter((candidate) => sources.get(candidate.taskId)?.includes(candidate.sourceAnchor))
    .filter((candidate) => !known.has(candidate.taskId) && !known.has(sourceKey(candidate)))
    .slice(0, Math.max(0, Number(maxTasks) || 0))
    .map((candidate) => ({
      ...candidate,
      provenance: sourceRecord(candidate, sources.get(candidate.taskId) || "")
    }));
  const credibleCandidates = candidates.filter((candidate) => sources.get(candidate.taskId)?.includes(candidate.sourceAnchor))
    .filter((candidate) => !known.has(candidate.taskId) && !known.has(sourceKey(candidate)));
  if (dryRun) {
    return {
      created: [],
      proposed,
      needsDirection: active.length === 0
        && proposed.length === 0
        && credibleCandidates.length === 0
        && retryableTechnical.length === 0
        && awaitingExternalEvidence.length === 0,
      reason: proposed.length ? "curated current TODO" : credibleCandidates.length ? "ready queue empty; roadmap candidates remain" : "fresh reconciliation found no credible roadmap work",
      active: active.length,
      ...resultShape
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
    needsDirection: active.length === 0
      && created.length === 0
      && credibleCandidates.length === 0
      && retryableTechnical.length === 0
      && awaitingExternalEvidence.length === 0,
    reason: created.length ? "curated current TODO" : credibleCandidates.length ? "ready queue empty; roadmap candidates remain" : "fresh reconciliation found no credible roadmap work",
    active: active.length,
    ...resultShape
  };
}

export function curatedCandidates() {
  return autonomousRoadmapPackages();
}
