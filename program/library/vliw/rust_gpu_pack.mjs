import crypto from "node:crypto";
import path from "node:path";
import { performance } from "node:perf_hooks";

import gpu from "../../verbs/gpu.mjs";
import { readGpuHandleStatus } from "../../runtime/gpu/handle_status.mjs";
import { submitManagedGpuJob } from "../../runtime/gpu/managed-ollama.mjs";
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

function timestampDeltaMs(start, end) {
  const startMs = Date.parse(String(start ?? ""));
  const endMs = Date.parse(String(end ?? ""));
  return Number.isFinite(startMs) && Number.isFinite(endMs) && endMs >= startMs
    ? endMs - startMs
    : null;
}

function timingRecord(status, handleId, requestStartedAt, requestStartedMs, runtimeTimingMs = null) {
  return {
    handleId,
    remoteJobId: String(status?.remoteJobId ?? ""),
    queuedAt: String(status?.queuedAt ?? ""),
    workerStartedAt: String(status?.startedAt ?? ""),
    workerFinishedAt: String(status?.finishedAt ?? ""),
    remoteSubmittedAt: String(status?.remoteSubmittedAt ?? ""),
    remoteStartedAt: String(status?.remoteStartedAt ?? ""),
    remoteFinishedAt: String(status?.remoteFinishedAt ?? ""),
    localQueueWaitMs: timestampDeltaMs(status?.queuedAt, status?.startedAt),
    workerWallMs: timestampDeltaMs(status?.startedAt, status?.finishedAt),
    housekeeperQueueWaitMs: timestampDeltaMs(status?.remoteSubmittedAt, status?.remoteStartedAt),
    housekeeperActiveMs: timestampDeltaMs(status?.remoteStartedAt, status?.remoteFinishedAt),
    clientRoundTripMs: Number((performance.now() - requestStartedMs).toFixed(3)),
    requestStartedAt,
    runtimeTimingMs
  };
}

function runtimeTimingsFromError(message) {
  function inspect(value, depth = 0) {
    if (depth > 8) return null;
    if (value && typeof value === "object") {
      if (value.runtimeTimingMs && typeof value.runtimeTimingMs === "object") return value.runtimeTimingMs;
      for (const key of ["message", "error", "detail", "response"]) {
        const result = inspect(value[key], depth + 1);
        if (result) return result;
      }
      return null;
    }
    if (typeof value !== "string") return null;
    const source = value;
    try {
      const result = inspect(JSON.parse(source), depth + 1);
      if (result) return result;
    } catch {
      // Housekeeper prefixes nested JSON error bodies with a human-readable message.
    }
    for (let start = source.indexOf("{"); start >= 0; start = source.indexOf("{", start + 1)) {
      let nesting = 0;
      let quoted = false;
      let escaped = false;
      for (let index = start; index < source.length; index += 1) {
        const character = source[index];
        if (quoted) {
          if (escaped) escaped = false;
          else if (character === "\\") escaped = true;
          else if (character === '"') quoted = false;
          continue;
        }
        if (character === '"') quoted = true;
        else if (character === "{") nesting += 1;
        else if (character === "}" && --nesting === 0) {
          try {
            const result = inspect(JSON.parse(source.slice(start, index + 1)), depth + 1);
            if (result) return result;
          } catch {
            break;
          }
          break;
        }
      }
    }
    return null;
  }

  return inspect(String(message ?? ""));
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
    const requestStartedAt = new Date().toISOString();
    const requestStartedMs = performance.now();
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
        let result;
        try {
          result = readResult(status, handleId);
        } catch (error) {
          error.housekeeperTiming = timingRecord(status, handleId, requestStartedAt, requestStartedMs);
          throw error;
        }
        if (result?.ok !== true || !Array.isArray(result.values)) {
          throw new Error(`VLIW Housekeeper job ${handleId} returned an invalid pack result`);
        }
        return {
          ...result,
          housekeeperTiming: timingRecord(
            status,
            handleId,
            requestStartedAt,
            requestStartedMs,
            result.runtimeTimingMs ?? null
          )
        };
      }
      if (status?.status === "fail") {
        const detail = String(status.error || status.message || "unknown Housekeeper failure");
        const error = new Error(`VLIW Housekeeper job ${handleId} failed: ${detail}`);
        error.housekeeperTiming = timingRecord(
          status,
          handleId,
          requestStartedAt,
          requestStartedMs,
          runtimeTimingsFromError(detail)
        );
        throw error;
      }
      await sleep(Math.min(pollDelay, Math.max(1, deadline - Date.now())));
    }
    throw new Error(`VLIW Housekeeper job ${handleId} is still queued or running after ${waitLimit}ms`);
  };
}

export function createPinnedVliwPackExecutor({ targetHostId, timeoutMs, managerUrl, submit = submitManagedGpuJob }) {
  const host = String(targetHostId ?? "").trim().toLowerCase();
  if (!host) throw new Error("pinned VLIW execution requires a host");
  return async (packBytes) => {
    const decoded = decodePyacPack(packBytes);
    const startedMs = performance.now();
    const startedAt = new Date().toISOString();
    const handleId = `pyac-pack-${crypto.randomUUID()}`;
    let terminal;
    const timing = (runtime) => timingRecord({
      remoteJobId: terminal?.remoteJobId,
      remoteSubmittedAt: terminal?.submittedAt,
      remoteStartedAt: terminal?.startedAt,
      remoteFinishedAt: terminal?.finishedAt
    }, handleId, startedAt, startedMs, runtime);
    const verifyHost = () => {
      if (terminal?.executionHostId !== host) {
        throw new Error(`VLIW expected host ${host}, got ${terminal?.executionHostId ?? "unknown"}`);
      }
    };
    try {
      const result = await submit({
        runtimeName: "vliw",
        profileName: "pyac-vliw-rust-gpu",
        workerId: "vliw-gpu-conformance",
        targetHostId: host,
        deviceId: "gpu0",
        managerUrl,
        timeoutMs,
        handleId,
        dischargeAllowed: false,
        vramRequiredMb: Math.max(512, estimateVramMb(decoded.codelets.length)),
        jobSpec: {
          kind: "pyac-pack-execute",
          payload: { packBase64: Buffer.from(packBytes).toString("base64") }
        },
        onStatus(status) { terminal = status; }
      });
      verifyHost();
      return { ...result, housekeeperTiming: timing(result.runtimeTimingMs ?? null) };
    } catch (error) {
      if (terminal) verifyHost();
      error.housekeeperTiming = timing(runtimeTimingsFromError(error.message));
      throw error;
    }
  };
}
