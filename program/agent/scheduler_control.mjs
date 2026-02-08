import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { discoverScheduledJobs } from "./scheduler.mjs";
import { isServiceEnabled, normalizeSchedulerServiceName, setServiceEnabled } from "./scheduler_service_control.mjs";

function controlDir(worldRoot) {
  return path.join(worldRoot, "conduct");
}

function pidPath(worldRoot) {
  return path.join(controlDir(worldRoot), "scheduler.pid");
}

function statusPath(worldRoot) {
  return path.join(controlDir(worldRoot), "scheduler.status.json");
}

function daemonScriptPath() {
  return fileURLToPath(new URL("../../command/scheduler_daemon.mjs", import.meta.url));
}

async function readJson(filePath, fallback) {
  try {
    const text = await fs.readFile(filePath, "utf8");
    return JSON.parse(text);
  } catch (err) {
    if (err?.code === "ENOENT") return fallback;
    throw err;
  }
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(value, null, 2) + "\n", "utf8");
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

export async function schedulerHealth({ worldRoot } = {}) {
  const pid = await readPid(worldRoot);
  const alive = isPidAlive(pid);
  const status = await readJson(statusPath(worldRoot), {});
  return {
    running: alive,
    pid: alive ? pid : null,
    status,
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
  if (health.running) {
    return { ...health, action: "begin", changed: false };
  }
  await fs.mkdir(controlDir(worldRoot), { recursive: true });
  await fs.mkdir(path.join(controlDir(worldRoot), "service"), { recursive: true });
  const child = spawn(process.execPath, [daemonScriptPath(), "--run", `--world-root=${worldRoot}`], {
    detached: true,
    stdio: "ignore",
    cwd: process.cwd()
  });
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
  if (!pid || !isPidAlive(pid)) {
    return { running: false, pid: null, action: "stop", changed: false, worldRoot };
  }
  process.kill(pid, "SIGTERM");
  const stopped = await waitForStop(pid);
  if (stopped) {
    await fs.rm(pidPath(worldRoot), { force: true });
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
    ...status,
    worldRoot
  };
  await writeJson(statusPath(worldRoot), payload);
}

export function schedulerControlPaths({ worldRoot } = {}) {
  return {
    pidPath: pidPath(worldRoot),
    statusPath: statusPath(worldRoot)
  };
}
