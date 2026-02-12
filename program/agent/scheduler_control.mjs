import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawn } from "node:child_process";
import { discoverScheduledJobs } from "./scheduler.mjs";
import { isServiceEnabled, normalizeSchedulerServiceName, setServiceEnabled } from "./scheduler_service_control.mjs";

function controlDir(worldRoot) {
  return path.join(worldRoot, "conduct");
}

function presenceDir(worldRoot) {
  return path.join(worldRoot, "presence");
}

function pidPath(worldRoot) {
  return path.join(presenceDir(worldRoot), "scheduler.pid");
}

function healthPath(worldRoot) {
  return path.join(controlDir(worldRoot), "health.pya");
}

function legacyStatusPath(worldRoot) {
  return path.join(controlDir(worldRoot), "scheduler.status.json");
}

function daemonLogPath(worldRoot) {
  return path.join(controlDir(worldRoot), "scheduler.log");
}

function daemonScriptPath() {
  return fileURLToPath(new URL("../../command/scheduler_daemon.mjs", import.meta.url));
}

function quotePyashText(value) {
  return JSON.stringify(String(value ?? ""));
}

function parsePyashQuotedText(value) {
  try {
    return JSON.parse(value);
  } catch {
    return String(value ?? "");
  }
}

async function readHealthFile(filePath) {
  try {
    const text = await fs.readFile(filePath, "utf8");
    const fallback = {
      running: false,
      pid: 0,
      worldRoot: "",
      startedAt: "",
      updatedAt: "",
      stoppedAt: "",
      jobsCount: 0,
      jobs: []
    };
    const blockPattern = /su name (.+?) be map def\n([\s\S]*?)\nprah/g;
    const blocks = new Map();
    for (const match of String(text).matchAll(blockPattern)) {
      blocks.set(String(match[1]).trim(), String(match[2] ?? ""));
    }
    const parseMap = (body) => {
      const out = {};
      for (const raw of String(body ?? "").split("\n")) {
        const line = raw.trim();
        if (!line) continue;
        const m = line.match(/^su name (.+?) ob (bool|num|text|filename) (.+?) ya$/i);
        if (!m) continue;
        const key = String(m[1]).trim();
        const type = String(m[2]).toLowerCase();
        const valueRaw = String(m[3]).trim();
        if (type === "bool") {
          out[key] = /^truth$/i.test(valueRaw);
          continue;
        }
        if (type === "num") {
          const n = Number(valueRaw);
          out[key] = Number.isFinite(n) ? n : 0;
          continue;
        }
        if (type === "text" || type === "filename") {
          out[key] = parsePyashQuotedText(valueRaw);
        }
      }
      return out;
    };
    const healthMap = parseMap(blocks.get("scheduler health"));
    const jobsCount = Math.max(0, Number(healthMap["jobs count"] ?? 0) || 0);
    const jobs = [];
    for (let i = 1; i <= jobsCount; i += 1) {
      const jobMap = parseMap(blocks.get(`scheduler job ${i}`));
      if (!jobMap["job name"]) continue;
      jobs.push({
        jobName: String(jobMap["job name"] ?? ""),
        laneName: String(jobMap["lane name"] ?? ""),
        intervalMs: Number(jobMap["interval ms"] ?? 0) || 0,
        runs: Number(jobMap.runs ?? 0) || 0,
        skips: Number(jobMap.skips ?? 0) || 0,
        lastDurationMs: Number(jobMap["last duration ms"] ?? 0) || 0,
        avgDurationMs: Number(jobMap["avg duration ms"] ?? 0) || 0,
        utilizationPct: Number(jobMap["utilization pct"] ?? 0) || 0,
        overlapPct: Number(jobMap["overlap pct"] ?? 0) || 0,
        errorCount: Number(jobMap["error count"] ?? 0) || 0,
        consecutiveErrors: Number(jobMap["consecutive errors"] ?? 0) || 0,
        enabled: Boolean(jobMap.enabled),
        running: Boolean(jobMap.running),
        lastStatus: String(jobMap["last status"] ?? ""),
        lastError: String(jobMap["last error"] ?? "")
      });
    }
    return {
      ...fallback,
      running: Boolean(healthMap.running),
      pid: Number(healthMap.pid ?? 0) || 0,
      worldRoot: String(healthMap["world root"] ?? ""),
      startedAt: String(healthMap["started at"] ?? ""),
      updatedAt: String(healthMap["updated at"] ?? ""),
      stoppedAt: String(healthMap["stopped at"] ?? ""),
      jobsCount,
      jobs
    };
  } catch (err) {
    if (err?.code === "ENOENT") {
      return {
        running: false,
        pid: 0,
        worldRoot: "",
        startedAt: "",
        updatedAt: "",
        stoppedAt: "",
        jobsCount: 0,
        jobs: []
      };
    }
    throw err;
  }
}

