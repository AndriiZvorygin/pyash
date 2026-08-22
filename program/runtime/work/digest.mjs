import fs from "node:fs/promises";
import path from "node:path";

import { readCodexCapacity, calculateWeeklyPacing, DEFAULT_BACKGROUND_POLICY } from "./capacity.mjs";
import { curateWorkBacklog } from "./curator.mjs";
import { listWorkTasks } from "./operator.mjs";
import { readWorkSchedulerEvents } from "./history.mjs";
import { renderWorkTaskReport } from "./report.mjs";
import { deriveImplementationProgress } from "./progress.mjs";
import { buildAutonomousRoadmap, hasCredibleRoadmapWork, isRetryableWorkBlock, isAwaitingExternalEvidence, technicalRetryableItems } from "./roadmap.mjs";

function text(value) {
  return String(value ?? "").trim();
}

function dateValue(value, fallback = new Date()) {
  const date = value instanceof Date ? value : new Date(value || fallback);
  return Number.isFinite(date.getTime()) ? date : new Date(fallback);
}

function iso(value, fallback = new Date()) {
  return dateValue(value, fallback).toISOString();
}

function percent(value) {
  return value == null ? "unknown" : `${Math.round(Number(value) * 10) / 10}%`;
}

function digestPath(worldRoot) {
  return path.join(worldRoot, "holding", "work", "artifacts", "daily-digest.pya");
}

function quote(value) {
  return JSON.stringify(String(value ?? ""));
}

function mapBlock(entries) {
  return [
    "su name work daily digest state be map def",
    ...entries.map(([key, value]) => `  su name ${key} ob text ${quote(value)} ya`),
    "prah",
    ""
  ].join("\n");
}

function parseState(source) {
  const match = String(source ?? "").match(/su name work daily digest state be map def\n([\s\S]*?)\nprah/iu);
  const state = {};
  for (const line of String(match?.[1] || "").split("\n")) {
    const found = line.trim().match(/^su name (.+?) ob text (.+?) ya$/iu);
    if (!found) continue;
    try {
      state[found[1]] = JSON.parse(found[2]);
    } catch {
      state[found[1]] = found[2];
    }
  }
  return state;
}

