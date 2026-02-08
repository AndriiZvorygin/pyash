import fs from "node:fs/promises";
import path from "node:path";

import { splitSentences } from "../library/sentenceSplitter.mjs";
import { parse } from "../understand/index.mjs";
import { sentenceToPyash } from "../beautiful.mjs";

const LANE_PATTERN = /^(.+?)\s+lane$/i;
const CALENDAR_FILENAMES = ["calendar.pya", "schedule.pya"];

function sanitizeLaneName(raw) {
  const text = String(raw ?? "").trim().toLowerCase();
  if (!text) return "session";
  const compact = text
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return compact || "session";
}

function parseIntervalFromDuring(duringCase) {
  if (!duringCase || typeof duringCase !== "object") return null;
  const minuteRaw = duringCase.minute;
  if (Number.isFinite(minuteRaw) && minuteRaw > 0) return Math.floor(minuteRaw) * 60 * 1000;
  const secondRaw = duringCase.second;
  if (Number.isFinite(secondRaw) && secondRaw > 0) return Math.floor(secondRaw) * 1000;
  const hourRaw = duringCase.hour;
  if (Number.isFinite(hourRaw) && hourRaw > 0) return Math.floor(hourRaw) * 60 * 60 * 1000;
  const dayRaw = duringCase.day;
  if (Number.isFinite(dayRaw) && dayRaw > 0) return Math.floor(dayRaw) * 24 * 60 * 60 * 1000;
  const minuteText = Number(String(duringCase.minute ?? "").trim());
  if (Number.isFinite(minuteText) && minuteText > 0) return Math.floor(minuteText) * 60 * 1000;
  const secondText = Number(String(duringCase.second ?? "").trim());
  if (Number.isFinite(secondText) && secondText > 0) return Math.floor(secondText) * 1000;
  const hourText = Number(String(duringCase.hour ?? "").trim());
  if (Number.isFinite(hourText) && hourText > 0) return Math.floor(hourText) * 60 * 60 * 1000;
  const dayText = Number(String(duringCase.day ?? "").trim());
  if (Number.isFinite(dayText) && dayText > 0) return Math.floor(dayText) * 24 * 60 * 60 * 1000;
  return null;
}

function parseIntervalFromPer(perCase) {
  return parseIntervalFromDuring(perCase);
}

function parseCalendarIntervalMs(sentence) {
  return parseIntervalFromPer(sentence?.per) ?? parseIntervalFromDuring(sentence?.during);
}

function parseLaneSubject(subjectText) {
  const text = String(subjectText ?? "").trim();
  const match = text.match(LANE_PATTERN);
  if (!match) return null;
  return match[1].trim();
}

function normalizeToolsCase(withCase) {
  if (!withCase || typeof withCase !== "object") return { wo: "tools" };
  if (withCase.wo === "tools" || withCase.text === "tools") return { wo: "tools" };
  if (typeof withCase.name === "string" && withCase.name.trim()) return { name: withCase.name.trim() };
  return { wo: "tools" };
}

export function parseSchedulePolicyText(text, { defaultAgentName } = {}) {
  const laneOverrides = new Map();
  const jobs = new Map();
  const sentences = splitSentences(String(text ?? ""));
  for (const line of sentences) {
    let sentence;
    try {
      sentence = parse(line);
    } catch {
      continue;
    }
    if (!sentence || sentence.mood !== "ya") continue;
    const subjectName = sentence?.su?.name;
    if (!subjectName) continue;

    if (sentence.be === "calendar") {
      const jobName = String(subjectName).trim();
      if (!jobName) continue;
      const intervalMs = parseCalendarIntervalMs(sentence);
      if (!intervalMs) continue;
      jobs.set(jobName, {
        jobName,
        intervalMs,
        agentName: sentence?.for?.name ?? defaultAgentName ?? null,
        prompt: sentence?.ob?.text ?? "",
        withCase: normalizeToolsCase(sentence?.with)
      });
      continue;
    }

    const laneJobName = parseLaneSubject(subjectName);
    if (!laneJobName) continue;
    if (typeof sentence?.ob?.text !== "string" || !sentence.ob.text.trim()) continue;
    laneOverrides.set(laneJobName, sentence.ob.text.trim());
  }

  const parsedJobs = Array.from(jobs.values())
    .map((job) => {
      const laneRaw = laneOverrides.get(job.jobName) ?? job.jobName;
      return {
        ...job,
        laneName: sanitizeLaneName(laneRaw)
      };
    })
    .filter(job => job.agentName)
    .sort((a, b) => a.jobName.localeCompare(b.jobName, "en"));

  return parsedJobs;
}

export async function loadSchedulePolicy({ agentHouse, agentName } = {}) {
  if (!agentHouse || !agentName) return [];
  const conductDir = path.join(agentHouse, "conduct");
  return loadSchedulePolicyFromConductDir(conductDir, { defaultAgentName: agentName });
}