async function writeHealthFile(filePath, value) {
  const mapBlock = (name, entries) => {
    const lines = [`su name ${name} be map def`];
    for (const entry of entries) {
      lines.push(`  su name ${entry.key} ob ${entry.type} ${entry.value} ya`);
    }
    lines.push("prah");
    return lines.join("\n");
  };
  const jobs = Array.isArray(value.jobs) ? value.jobs : [];
  const lines = [mapBlock("scheduler health", [
    { key: "running", type: "bool", value: value.running ? "truth" : "lie" },
    { key: "pid", type: "num", value: Number.isFinite(value.pid) ? Math.floor(value.pid) : 0 },
    { key: "world root", type: "filename", value: quotePyashText(value.worldRoot || "") },
    { key: "jobs count", type: "num", value: Math.max(0, Math.floor(Number(value.jobsCount) || 0)) },
    { key: "started at", type: "text", value: quotePyashText(value.startedAt || "") },
    { key: "updated at", type: "text", value: quotePyashText(value.updatedAt || "") },
    { key: "stopped at", type: "text", value: quotePyashText(value.stoppedAt || "") }
  ])];
  for (let i = 0; i < jobs.length; i += 1) {
    const job = jobs[i] ?? {};
    lines.push(mapBlock(`scheduler job ${i + 1}`, [
      { key: "job name", type: "text", value: quotePyashText(job.jobName || "") },
      { key: "lane name", type: "text", value: quotePyashText(job.laneName || "") },
      { key: "interval ms", type: "num", value: Number(job.intervalMs || 0) || 0 },
      { key: "runs", type: "num", value: Number(job.runs || 0) || 0 },
      { key: "skips", type: "num", value: Number(job.skips || 0) || 0 },
      { key: "last duration ms", type: "num", value: Number(job.lastDurationMs || 0) || 0 },
      { key: "avg duration ms", type: "num", value: Number(job.avgDurationMs || 0) || 0 },
      { key: "utilization pct", type: "num", value: Number(job.utilizationPct || 0) || 0 },
      { key: "overlap pct", type: "num", value: Number(job.overlapPct || 0) || 0 },
      { key: "error count", type: "num", value: Number(job.errorCount || 0) || 0 },
      { key: "consecutive errors", type: "num", value: Number(job.consecutiveErrors || 0) || 0 },
      { key: "enabled", type: "bool", value: job.enabled ? "truth" : "lie" },
      { key: "running", type: "bool", value: job.running ? "truth" : "lie" },
      { key: "last status", type: "text", value: quotePyashText(job.lastStatus || "") },
      { key: "last error", type: "text", value: quotePyashText(job.lastError || "") }
    ]));
  }
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${lines.join("\n")}\n`, "utf8");
}

async function readPid(worldRoot) {
  try {
    const text = await fs.readFile(pidPath(worldRoot), "utf8");
    const pid = Number.parseInt(String(text).trim(), 10);
    if (!Number.isFinite(pid) || pid <= 0) return null;
    return pid;
  } catch (err) {
    if (err?.code === "ENOENT") return null;
    throw err;
  }
}

function isPidAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function escapeRegExp(value) {
  return String(value ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function listSchedulerDaemonPids({ worldRoot } = {}) {
  const targetWorldRoot = path.resolve(String(worldRoot ?? ""));
  const scriptPath = daemonScriptPath();
  const worldFlagPattern = new RegExp(`--world-root(?:\\s+|=)${escapeRegExp(targetWorldRoot)}(?:\\s|$)`);
  try {
    const output = execFileSync("ps", ["-eo", "pid=,args="], { encoding: "utf8" });
    const pids = [];
    for (const rawLine of String(output).split("\n")) {
      const line = rawLine.trim();
      if (!line) continue;
      const match = line.match(/^(\d+)\s+([\s\S]+)$/);
      if (!match) continue;
      const pid = Number.parseInt(match[1], 10);
      const argsText = String(match[2] ?? "");
      if (!Number.isFinite(pid) || pid <= 0) continue;
      if (!argsText.includes(scriptPath)) continue;
      if (!argsText.includes("--run")) continue;
      if (!worldFlagPattern.test(argsText)) continue;
      pids.push(pid);
    }
    return [...new Set(pids)].filter(isPidAlive).sort((a, b) => a - b);
  } catch {
    return [];
  }
}

async function stopSchedulerPids(pids = []) {
  const normalized = [...new Set((Array.isArray(pids) ? pids : [])
    .map((value) => Number.parseInt(String(value), 10))
    .filter((value) => Number.isFinite(value) && value > 0))];
  if (normalized.length === 0) return { pids: [], stopped: true };
  for (const pid of normalized) {
    if (!isPidAlive(pid)) continue;
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // ignore dead pid races
    }
  }
  const checks = await Promise.all(normalized.map(async (pid) => ({
    pid,
    stopped: await waitForStop(pid)
  })));
  return {
    pids: checks.map(entry => entry.pid),
    stopped: checks.every(entry => entry.stopped)
  };
}

export async function schedulerHealth({ worldRoot } = {}) {
  const pid = await readPid(worldRoot);
  const daemonPids = listSchedulerDaemonPids({ worldRoot });
  const alive = isPidAlive(pid);
  const activePid = daemonPids[0] ?? (alive ? pid : null);
  if (activePid && activePid !== pid) {
    await fs.writeFile(pidPath(worldRoot), `${activePid}\n`, "utf8");
  }
  const status = await readHealthFile(healthPath(worldRoot));
  return {
    running: Boolean(activePid),
    pid: activePid ?? null,
    status: {
      ...status,
      running: Boolean(activePid),
      pid: activePid ?? 0,
      schedulerPids: daemonPids,
      worldRoot: worldRoot || status.worldRoot || ""
    },
    worldRoot
  };
}

export async function schedulerList({ worldRoot } = {}) {
  const health = await schedulerHealth({ worldRoot });
  const jobs = Array.isArray(health?.status?.jobs) ? health.status.jobs : [];
  let services = [...new Set(jobs
    .map(job => String(job?.jobName ?? "").trim())
    .filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "en"));
  if (services.length === 0 && worldRoot) {
    const discovered = await discoverScheduledJobs({ worldRoot });
    services = [...new Set(discovered
      .map(job => String(job?.jobName ?? "").trim())
      .filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, "en"));
  }
  return {
    ...health,
    services
  };
}

export async function schedulerServiceHealth({ worldRoot, serviceName } = {}) {
  const normalized = normalizeSchedulerServiceName(serviceName);
  const health = await schedulerHealth({ worldRoot });
  const discovered = worldRoot ? await discoverScheduledJobs({ worldRoot }) : [];
  const configured = discovered.some(job => normalizeSchedulerServiceName(job?.jobName) === normalized);
  const enabled = normalized ? await isServiceEnabled({ worldRoot, serviceName: normalized }) : false;
  const running = health.running === true && configured && enabled;
  return {
    ...health,
    serviceName: normalized,
    configured,
    enabled,
    running
  };
}

export async function schedulerServiceBegin({ worldRoot, serviceName } = {}) {
  const normalized = normalizeSchedulerServiceName(serviceName);
  if (!normalized) {
    return { serviceName: normalized, enabled: false, running: false, changed: false };
  }
  await setServiceEnabled({ worldRoot, serviceName: normalized, enabled: true });
  return schedulerServiceHealth({ worldRoot, serviceName: normalized });
}

export async function schedulerServiceStop({ worldRoot, serviceName } = {}) {
  const normalized = normalizeSchedulerServiceName(serviceName);
  if (!normalized) {
    return { serviceName: normalized, enabled: false, running: false, changed: false };
  }
  await setServiceEnabled({ worldRoot, serviceName: normalized, enabled: false });
  return schedulerServiceHealth({ worldRoot, serviceName: normalized });
}

export async function schedulerServiceRestart({ worldRoot, serviceName } = {}) {
  const normalized = normalizeSchedulerServiceName(serviceName);
  if (!normalized) {
    return { serviceName: normalized, enabled: false, running: false, changed: false };
  }
  await setServiceEnabled({ worldRoot, serviceName: normalized, enabled: true });
  return schedulerServiceHealth({ worldRoot, serviceName: normalized });
}

export async function schedulerBegin({ worldRoot } = {}) {
  const health = await schedulerHealth({ worldRoot });
  const runningPids = Array.isArray(health?.status?.schedulerPids) ? health.status.schedulerPids : [];
  if (runningPids.length > 1) {
    await stopSchedulerPids(runningPids);
    await fs.rm(pidPath(worldRoot), { force: true });
  } else if (health.running) {
    return { ...health, action: "begin", changed: false };
  }
  await fs.mkdir(controlDir(worldRoot), { recursive: true });
  await fs.mkdir(presenceDir(worldRoot), { recursive: true });
  await fs.mkdir(path.join(controlDir(worldRoot), "service"), { recursive: true });
  await fs.rm(legacyStatusPath(worldRoot), { force: true });
  const logPath = daemonLogPath(worldRoot);
  let stdoutFd = null;
  let stderrFd = null;
  try {
    stdoutFd = fsSync.openSync(logPath, "a");
    stderrFd = fsSync.openSync(logPath, "a");
  } catch {
    stdoutFd = null;
    stderrFd = null;
  }
  const stdio = (stdoutFd != null && stderrFd != null)
    ? ["ignore", stdoutFd, stderrFd]
    : "ignore";
  const child = spawn(process.execPath, [daemonScriptPath(), "--run", "--world-root", worldRoot], {
    detached: true,
    stdio,
    cwd: process.cwd()
  });
  if (stdoutFd != null) fsSync.closeSync(stdoutFd);
  if (stderrFd != null) fsSync.closeSync(stderrFd);
  child.unref();
  await fs.writeFile(pidPath(worldRoot), `${child.pid}\n`, "utf8");
  const started = await schedulerHealth({ worldRoot });
  return { ...started, action: "begin", changed: true };
}

async function waitForStop(pid, timeoutMs = 4000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (!isPidAlive(pid)) return true;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  return !isPidAlive(pid);
}

export async function schedulerStop({ worldRoot } = {}) {
  const pid = await readPid(worldRoot);
  const daemonPids = listSchedulerDaemonPids({ worldRoot });
  const targets = [...new Set([pid, ...daemonPids].filter(Boolean))];
  if (targets.length === 0) {
    return { running: false, pid: null, action: "stop", changed: false, worldRoot };
  }
  const stopResult = await stopSchedulerPids(targets);
  const stopped = stopResult.stopped;
  if (stopped) {
    await fs.rm(pidPath(worldRoot), { force: true });
    await fs.rm(legacyStatusPath(worldRoot), { force: true });
  }
  const health = await schedulerHealth({ worldRoot });
  return { ...health, action: "stop", changed: true, stopped };
}

export async function schedulerRestart({ worldRoot } = {}) {
  await schedulerStop({ worldRoot });
  const started = await schedulerBegin({ worldRoot });
  return { ...started, action: "restart", changed: true };
}

export async function updateSchedulerStatus({ worldRoot, status }) {
  const payload = {
    running: status?.running === true,
    pid: Number(status?.pid || 0),
    worldRoot: worldRoot || "",
    startedAt: String(status?.startedAt || ""),
    updatedAt: String(status?.updatedAt || ""),
    stoppedAt: String(status?.stoppedAt || ""),
    jobsCount: Array.isArray(status?.jobs) ? status.jobs.length : 0,
    jobs: Array.isArray(status?.jobs) ? status.jobs : []
  };
  await writeHealthFile(healthPath(worldRoot), payload);
  await fs.rm(legacyStatusPath(worldRoot), { force: true });
}

export function schedulerControlPaths({ worldRoot } = {}) {
  return {
    pidPath: pidPath(worldRoot),
    healthPath: healthPath(worldRoot)
  };
}
