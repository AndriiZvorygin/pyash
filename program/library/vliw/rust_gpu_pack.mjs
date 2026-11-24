import crypto from "node:crypto";
import { performance } from "node:perf_hooks";

import { resolveConfiguredText } from "../../runtime/gpu/configured-endpoints.mjs";
import { resolveGpuHousekeeperUrl } from "../../runtime/gpu/managed-ollama.mjs";
import { resolveGpuSourceIdentity } from "../../runtime/gpu/source_identity.mjs";
import { decodePyacPack } from "./database.mjs";
import { createPyacHousekeeperUpload } from "./housekeeper_upload.mjs";

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;
const DEFAULT_POLL_INTERVAL_MS = 1000;
const MEBIBYTE = 1024 * 1024;
const WORKER_RESERVE_BYTES = 64 * MEBIBYTE;
const GPU_BUFFER_BYTES_PER_CODELET = 16 * 4 + 36 * 4;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readResult(status, handleId) {
  const raw = status?.result;
  if (raw && typeof raw === "object") return raw;
  const text = String(raw ?? "").trim();
  if (!text) throw new Error(`VLIW Housekeeper job ${handleId} completed without a result`);
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`VLIW Housekeeper job ${handleId} returned invalid JSON: ${error.message}`);
  }
}

function errorText(value) {
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.message;
  if (value && typeof value === "object") {
    for (const key of ["message", "error", "detail"]) {
      if (typeof value[key] === "string" && value[key]) return value[key];
    }
    try {
      return JSON.stringify(value);
    } catch {
      return "unserializable Housekeeper error";
    }
  }
  return String(value ?? "unknown Housekeeper failure");
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
    queuedAt: String(status?.queuedAt ?? status?.submittedAt ?? ""),
    workerStartedAt: String(status?.startedAt ?? ""),
    workerFinishedAt: String(status?.finishedAt ?? ""),
    remoteSubmittedAt: String(status?.remoteSubmittedAt ?? status?.submittedAt ?? ""),
    remoteStartedAt: String(status?.remoteStartedAt ?? status?.startedAt ?? ""),
    remoteFinishedAt: String(status?.remoteFinishedAt ?? status?.finishedAt ?? ""),
    executionHostId: String(status?.executionHostId ?? ""),
    localQueueWaitMs: timestampDeltaMs(status?.queuedAt ?? status?.submittedAt, status?.startedAt),
    workerWallMs: timestampDeltaMs(status?.startedAt, status?.finishedAt),
    housekeeperQueueWaitMs: timestampDeltaMs(
      status?.remoteSubmittedAt ?? status?.submittedAt,
      status?.remoteStartedAt ?? status?.startedAt
    ),
    housekeeperActiveMs: timestampDeltaMs(
      status?.remoteStartedAt ?? status?.startedAt,
      status?.remoteFinishedAt ?? status?.finishedAt
    ),
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
  agentName = "vliw-pack-executor",
  deviceId = "",
  targetHostId = "",
  hostId = "",
  username = "",
  secret = "",
  managerUrl = "",
  timeoutMs = DEFAULT_TIMEOUT_MS,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  fetchImpl = globalThis.fetch,
  sleep = delay,
  makeHandleId = () => crypto.randomBytes(10).toString("base64url")
} = {}) {
  const workingDirectory = process.cwd();
  const waitLimit = Math.max(1, Math.trunc(Number(timeoutMs) || DEFAULT_TIMEOUT_MS));
  const pollDelay = Math.max(10, Math.trunc(Number(pollIntervalMs) || DEFAULT_POLL_INTERVAL_MS));
  const source = resolveGpuSourceIdentity({ hostId, username });
  const sharedSecret = String(secret || resolveConfiguredText("gpu authentication key", { cwd: workingDirectory })).trim();
  const housekeeperUrl = resolveGpuHousekeeperUrl({ managerUrl, cwd: workingDirectory });
  if (typeof fetchImpl !== "function") throw new Error("VLIW Housekeeper executor requires fetch");

  return async function executePackThroughHousekeeper(packBytes) {
    const bytes = packBytes instanceof Uint8Array
      ? packBytes
      : new Uint8Array(packBytes);
    const decoded = decodePyacPack(bytes);
    if (decoded.codelets.length === 0) throw new Error("VLIW Housekeeper executor requires a non-empty PyAC pack");
    const handleId = String(makeHandleId()).trim();
    if (!handleId) throw new Error("VLIW Housekeeper executor requires a non-empty handle id");
    if (!sharedSecret) throw new Error("VLIW Housekeeper upload requires `gpu authentication key` in configure/secret.pya");
    if (!housekeeperUrl) throw new Error("VLIW Housekeeper executor requires PYA_GPU_HOUSEKEEPER_URL or `gpu housekeeper url` configuration");
    const upload = createPyacHousekeeperUpload({
      packBytes: bytes,
      secret: sharedSecret,
      username: source.username,
      hostId: source.hostId,
      handleId
    });
    const requestStartedAt = new Date().toISOString();
    const requestStartedMs = performance.now();
    const submitResponse = await fetchImpl(`${housekeeperUrl}/submit-pyac`, {
      method: "POST",
      headers: {
        "content-type": "application/vnd.pyac-vliw-upload",
        ...(String(deviceId).trim() ? { "x-pyash-device-id": String(deviceId).trim() } : {}),
        ...(String(targetHostId).trim() ? { "x-pyash-target-host-id": String(targetHostId).trim() } : {}),
        "x-pyash-discharge-allowed": "false",
        "x-pyash-worker-id": String(agentName || "vliw-pack-executor")
      },
      body: upload.stream
    });
    const submitted = await submitResponse.json().catch(() => ({}));
    if (!submitResponse.ok || submitted.accepted !== true || !submitted.remoteJobId) {
      throw new Error(`VLIW Housekeeper upload failed (${submitResponse.status}): ${submitted.error || submitResponse.statusText || "invalid response"}`);
    }
    const remoteJobId = String(submitted.remoteJobId);

    const deadline = Date.now() + waitLimit;
    while (Date.now() < deadline) {
      const response = await fetchImpl(`${housekeeperUrl}/job/${encodeURIComponent(remoteJobId)}`);
      const status = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(`VLIW Housekeeper status failed (${response.status}): ${status.error || response.statusText}`);
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
        const detail = errorText(status.error || status.message || "unknown Housekeeper failure");
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

export function createPinnedVliwPackExecutor({ targetHostId, timeoutMs, managerUrl, ...options }) {
  const host = String(targetHostId ?? "").trim().toLowerCase();
  if (!host) throw new Error("pinned VLIW execution requires a host");
  const execute = createHousekeeperVliwPackExecutor({
    ...options,
    managerUrl,
    timeoutMs,
    targetHostId: host,
    deviceId: options.deviceId || "gpu0",
    agentName: options.agentName || "vliw-gpu-conformance"
  });
  return async (packBytes) => {
    const result = await execute(packBytes);
    const executionHostId = result.housekeeperTiming?.executionHostId;
    if (executionHostId !== host) {
      throw new Error(`VLIW expected host ${host}, got ${executionHostId || "unknown"}`);
    }
    return result;
  };
}