export async function loadSchedulePolicyFromPath(schedulePath, { defaultAgentName } = {}) {
  let text = "";
  try {
    text = await fs.readFile(schedulePath, "utf8");
  } catch (err) {
    if (err?.code === "ENOENT") return [];
    throw err;
  }
  return parseSchedulePolicyText(text, { defaultAgentName });
}

function scheduleKey(job) {
  const agentName = String(job?.agentName ?? "").trim().toLowerCase();
  const jobName = String(job?.jobName ?? "").trim().toLowerCase();
  return `${agentName}::${jobName}`;
}

export function mergeSchedulePolicies(baseJobs = [], overrideJobs = []) {
  const merged = new Map();
  for (const job of baseJobs) {
    const key = scheduleKey(job);
    if (!key || key === "::") continue;
    merged.set(key, job);
  }
  for (const job of overrideJobs) {
    const key = scheduleKey(job);
    if (!key || key === "::") continue;
    merged.set(key, job);
  }
  return Array.from(merged.values()).sort((a, b) => {
    const agentCmp = String(a.agentName).localeCompare(String(b.agentName), "en");
    if (agentCmp !== 0) return agentCmp;
    return String(a.jobName).localeCompare(String(b.jobName), "en");
  });
}

export async function loadSchedulePolicyWithGlobal({
  worldRoot,
  agentHouse,
  agentName
} = {}) {
  const globalConductDir = worldRoot ? path.join(worldRoot, "conduct") : null;
  const [globalJobs, agentJobs] = await Promise.all([
    globalConductDir ? loadSchedulePolicyFromConductDir(globalConductDir, { defaultAgentName: null }) : Promise.resolve([]),
    loadSchedulePolicy({ agentHouse, agentName })
  ]);
  const scopedGlobal = globalJobs.filter(job => job.agentName === agentName);
  return mergeSchedulePolicies(scopedGlobal, agentJobs);
}

async function listAgentNames(worldRoot) {
  if (!worldRoot) return [];
  const houseDir = path.join(worldRoot, "house");
  let entries;
  try {
    entries = await fs.readdir(houseDir, { withFileTypes: true });
  } catch (err) {
    if (err?.code === "ENOENT") return [];
    throw err;
  }
  return entries
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort((a, b) => a.localeCompare(b, "en"));
}

export async function discoverScheduledJobs({ worldRoot } = {}) {
  if (!worldRoot) return [];
  const globalConductDir = path.join(worldRoot, "conduct");
  const globalJobs = await loadSchedulePolicyFromConductDir(globalConductDir, { defaultAgentName: null });
  const agentNamesFromGlobal = new Set(globalJobs.map(job => job.agentName).filter(Boolean));
  const agentNamesFromHouse = await listAgentNames(worldRoot);
  for (const name of agentNamesFromHouse) agentNamesFromGlobal.add(name);

  const allAgentNames = [...agentNamesFromGlobal].sort((a, b) => a.localeCompare(b, "en"));
  const mergedJobs = [];
  for (const agentName of allAgentNames) {
    const agentHouse = path.join(worldRoot, "house", agentName);
    const jobs = await loadSchedulePolicyWithGlobal({ worldRoot, agentHouse, agentName });
    mergedJobs.push(...jobs);
  }
  return mergedJobs.sort((a, b) => {
    const agentCmp = String(a.agentName).localeCompare(String(b.agentName), "en");
    if (agentCmp !== 0) return agentCmp;
    return String(a.jobName).localeCompare(String(b.jobName), "en");
  });
}

export async function loadSchedulePolicyFromConductDir(conductDir, { defaultAgentName } = {}) {
  if (!conductDir) return [];
  for (const filename of CALENDAR_FILENAMES) {
    const policyPath = path.join(conductDir, filename);
    try {
      await fs.access(policyPath);
    } catch (err) {
      if (err?.code === "ENOENT") continue;
      throw err;
    }
    return loadSchedulePolicyFromPath(policyPath, { defaultAgentName });
  }
  return [];
}

function createStats(job) {
  return {
    jobName: job.jobName,
    laneName: job.laneName,
    intervalMs: job.intervalMs,
    runs: 0,
    skips: 0,
    lastDurationMs: 0,
    avgDurationMs: 0,
    utilizationPct: 0,
    enabled: true,
    running: false,
    lastStart: null,
    lastEnd: null,
    lastError: null
  };
}

async function appendTelemetryLine(telemetryPath, entry) {
  if (!telemetryPath) return;
  await fs.mkdir(path.dirname(telemetryPath), { recursive: true });
  const sentence = {
    mood: "ya",
    su: { name: entry?.job ?? "scheduler" },
    be: "scheduler telemetry",
    as: { name: entry?.event ?? "run" },
    during: { date: entry?.ts ?? new Date().toISOString() },
    ob: { text: JSON.stringify(entry ?? {}) }
  };
  await fs.appendFile(telemetryPath, `${sentenceToPyash(sentence)}\n`, "utf8");
}

