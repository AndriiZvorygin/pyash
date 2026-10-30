import path from "node:path";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, remember } from "../program/remember/index.mjs";
import { builtInSignatures } from "../program/verbs/index.mjs";
import { registerSignatureHandler, clearSignatureHandlers } from "../program/bridge/signature.mjs";
import { loadDefaultConfig, readFlagValue } from "./run_pya_helpers.mjs";
import { resolveWorldRoot } from "../program/library/world.mjs";
import { updateAgentPresence } from "../program/agent/presence.mjs";
import { runGpuWorkerBatch } from "../program/runtime/gpu/worker.mjs";
import {
  discoverGpuWorkerCapacity,
  parseGpuWorkerConcurrencyOverride,
  resolveGpuWorkerConcurrency
} from "../program/runtime/gpu/worker_capacity.mjs";
import { resolveConfigText } from "../program/configure/env.mjs";

const GPU_TOPOLOGY_CACHE_MS = 60 * 1000;
const GPU_TOPOLOGY_RETRY_MS = 5 * 1000;

function usage() {
  return "Usage: node command/gpu_worker.mjs [--world <path>] [--interval-ms 400] [--once] (PYA_GPU_WORKER_CONCURRENCY overrides auto-discovered GPU slots)";
}

async function initializeRuntime({ cwd }) {
  forget();
  clearSignatureHandlers();
  for (const sig of builtInSignatures) {
    registerSignatureHandler(sig);
  }
  await loadDefaultConfig({ cwd, interpretFn: interpret, entryPath: cwd });
  if (!remember("mricge")) {
    await interpret(parse("exists su name mricge be mind ya"));
  }
}

function parseInteger(value, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.trunc(num);
}

async function delay(ms) {
  await new Promise((resolve) => setTimeout(resolve, Math.max(1, ms)));
}

function shortIsoNow() {
  return new Date().toISOString();
}

async function updateGpuWorkerPresence({ worldRoot, latestIso }) {
  await updateAgentPresence({
    worldRoot,
    agentName: "gpu-worker",
    latestIso,
    touchedFiles: [path.join(worldRoot, "holding", "gpu")]
  });
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(usage());
    process.exit(0);
  }

  await initializeRuntime({ cwd: process.cwd() });
  const housekeeperUrl = String(
    process.env.PYA_GPU_HOUSEKEEPER_URL
      ?? resolveConfigText("gpu housekeeper url", { rememberFn: remember })
      ?? ""
  ).trim();
  if (!housekeeperUrl) {
    throw new Error("gpu_worker: PYA_GPU_HOUSEKEEPER_URL or gpu housekeeper url is required");
  }

  const worldArg = readFlagValue(args, "--world");
  const worldRoot = worldArg
    ? path.resolve(worldArg)
    : (resolveWorldRoot({ rememberFn: remember }) ?? path.resolve(process.cwd(), "world"));
  const intervalMs = Math.max(100, parseInteger(readFlagValue(args, "--interval-ms"), 400));
  const runOnce = args.includes("--once");
  const concurrencyOverride = parseGpuWorkerConcurrencyOverride(process.env.PYA_GPU_WORKER_CONCURRENCY);
  let cachedCapacity = null;
  let capacityObservedAt = 0;
  let lastLoggedConcurrency = 0;

  const dispatchConcurrency = async () => {
    if (concurrencyOverride !== undefined) {
      return { concurrency: concurrencyOverride, source: "environment override", deviceSlots: 0, hostCount: 0 };
    }
    const now = Date.now();
    if (cachedCapacity && now - capacityObservedAt < GPU_TOPOLOGY_CACHE_MS) return cachedCapacity;
    try {
      const capacity = await discoverGpuWorkerCapacity({ housekeeperUrl });
      cachedCapacity = {
        concurrency: resolveGpuWorkerConcurrency({ discoveredDeviceSlots: capacity.deviceSlots }),
        source: "discovered topology",
        ...capacity
      };
      capacityObservedAt = now;
    } catch (error) {
      cachedCapacity = {
        concurrency: 1,
        source: "safe fallback",
        deviceSlots: 0,
        hostCount: 0,
        error: String(error?.message ?? error).trim()
      };
      capacityObservedAt = now - GPU_TOPOLOGY_CACHE_MS + GPU_TOPOLOGY_RETRY_MS;
    }
    return cachedCapacity;
  };

  do {
    const cycleIso = shortIsoNow();
    await updateGpuWorkerPresence({ worldRoot, latestIso: cycleIso });
    const capacity = await dispatchConcurrency();
    if (capacity.concurrency !== lastLoggedConcurrency) {
      console.log(
        `[gpu worker] dispatch slots=${capacity.concurrency} source=${capacity.source}`
        + (capacity.deviceSlots ? ` gpu_devices=${capacity.deviceSlots} hosts=${capacity.hostCount}` : "")
        + (capacity.error ? ` detail=${capacity.error}` : "")
      );
      lastLoggedConcurrency = capacity.concurrency;
    }
    const result = await runGpuWorkerBatch({
      worldRoot,
      housekeeperUrl,
      hostId: process.env.PYA_GPU_HOUSEKEEPER_HOST_ID || "",
      concurrency: capacity.concurrency
    });
    const received = Number(result?.received ?? 0);
    const handled = Number(result?.handled ?? 0);
    const sent = Number(result?.sent ?? 0);
    const queue = Number(result?.queueDepth ?? 0);
    const dependencyWaiting = Array.isArray(result?.dependencyWaiting) ? result.dependencyWaiting.length : 0;
    const errors = Array.isArray(result?.errors) ? result.errors.length : 0;
    const staleReclaimed = Number(result?.staleRuntime?.reclaimed ?? 0);
    const staleCompleted = Number(result?.staleRuntime?.completed ?? 0);
    const staleGcError = String(result?.staleRuntime?.error ?? "").trim();
    if (received > 0 || handled > 0 || sent > 0 || queue > 0 || dependencyWaiting > 0 || errors > 0 || staleReclaimed > 0 || staleCompleted > 0 || staleGcError) {
      console.log(
        `${cycleIso} gpu worker: slots=${capacity.concurrency} received=${received} handled=${handled} sent=${sent} queue=${queue} dependency_waiting=${dependencyWaiting} errors=${errors} stale_reclaimed=${staleReclaimed} stale_completed=${staleCompleted}${staleGcError ? ` stale_gc_error=${staleGcError}` : ""}`
      );
    }
    if (runOnce) break;
    await delay(intervalMs);
  } while (true);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