export async function readWorkDailyDigestState(worldRoot) {
  try {
    return parseState(await fs.readFile(digestPath(worldRoot), "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return {};
    throw error;
  }
}

export async function writeWorkDailyDigestState(worldRoot, state = {}) {
  const target = digestPath(worldRoot);
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(temporary, mapBlock(Object.entries(state)), "utf8");
  await fs.rename(temporary, target);
  return state;
}

function taskTouched(task, start, end) {
  return [task.startedAt, task.finishedAt, task.queuedAt].some((value) => {
    const at = Date.parse(value);
    return Number.isFinite(at) && at >= start && at <= end;
  });
}

function compactReport(task) {
  const checkpoint = task.checkpoint || {};
  const progress = deriveImplementationProgress(checkpoint);
  const excerpt = (value, limit = 700) => {
    const body = text(value).replace(/\s+/gu, " ");
    return body.length <= limit ? body : `${body.slice(0, limit - 3)}...`;
  };
  return [
    `Task: ${task.title}`,
    `Task ID: ${task.taskId}`,
    `Result: ${String(task.status).toUpperCase()}`,
    `Sol plan: ${excerpt(checkpoint.plan?.summary || checkpoint.plan?.workOrder) || "(not recorded)"}`,
    `Luna implementation: ${excerpt(checkpoint.implementation?.summary) || "(not recorded)"}`,
    `Implementation passes: ${progress.implementationPasses}`,
    `Material-progress passes: ${progress.materialProgressPasses}`,
    `No-delta passes: ${progress.noProgressPasses}`,
    `Commits produced: ${progress.commitsProduced}`,
    `Acceptance checks closed: ${progress.acceptanceChecksClosed}`,
    `Last material progress: ${progress.lastMaterialProgressAt || "not recorded"}`,
    `Tests: ${(checkpoint.implementation?.tests || []).map((test) => excerpt(test, 280)).join("; ") || "(not recorded)"}`,
    `Sol review: ${checkpoint.review?.decision || "(not recorded)"} ${excerpt(checkpoint.review?.explanation, 280)}`,
    `Diff: ${renderWorkTaskReport(task).match(/^Diff: .*$/mu)?.[0]?.replace(/^Diff:\s*/u, "") || "not recorded"}`,
    checkpoint.workspace?.worktreePath ? `Worktree: ${checkpoint.workspace.worktreePath}` : "",
    checkpoint.implementation?.commit ? `Commit: ${checkpoint.implementation.commit}` : ""
  ].filter(Boolean).join("\n");
}

function uniqueRecoveryEvents(events) {
  const seen = new Set();
  return events.filter((event) => {
    const key = `${event.taskId || event.selected || ""}:${event.recoveryCount || event.at || ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function compactBlocker(value) {
  const body = text(value).replace(/\s+/gu, " ");
  if (!body) return "technical continuation required";
  if (/^awaiting external evidence:/iu.test(body)
    || (/(Ollama|live backend|fixture-free live|Matrix|CI|soak|real[- ]backend)/iu.test(body)
      && /unavailable|evidence|required|pending|remain/iu.test(body))) {
    return `external evidence required: ${body.replace(/^(?:awaiting external evidence:\s*)+/iu, "")}`;
  }
  if (/integration|cherry-pick|rebase|merge conflict/iu.test(body)) {
    return "integration conflict against current automation baseline";
  }
  if (/revision limit|\bREVISE\b|correction/iu.test(body)) {
    if (/compiled stream|streaming/iu.test(body) && /metadata|duplicates output|duplicate emission/iu.test(body)) {
      return "correction required: compiled streaming duplicates output and loses reply metadata";
    }
    if (/transpileCeremony|generated guard|successful nested call/iu.test(body)) {
      return "correction required: generated guard return truncates the successful compiled body";
    }
    if (/unconsumed tokens|duplicate singleton|stray/iu.test(body)) {
      return "correction required: compile validation must reject stray and duplicate cases";
    }
    const correction = body.match(/CORRECTION:\s*(.*?)(?:\s+-\s+|$)/iu)?.[1] || body;
    return `correction required: ${correction.slice(0, 220)}`;
  }
  if (/turn timeout|sandbox|execution environment|app-server/iu.test(body)) {
    return `technical continuation unavailable: ${body.slice(0, 180)}`;
  }
  if (/human decision|product decision|architectural decision|semantic choice/iu.test(body)) {
    return `human decision required: ${body.slice(0, 220)}`;
  }
  return `technical correction required: ${body.slice(0, 220)}`;
}

export function renderWorkDailyDigest({
  date,
  since,
  until,
  capacity = {},
  policy = DEFAULT_BACKGROUND_POLICY,
  events = [],
  tasks = [],
  curation = {},
  roadmap = null,
  automationBranch = "automation/roadmap",
  reportingGap = null
} = {}) {
  const weekly = capacity.weekly || {};
  const pacing = calculateWeeklyPacing(capacity, {
    reservePercent: policy.reservePercent,
    deadbandPercent: policy.pacingDeadbandPercent,
    now: until
  });
  const completed = tasks.filter((task) => task.status === "accepted" && taskTouched(task, Date.parse(since), Date.parse(until)));
  const active = tasks.filter((task) => !["accepted", "failed", "blocked"].includes(task.status));
  const ready = tasks.some((task) => task.status === "ready");
  const retryable = technicalRetryableItems(roadmap || {}).length
    ? technicalRetryableItems(roadmap || {})
    : tasks.filter((task) => isRetryableWorkBlock(task)).map((task) => ({ taskId: task.taskId, title: task.title, blocker: text(task.checkpoint?.blocker || task.message || task.error) }));
  const externalEvidence = roadmap?.externalEvidence?.length
    ? roadmap.externalEvidence
    : tasks.filter((task) => isAwaitingExternalEvidence(task)).map((task) => ({ taskId: task.taskId, title: task.title, blocker: text(task.checkpoint?.blocker || task.message || task.error) }));
  const wakes = events.filter((event) => ["idle", "deferred", "admitted", "technical-blocked"].includes(event.action));
  const admitted = events.filter((event) => event.action === "admitted");
  const bool = (value) => value === true || /^(true|truth|yes|1)$/iu.test(text(value));
  const workStarted = admitted;
  // Recovery and outcome records accompany a wake; count usefulness on the
  // wake record itself so one scheduler opportunity cannot count twice.
  const usefulWakes = wakes.filter((event) => bool(event.usefulWake));
  const materialProgressWakes = events.filter((event) => bool(event.materialProgress));
  const executionBlocked = events.filter((event) => event.action === "technical-blocked" && /execution environment|preflight|sandbox/iu.test(event.reason || ""));
  const technicalEvents = events.filter((event) => event.action === "technical-blocked" && !executionBlocked.includes(event));
  const legacyTechnicalWakes = events.filter((event) => (event.action === "idle" || event.action === "deferred") && /no eligible work/iu.test(event.reason || "") && retryable.length > 0);
  const deferred = events.filter((event) => event.action === "deferred" && !legacyTechnicalWakes.includes(event));
  const pacingDeferred = deferred.filter((event) => /pacing|reserve|usage[- ]limited|capacity/iu.test(event.reason || ""));
  const idle = events.filter((event) => event.action === "idle" && !legacyTechnicalWakes.includes(event));
  const technicalUnavailable = [...technicalEvents, ...legacyTechnicalWakes];
  const blockedBeforeModel = events.filter((event) => ["technical-blocked", "deferred"].includes(event.action)
    && !bool(event.workStarted)
    && !/pacing|reserve|usage[- ]limited|capacity/iu.test(event.reason || ""));
  const recovered = uniqueRecoveryEvents(events.filter((event) => event.action === "recovered"));
  const roadmapWork = hasCredibleRoadmapWork(roadmap || {});
  const humanDecisions = roadmap?.needsDecision || [];
  const exhausted = !roadmapWork && !retryable.length && !ready && !(curation.proposed || []).length;
  const runnableRoadmap = active.length > 0
    || ready
    || (roadmap?.packages || []).some((item) => ["ACTIVE", "QUEUED", "CANDIDATE"].includes(item.status))
    || (curation.proposed || []).length > 0;
  const blockedRoadmap = retryable.length > 0 || externalEvidence.length > 0 || humanDecisions.length > 0;
  const temporarilyBlocked = retryable.length > 0 && !runnableRoadmap;
  const status = exhausted
    ? "needs-direction"
    : runnableRoadmap
      ? blockedRoadmap
        ? "roadmap-partially-blocked"
        : active.length || admitted.length || completed.length ? "roadmap-active" : "roadmap-ready"
      : blockedRoadmap
      ? "roadmap-blocked"
      : completed.length
        ? "progress"
        : active.length
          ? "in-progress"
          : "idle";
  const subject = exhausted
    ? "Pyash needs direction: roadmap backlog exhausted"
    : status === "roadmap-blocked"
      ? "Pyash daily: roadmap work temporarily blocked"
      : completed.length
      ? `Pyash daily: substantial progress on ${completed[0].title}`
      : "Pyash daily: background development status";
  const lines = [
    "PYASH DAILY IMPROVEMENT REPORT",
    "",
    `Date: ${text(date) || dateValue(until).toISOString().slice(0, 10)}`,
    `Window: ${since} to ${until}`,
    ...(reportingGap?.hours >= 36 ? [
      "",
      "Reporting gap",
      "--------------",
      `No successful daily digest was recorded for ${reportingGap.hours} hours after ${reportingGap.previousAt}.`,
      "The scheduled report interval should be checked for a skipped or failed run."
    ] : []),
    "",
    "Weekly Codex budget",
    "-------------------",
    `Reset: ${text(weekly.resetAt) || "unknown"}`,
    `Start of window: ${text(weekly.windowStartAt) || "unknown"}`,
    `Current remaining: ${percent(weekly.remainingPercent)}`,
    `Current used: ${percent(weekly.usedPercent)}`,
    `Current pacing floor: ${percent(pacing.minimumRemainingPercent)}`,
    `Pacing headroom: ${percent(pacing.headroomPercent)}`,
    `Final reserve: ${percent(policy.reservePercent)}`,
    "",
    "Background scheduler",
    "--------------------",
    `Hourly wakes: ${wakes.length}`,
    `Admitted: ${admitted.length}`,
    `Work started: ${workStarted.length}`,
    `Useful wakes: ${usefulWakes.length} / ${wakes.length}`,
    `Material-progress wakes: ${materialProgressWakes.length}`,
    `Blocked before model: ${blockedBeforeModel.length}`,
    `Autonomous accepts: ${completed.length}`,
    `Automation commits integrated: ${completed.filter((task) => task.checkpoint?.integration?.status === "integrated").length}`,
    `Deferred for pacing/conditions: ${deferred.length}`,
    `Pacing deferred: ${pacingDeferred.length}`,
    `Execution-environment blocked: ${executionBlocked.length}`,
    `Technical continuation unavailable: ${technicalUnavailable.length}`,
    `Idle / no work: ${idle.length}`,
    `Operational recoveries: ${recovered.length}`,
    "",
    "Completed work",
    "--------------"
  ];
  if (completed.length) {
    for (const task of completed) lines.push("", compactReport(task));
  } else {
    lines.push("(none in this window)");
  }
  if (recovered.length) {
    lines.push("", "Operational recovery", "--------------------");
    for (const event of recovered.slice(-4)) {
      lines.push(
        `${event.taskId || event.selected}: ${event.reason || "recovered"}`,
        `Previous blocker: ${event.previousBlocker || "operational blocker"}`,
        `Recovery count: ${event.recoveryCount || "1"}`
      );
    }
  }
  lines.push("", "Current work", "------------");
  if (active.length) {
    for (const task of active.slice(0, 3)) {
      const progress = deriveImplementationProgress(task.checkpoint || {});
      lines.push(
        `${task.title} [${task.taskId}]`,
        `Status: ${task.status}`,
        `Phase: ${task.checkpoint?.interruption?.phase || task.status}`,
        `Implementation passes: ${progress.implementationPasses}`,
        `Material-progress passes: ${progress.materialProgressPasses}`,
        `No-delta passes: ${progress.noProgressPasses}`,
        `Commits produced: ${progress.commitsProduced}`,
        `Acceptance checks closed: ${progress.acceptanceChecksClosed}`,
        `Last material progress: ${progress.lastMaterialProgressAt || "not recorded"}`
      );
    }
  } else {
    lines.push("(none)");
  }
  if (exhausted) {
    lines.push("", "Needs direction", "---------------", "No active or ready substantial task remains, and current roadmap/TODO curation found no safe bounded next package.");
  } else if (temporarilyBlocked) {
    lines.push("", "ROADMAP WORK TEMPORARILY BLOCKED", "--------------------------------", "Roadmap work remains; operational failures are not roadmap completion.", completed.length
      ? `${completed.length === 1 ? "One substantial package completed today." : `${completed.length} substantial packages completed today.`} Additional roadmap work remains temporarily blocked.`
      : "No package completed today.", `Blocked packages: ${retryable.map((item) => `${item.taskId}: ${compactBlocker(item.blocker || item.progress)}`).join("; ")}`, "Next action: recover or retry the highest-value valid package.");
    const evidence = retryable.slice(0, 5).map((item) => {
      const task = tasks.find((candidate) => candidate.taskId === item.taskId);
      if (!task) return `  ${item.taskId}: progress checkpoint unavailable`;
      const progress = deriveImplementationProgress(task.checkpoint || {});
      return `  ${task.title}: ${progress.implementationPasses} passes; ${progress.materialProgressPasses} material; ${progress.noProgressPasses} no-delta; ${progress.commitsProduced} commits; last material ${progress.lastMaterialProgressAt || "not recorded"}`;
    });
    lines.push("", "Progress evidence", "-----------------", ...evidence);
  } else if (blockedRoadmap) {
    if (externalEvidence.length) {
      lines.push("", "External evidence waiting", "-------------------------", ...externalEvidence.slice(0, 5).map((item) => `  ${item.title || item.taskId}: ${compactBlocker(item.blocker || item.progress)}`));
    }
    if (runnableRoadmap) {
      const runnablePackages = (roadmap?.packages || []).filter((item) => ["ACTIVE", "QUEUED", "CANDIDATE"].includes(item.status));
      lines.push("", "Runnable roadmap", "-----------------", ...runnablePackages.slice(0, 4).map((item, index) => `${index === 0 ? "  Next: " : "  Later: "}${item.title}`));
    }
  } else if (!active.length && !ready && !curation.proposed?.length && roadmapWork) {
    lines.push("", "READY QUEUE EMPTY - RECONCILIATION REQUIRED", "--------------------------------------------", "The generated queue is empty, but the authoritative roadmap still contains unfinished packages.");
  } else if (curation.proposed?.length) {
    lines.push("", "Next likely work", "----------------", ...curation.proposed.slice(0, 3).map((item) => `${item.taskId}: ${item.title}`));
  }
  if (roadmap) {
    lines.push("", "ROADMAP", "-------", "Active:");
    const activePackages = (roadmap.packages || []).filter((item) => item.status === "ACTIVE");
    const queuedPackages = (roadmap.packages || []).filter((item) => item.status === "QUEUED");
    const candidatePackages = (roadmap.packages || []).filter((item) => item.status === "CANDIDATE");
    const blockedPackages = [
      ...(roadmap.packages || []).filter((item) => item.status === "BLOCKED / NEEDS DECISION"),
      ...humanDecisions
    ];
    const operationalPackages = [
      ...(roadmap.packages || []).filter((item) => item.status === "BLOCKED / OPERATIONAL"),
      ...technicalRetryableItems(roadmap).filter((item) => !(roadmap.packages || []).some((candidate) => candidate.taskId === item.taskId))
    ];
    const externalPackages = [
      ...(roadmap.packages || []).filter((item) => item.status === "BLOCKED / EXTERNAL EVIDENCE"),
      ...(roadmap.externalEvidence || []).filter((item) => !(roadmap.packages || []).some((candidate) => candidate.taskId === item.taskId))
    ];
    lines.push(...(activePackages.length ? activePackages.map((item) => `  ${item.title} — ${item.progress}`) : ["  (none)"]));
    lines.push("Next:", ...(queuedPackages.length ? queuedPackages.slice(0, 3).map((item) => `  ${item.title}`) : ["  (none)"]));
    lines.push("Later:", ...(candidatePackages.length ? candidatePackages.slice(0, 4).map((item) => `  ${item.title}`) : ["  (none)"]));
    lines.push("Operational blocks:", ...(operationalPackages.length ? operationalPackages.slice(0, 4).map((item) => `  ${item.title || item.taskId}: ${compactBlocker(item.blocker || item.progress)}`) : ["  (none)"]));
    lines.push("Awaiting external evidence:", ...(externalPackages.length ? externalPackages.slice(0, 4).map((item) => `  ${item.title || item.taskId}: ${compactBlocker(item.blocker || item.progress)}`) : ["  (none)"]));
    lines.push("Needs decision:", ...(blockedPackages.length ? blockedPackages.slice(0, 4).map((item) => `  ${item.title || item.taskId}: ${compactBlocker(item.blocker || item.progress)}`) : ["  (none)"]));
  }
  lines.push("", "Automation branch", "-----------------", automationBranch, `Commits integrated this window: ${completed.filter((task) => task.checkpoint?.integration?.status === "integrated").length}`);
  lines.push("", `Digest status: ${status.toUpperCase()}`, `Subject: ${subject}`, "");
  return { subject, status, report: lines.join("\n") };
}

export async function buildWorkDailyDigest({
  worldRoot,
  repositoryRoot = process.cwd(),
  since = "",
  until = "",
  now = () => new Date(),
  capacitySource = readCodexCapacity,
  policy = DEFAULT_BACKGROUND_POLICY,
  owner = "background",
  automationBranch = "automation/roadmap",
  persist = true
} = {}) {
  const current = dateValue(typeof now === "function" ? now() : now);
  const end = dateValue(until || current, current);
  const previous = await readWorkDailyDigestState(worldRoot);
  const previousReportAt = text(previous["last report at"]);
  const start = dateValue(since || previousReportAt || new Date(end.getFullYear(), end.getMonth(), end.getDate()), end);
  const reportingGap = !since && previousReportAt && end.getTime() - start.getTime() >= 36 * 60 * 60 * 1000
    ? {
      hours: Math.round((end.getTime() - start.getTime()) / (60 * 60 * 100)) / 10,
      previousAt: previousReportAt
    }
    : null;
  const [capacity, tasks, events, curation] = await Promise.all([
    capacitySource({ now: end }),
    listWorkTasks(worldRoot, { includeTerminal: true }),
    readWorkSchedulerEvents(worldRoot, { since: start.toISOString(), until: end.toISOString() }),
    curateWorkBacklog({ worldRoot, repositoryRoot, owner, threshold: policy.curationThreshold, maxTasks: policy.curationMaxTasks, dryRun: true, now: end })
  ]);
  const roadmap = await buildAutonomousRoadmap({
    worldRoot,
    repositoryRoot,
    tasks,
    now: end,
    persist
  });
  const rendered = renderWorkDailyDigest({
    date: end.toISOString().slice(0, 10),
    since: start.toISOString(),
    until: end.toISOString(),
    capacity,
    policy,
    events,
    tasks,
    curation,
    roadmap,
    automationBranch,
    reportingGap
  });
  if (persist) {
    await writeWorkDailyDigestState(worldRoot, {
      "last report at": end.toISOString(),
      "last subject": rendered.subject,
      status: rendered.status
    });
  }
  return { ...rendered, since: start.toISOString(), until: end.toISOString(), capacity, tasks, events, curation, roadmap };
}
