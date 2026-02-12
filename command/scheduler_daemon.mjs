import fs from "node:fs/promises";
import path from "node:path";

import { interpret } from "../program/bridge/index.mjs";
import { forget, remember } from "../program/remember/index.mjs";
import { builtInSignatures } from "../program/verbs/index.mjs";
import { registerSignatureHandler, clearSignatureHandlers } from "../program/bridge/signature.mjs";
import { loadDefaultConfig, readFlagValue } from "./run_pya_helpers.mjs";
import { resolveWorldRoot } from "../program/library/world.mjs";
import { createScheduler, discoverScheduledJobs } from "../program/agent/scheduler.mjs";
import {
  schedulerBegin,
  schedulerStop,
  schedulerRestart,
  schedulerHealth,
  updateSchedulerStatus,
  schedulerControlPaths
} from "../program/agent/scheduler_control.mjs";
import { runScheduledJob } from "../program/agent/scheduled_jobs.mjs";
import { worldNewspaperLogPath } from "../program/agent/newspaper_log.mjs";
import { isServiceEnabled } from "../program/agent/scheduler_service_control.mjs";

function usage() {
  return "Usage: node command/scheduler_daemon.mjs [--action begin|stop|restart|health] [--world-root <path>] [--run]";
}

async function initializeRuntime(cwd) {
  forget();
  clearSignatureHandlers();
  for (const sig of builtInSignatures) registerSignatureHandler(sig);
  await loadDefaultConfig({ cwd, interpretFn: interpret, entryPath: cwd });
}

function resolveWorldRootFlag() {
  const args = process.argv.slice(2);
  const worldRootArg = readFlagValue(args, "--world-root");
  if (worldRootArg) return path.resolve(worldRootArg);
  return resolveWorldRoot({ rememberFn: remember }) ?? path.resolve(process.cwd(), "world");
}

function sanitizeAction(raw) {
  const action = String(raw ?? "health").trim().toLowerCase();
  return action;
}

async function runAction(action, worldRoot) {
  if (action === "begin") return schedulerBegin({ worldRoot });
  if (action === "stop") return schedulerStop({ worldRoot });
  if (action === "restart") return schedulerRestart({ worldRoot });
  if (action === "health") return schedulerHealth({ worldRoot });
  throw new Error(`unknown action: ${action}`);
}

async function runLoop(worldRoot) {
  await fs.mkdir(path.join(worldRoot, "conduct"), { recursive: true });
  const jobs = await discoverScheduledJobs({ worldRoot });
  const telemetryPath = worldNewspaperLogPath({ worldRoot, name: "scheduler" });
  const scheduler = createScheduler({
    jobs,
    telemetryPath,
    isJobEnabled: (job) => isServiceEnabled({ worldRoot, serviceName: job?.jobName }),
    runJob: (job) => runScheduledJob({ worldRoot, job }),
    onError: (err) => {
      // eslint-disable-next-line no-console
      console.error(`[scheduler daemon error] ${String(err?.stack ?? err?.message ?? err)}`);
    }
  });
  const { pidPath } = schedulerControlPaths({ worldRoot });
  await fs.writeFile(pidPath, `${process.pid}\n`, "utf8");
  const initialJobs = await Promise.all(jobs.map(async (job) => ({
    agentName: job.agentName,
    jobName: job.jobName,
    laneName: job.laneName,
    intervalMs: job.intervalMs,
    enabled: await isServiceEnabled({ worldRoot, serviceName: job?.jobName })
  })));
  await updateSchedulerStatus({
    worldRoot,
    status: {
      running: true,
      pid: process.pid,
      startedAt: new Date().toISOString(),
      jobs: initialJobs
    }
  });

  let shuttingDown = false;
  async function shutdown() {
    if (shuttingDown) return;
    shuttingDown = true;
    scheduler.stop();
    await scheduler.flushTelemetry();
    const snapshot = scheduler.snapshot();
    await updateSchedulerStatus({
      worldRoot,
      status: {
        running: false,
        pid: process.pid,
        stoppedAt: new Date().toISOString(),
        jobs: snapshot
      }
    });
    await fs.rm(pidPath, { force: true });
    process.exit(0);
  }
  process.on("SIGTERM", () => {
    void shutdown();
  });
  process.on("SIGINT", () => {
    void shutdown();
  });

  async function ensureWorldRootAlive() {
    try {
      await fs.access(worldRoot);
      return true;
    } catch {
      return false;
    }
  }

  await scheduler.runNow();
  scheduler.start();
  const interval = setInterval(async () => {
    const alive = await ensureWorldRootAlive();
    if (!alive) {
      await shutdown();
      return;
    }
    const snapshot = scheduler.snapshot();
    await updateSchedulerStatus({
      worldRoot,
      status: {
        running: true,
        pid: process.pid,
        updatedAt: new Date().toISOString(),
        jobs: snapshot
      }
    });
  }, 2000);
  interval.unref();

  // keep process alive
  await new Promise(() => {});
}

async function main() {
  const args = process.argv.slice(2);
  const runMode = args.includes("--run");
  const action = sanitizeAction(readFlagValue(args, "--action") ?? "health");
  await initializeRuntime(process.cwd());
  const worldRoot = resolveWorldRootFlag();

  if (runMode) {
    await runLoop(worldRoot);
    return;
  }
  if (!["begin", "stop", "restart", "health"].includes(action)) {
    console.error(usage());
    process.exit(1);
  }
  const result = await runAction(action, worldRoot);
  const running = result?.running === true ? "truth" : "lie";
  const pid = result?.pid ?? 0;
  console.log(`scheduler action=${action} running=${running} pid=${pid}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
