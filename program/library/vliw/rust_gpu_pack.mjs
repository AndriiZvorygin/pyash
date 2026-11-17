import crypto from "node:crypto";
import path from "node:path";

import gpu from "../../verbs/gpu.mjs";
import { readGpuHandleStatus } from "../../runtime/gpu/handle_status.mjs";
import { decodePyacPack } from "./database.mjs";

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;
const DEFAULT_POLL_INTERVAL_MS = 1000;
const MEBIBYTE = 1024 * 1024;
const WORKER_RESERVE_BYTES = 64 * MEBIBYTE;
const GPU_BUFFER_BYTES_PER_CODELET = 16 * 4 + 36 * 4;

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

function estimateVramMb(codeletCount) {
  const bytes = WORKER_RESERVE_BYTES + codeletCount * GPU_BUFFER_BYTES_PER_CODELET;
  return Math.max(64, Math.ceil((bytes * 1.25) / MEBIBYTE));
}

export function createHousekeeperVliwPackExecutor({
  worldRoot = path.resolve(process.cwd(), "world"),
  agentName = "vliw-pack-executor",
  gpuId = process.env.PYA_GPU_ID || "gpu-0",
  deviceId = "",
  timeoutMs = DEFAULT_TIMEOUT_MS,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  submitDuty = gpu,
  readStatus = readGpuHandleStatus,
  sleep = delay,
  makeHandleId = () => `pyac-pack-${crypto.randomUUID()}`
} = {}) {
  const resolvedWorldRoot = path.resolve(String(worldRoot));
  const waitLimit = Math.max(1, Math.trunc(Number(timeoutMs) || DEFAULT_TIMEOUT_MS));
  const pollDelay = Math.max(10, Math.trunc(Number(pollIntervalMs) || DEFAULT_POLL_INTERVAL_MS));
  const remember = makeRemember(resolvedWorldRoot, agentName, gpuId);

  return async function executePackThroughHousekeeper(packBytes) {
    const bytes = packBytes instanceof Uint8Array
      ? packBytes
      : new Uint8Array(packBytes);
    const decoded = decodePyacPack(bytes);
    if (decoded.codelets.length === 0) throw new Error("VLIW Housekeeper executor requires a non-empty PyAC pack");
    const handleId = String(makeHandleId()).trim();
    if (!handleId) throw new Error("VLIW Housekeeper executor requires a non-empty handle id");
    const jobSpec = {
      kind: "pyac-pack-execute",
      profileName: "pyac-vliw-rust-gpu",
      resourceRequest: {
        vramRequiredMb: estimateVramMb(decoded.codelets.length),
        ...(String(deviceId).trim() ? { deviceId: String(deviceId).trim() } : {})
      },
      payload: { packBase64: Buffer.from(bytes).toString("base64") }
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
      if (status?.status === "success") {
        const result = readResult(status, handleId);
        if (result?.ok !== true || !Array.isArray(result.values)) {
          throw new Error(`VLIW Housekeeper job ${handleId} returned an invalid pack result`);
        }
        return result;
      }
      if (status?.status === "fail") {
        const detail = String(status.error || status.message || "unknown Housekeeper failure");
        throw new Error(`VLIW Housekeeper job ${handleId} failed: ${detail}`);
      }
      await sleep(Math.min(pollDelay, Math.max(1, deadline - Date.now())));
    }
    throw new Error(`VLIW Housekeeper job ${handleId} is still queued or running after ${waitLimit}ms`);
  };
}
