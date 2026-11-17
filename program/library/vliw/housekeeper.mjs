import crypto from "node:crypto";
import path from "node:path";

import gpu from "../../verbs/gpu.mjs";
import { readGpuHandleStatus } from "../../runtime/gpu/handle_status.mjs";

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;
const DEFAULT_POLL_INTERVAL_MS = 1000;
const MEBIBYTE = 1024 * 1024;
const GPU_CONTEXT_RESERVE_BYTES = 32 * MEBIBYTE;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeRemember(worldRoot, agentName, gpuId) {
  return (name) => {
    if (name === "world root") return { ob: { filename: worldRoot } };
    if (name === "mind name") return { ob: { name: agentName } };
    if (name === "gpu id") return { ob: { text: gpuId } };
    return null;
  };
}

function readResult(status, handleId) {
  const raw = String(status?.result ?? "").trim();
  if (!raw) throw new Error(`VLIW Housekeeper job ${handleId} completed without a result`);
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`VLIW Housekeeper job ${handleId} returned invalid JSON: ${error.message}`);
  }
}

function estimateVramMb(batch) {
  const slots = Array.isArray(batch?.slots) ? batch.slots.length : 0;
  const cases = Array.isArray(batch?.cases) ? batch.cases.length : 0;
  const candidates = Array.isArray(batch?.candidates) ? batch.candidates : [];
  const maxInstructions = candidates.reduce((max, candidate) => (
    Math.max(max, Array.isArray(candidate?.instructions) ? candidate.instructions.length : 0)
  ), 0);
  const pairs = cases * candidates.length;
  const scratchBytes = pairs * slots * 4;
  const candidateBytes = candidates.length * (2 + maxInstructions * 4) * 4;
  const caseBytes = cases * (slots + 1) * 4;
  const resultBytes = pairs * 4;
  const errorBytes = pairs * 4;
  const estimatedBytes = GPU_CONTEXT_RESERVE_BYTES
    + scratchBytes
    + candidateBytes
    + caseBytes
    + resultBytes
    + errorBytes;
  return Math.max(64, Math.ceil(estimatedBytes * 1.25 / MEBIBYTE));
}

export function createHousekeeperVliwBatchEvaluator({
  worldRoot = path.resolve(process.cwd(), "world"),
  agentName = "vliw-evolution",
  gpuId = process.env.PYA_GPU_ID || "gpu-0",
  deviceId = "",
  timeoutMs = DEFAULT_TIMEOUT_MS,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  submitDuty = gpu,
  readStatus = readGpuHandleStatus,
  sleep = delay,
  makeHandleId = () => `vliw-${crypto.randomUUID()}`
} = {}) {
  const resolvedWorldRoot = path.resolve(String(worldRoot));
  const waitLimit = Math.max(1, Math.trunc(Number(timeoutMs) || DEFAULT_TIMEOUT_MS));
  const pollDelay = Math.max(10, Math.trunc(Number(pollIntervalMs) || DEFAULT_POLL_INTERVAL_MS));
  const remember = makeRemember(resolvedWorldRoot, agentName, gpuId);

  return async function evaluateVliwBatchThroughHousekeeper(batch) {
    const handleId = String(makeHandleId()).trim();
    if (!handleId) throw new Error("VLIW Housekeeper evaluator requires a non-empty handle id");
    const jobSpec = {
      kind: "vliw-batch-evaluate",
      profileName: "vliw-batch-evaluator",
      resourceRequest: {
        vramRequiredMb: estimateVramMb(batch),
        ...(String(deviceId).trim() ? { deviceId: String(deviceId).trim() } : {})
      },
      payload: batch
    };
    await submitDuty({
      su: { name: handleId },
      be: "gpu vliw",
      ob: { text: JSON.stringify(jobSpec) },
      vyah: { ve: { type: "name", values: ["start", "future"] } }
    }, { remember });

    const deadline = Date.now() + waitLimit;
    while (Date.now() < deadline) {
      const status = await readStatus(resolvedWorldRoot, handleId);
      if (status?.status === "success") return readResult(status, handleId).scores;
      if (status?.status === "fail") {
        const detail = String(status.error || status.message || "unknown Housekeeper failure");
        throw new Error(`VLIW Housekeeper job ${handleId} failed: ${detail}`);
      }
      await sleep(Math.min(pollDelay, Math.max(1, deadline - Date.now())));
    }
    throw new Error(`VLIW Housekeeper job ${handleId} is still queued or running after ${waitLimit}ms`);
  };
}
