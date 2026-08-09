import fs from "node:fs/promises";
import path from "node:path";

import { readCodexCapacity, calculateWeeklyPacing, DEFAULT_BACKGROUND_POLICY } from "./capacity.mjs";
import { curateWorkBacklog } from "./curator.mjs";
import { listWorkTasks } from "./operator.mjs";
import { readWorkSchedulerEvents } from "./history.mjs";
import { renderWorkTaskReport } from "./report.mjs";

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
  const report = renderWorkTaskReport(task).split("\n");
  const keep = report.filter((line) => /^(Task:|Task ID:|Result:|Sol plan:|Luna implementation:|Sol review:|Diff:|Automation branch:|Integration:|Commit:|Worktree:)/u.test(line));
  return keep.join("\n");
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
  automationBranch = "automation/roadmap"
} = {}) {
  const weekly = capacity.weekly || {};
  const pacing = calculateWeeklyPacing(capacity, {
    reservePercent: policy.reservePercent,
    deadbandPercent: policy.pacingDeadbandPercent,
    now: until
  });
  const completed = tasks.filter((task) => task.status === "accepted" && taskTouched(task, Date.parse(since), Date.parse(until)));
  const active = tasks.filter((task) => !["accepted", "failed", "blocked"].includes(task.status));
  const wakes = events.filter((event) => event.action === "idle" || event.action === "deferred" || event.action === "admitted");
  const admitted = events.filter((event) => event.action === "admitted");
  const deferred = events.filter((event) => event.action === "deferred");
  const idle = events.filter((event) => event.action === "idle");
  const exhausted = active.length === 0 && !tasks.some((task) => task.status === "ready") && !(curation.proposed || []).length;
  const status = exhausted ? "needs-direction" : completed.length ? "progress" : active.length ? "in-progress" : "idle";
  const subject = exhausted
    ? "Pyash needs direction: roadmap backlog exhausted"
    : completed.length
      ? `Pyash daily: substantial progress on ${completed[0].title}`
      : "Pyash daily: background development status";
  const lines = [
    "PYASH DAILY IMPROVEMENT REPORT",
    "",
    `Date: ${text(date) || dateValue(until).toISOString().slice(0, 10)}`,
    `Window: ${since} to ${until}`,
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
    `Deferred for pacing/conditions: ${deferred.length}`,
    `Idle: ${idle.length}`,
    "",
    "Completed work",
    "--------------"
  ];
  if (completed.length) {
    for (const task of completed) lines.push("", compactReport(task));
  } else {
    lines.push("(none in this window)");
  }
  lines.push("", "Current work", "------------");
  if (active.length) {
    for (const task of active.slice(0, 3)) {
      lines.push(`${task.title} [${task.taskId}]`, `Status: ${task.status}`, `Phase: ${task.checkpoint?.interruption?.phase || task.status}`, `Progress passes: ${task.checkpoint?.implementation?.passes || 0}`);
    }
  } else {
    lines.push("(none)");
  }
  if (exhausted) {
    lines.push("", "Needs direction", "---------------", "No active or ready substantial task remains, and current roadmap/TODO curation found no safe bounded next package.");
  } else if (curation.proposed?.length) {
    lines.push("", "Next likely work", "----------------", ...curation.proposed.slice(0, 3).map((item) => `${item.taskId}: ${item.title}`));
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
  const start = dateValue(since || previous["last report at"] || new Date(end.getFullYear(), end.getMonth(), end.getDate()), end);
  const [capacity, tasks, events, curation] = await Promise.all([
    capacitySource({ now: end }),
    listWorkTasks(worldRoot, { includeTerminal: true }),
    readWorkSchedulerEvents(worldRoot, { since: start.toISOString(), until: end.toISOString() }),
    curateWorkBacklog({ worldRoot, repositoryRoot, owner, threshold: policy.curationThreshold, maxTasks: policy.curationMaxTasks, dryRun: true, now: end })
  ]);
  const rendered = renderWorkDailyDigest({
    date: end.toISOString().slice(0, 10),
    since: start.toISOString(),
    until: end.toISOString(),
    capacity,
    policy,
    events,
    tasks,
    curation,
    automationBranch
  });
  if (persist) {
    await writeWorkDailyDigestState(worldRoot, {
      "last report at": end.toISOString(),
      "last subject": rendered.subject,
      status: rendered.status
    });
  }
  return { ...rendered, since: start.toISOString(), until: end.toISOString(), capacity, tasks, events, curation };
}
