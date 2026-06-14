import path from "node:path";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, remember } from "../program/remember/index.mjs";
import { builtInSignatures } from "../program/verbs/index.mjs";
import { registerSignatureHandler, clearSignatureHandlers } from "../program/bridge/signature.mjs";
import { loadDefaultConfig, readFlagValue } from "./run_pya_helpers.mjs";
import { resolveWorldRoot } from "../program/library/world.mjs";
import { updateAgentPresence } from "../program/agent/presence.mjs";
import { runGpuWorkerOnce } from "../program/runtime/gpu/worker.mjs";

function usage() {
  return "Usage: node command/gpu_worker.mjs [--world <path>] [--interval-ms 400] [--once]";
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

  const housekeeperUrl = String(process.env.PYA_GPU_HOUSEKEEPER_URL ?? "").trim();
  if (!housekeeperUrl) {
    throw new Error("gpu_worker: PYA_GPU_HOUSEKEEPER_URL is required");
  }

  await initializeRuntime({ cwd: process.cwd() });
  const worldArg = readFlagValue(args, "--world");
  const worldRoot = worldArg
    ? path.resolve(worldArg)
    : (resolveWorldRoot({ rememberFn: remember }) ?? path.resolve(process.cwd(), "world"));
  const intervalMs = Math.max(100, parseInteger(readFlagValue(args, "--interval-ms"), 400));
  const runOnce = args.includes("--once");

  do {
    const cycleIso = shortIsoNow();
    await updateGpuWorkerPresence({ worldRoot, latestIso: cycleIso });
    const result = await runGpuWorkerOnce({
      worldRoot,
      housekeeperUrl,
      hostId: process.env.PYA_GPU_HOUSEKEEPER_HOST_ID || ""
    });
    const received = Number(result?.received ?? 0);
    const handled = Number(result?.handled ?? 0);
    const sent = Number(result?.sent ?? 0);
    const queue = Number(result?.queueDepth ?? 0);
    if (received > 0 || handled > 0 || sent > 0 || queue > 0) {
      console.log(
        `${cycleIso} gpu worker: received=${received} handled=${handled} sent=${sent} queue=${queue}`
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