export function createScheduler({
  jobs = [],
  runJob,
  isJobEnabled = null,
  telemetryPath = null,
  now = () => Date.now(),
  onError = null
} = {}) {
  if (typeof runJob !== "function") throw new Error("runJob callback is required");
  const statsByJob = new Map();
  const timers = new Map();
  const tasks = new Set();

  for (const job of jobs) {
    statsByJob.set(job.jobName, createStats(job));
  }

  async function tick(job) {
    const stats = statsByJob.get(job.jobName);
    if (!stats) return null;
    if (typeof isJobEnabled === "function") {
      const enabled = await isJobEnabled(job);
      stats.enabled = enabled !== false;
      if (!stats.enabled) {
        const skipped = {
          ts: new Date(now()).toISOString(),
          job: job.jobName,
          lane: job.laneName,
          event: "skip_disabled"
        };
        const task = appendTelemetryLine(telemetryPath, skipped).catch((err) => {
          if (onError) onError(err);
        });
        tasks.add(task);
        task.finally(() => tasks.delete(task));
        return { skipped: true, reason: "disabled" };
      }
    } else {
      stats.enabled = true;
    }
    if (stats.running) {
      stats.skips += 1;
      const skipped = {
        ts: new Date(now()).toISOString(),
        job: job.jobName,
        lane: job.laneName,
        event: "skip_overlap",
        skips: stats.skips
      };
      const task = appendTelemetryLine(telemetryPath, skipped).catch((err) => {
        if (onError) onError(err);
      });
      tasks.add(task);
      task.finally(() => tasks.delete(task));
      return { skipped: true, reason: "overlap" };
    }

    stats.running = true;
    stats.lastError = null;
    const startedAt = now();
    stats.lastStart = new Date(startedAt).toISOString();
    try {
      const result = await runJob(job);
      const endedAt = now();
      const durationMs = Math.max(0, endedAt - startedAt);
      stats.runs += 1;
      stats.lastDurationMs = durationMs;
      stats.avgDurationMs = ((stats.avgDurationMs * (stats.runs - 1)) + durationMs) / stats.runs;
      stats.utilizationPct = job.intervalMs > 0
        ? Number(((stats.avgDurationMs / job.intervalMs) * 100).toFixed(2))
        : 0;
      stats.lastEnd = new Date(endedAt).toISOString();
      const completed = {
        ts: stats.lastEnd,
        job: job.jobName,
        lane: job.laneName,
        event: "run",
        durationMs,
        runs: stats.runs,
        skips: stats.skips,
        utilizationPct: stats.utilizationPct,
        status: result?.status ?? "ok"
      };
      const task = appendTelemetryLine(telemetryPath, completed).catch((err) => {
        if (onError) onError(err);
      });
      tasks.add(task);
      task.finally(() => tasks.delete(task));
      return { skipped: false, durationMs, result };
    } catch (err) {
      stats.lastError = String(err?.message ?? err);
      const failed = {
        ts: new Date(now()).toISOString(),
        job: job.jobName,
        lane: job.laneName,
        event: "error",
        message: stats.lastError
      };
      const task = appendTelemetryLine(telemetryPath, failed).catch((ioErr) => {
        if (onError) onError(ioErr);
      });
      tasks.add(task);
      task.finally(() => tasks.delete(task));
      if (onError) onError(err);
      return { skipped: false, error: err };
    } finally {
      stats.running = false;
    }
  }

  function start() {
    for (const job of jobs) {
      const timer = setInterval(() => {
        void tick(job);
      }, job.intervalMs);
      timers.set(job.jobName, timer);
    }
  }

  function stop() {
    for (const timer of timers.values()) {
      clearInterval(timer);
    }
    timers.clear();
  }

  async function runNow({ jobName = null } = {}) {
    const selected = jobName
      ? jobs.filter(job => job.jobName === jobName)
      : jobs;
    const results = [];
    for (const job of selected) {
      results.push(await tick(job));
    }
    return results;
  }

  async function flushTelemetry() {
    if (!tasks.size) return;
    await Promise.allSettled(Array.from(tasks));
  }

  function snapshot() {
    return jobs.map(job => {
      const stats = statsByJob.get(job.jobName);
      return {
        jobName: job.jobName,
        laneName: job.laneName,
        intervalMs: job.intervalMs,
        runs: stats?.runs ?? 0,
        skips: stats?.skips ?? 0,
        lastDurationMs: stats?.lastDurationMs ?? 0,
        avgDurationMs: stats?.avgDurationMs ?? 0,
        utilizationPct: stats?.utilizationPct ?? 0,
        enabled: stats?.enabled !== false,
        running: !!stats?.running,
        lastError: stats?.lastError ?? null
      };
    });
  }

  return {
    start,
    stop,
    runNow,
    snapshot,
    flushTelemetry
  };
}
