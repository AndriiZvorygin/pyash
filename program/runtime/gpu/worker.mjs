import {
  claimOldestInputEnvelope,
  ackRuntimeEnvelopeSuccess,
  ackRuntimeEnvelopeFail,
  listGpuRuntimeEnvelopes,
  queueDepth
} from "./queue.mjs";
import { acquireGpuLease, heartbeatGpuLease, readGpuLease, releaseGpuLease } from "./lease.mjs";
import { isTerminalHandleStatus, readGpuHandleStatus, writeGpuHandleStatus } from "./handle_status.mjs";
import { createGpuHousekeeperAdapter } from "./housekeeper_adapter.mjs";
import { gpuEnvelopeDependencyStatus } from "./readiness.mjs";

export const DEFAULT_GPU_REMOTE_JOB_TIMEOUT_MS = 20 * 60 * 1000;
export const DEFAULT_GPU_RUNTIME_STALE_MS = 60 * 60 * 1000;
export const DEFAULT_GPU_RUNTIME_GC_INTERVAL_MS = 60 * 1000;

const runtimeGcState = new Map();

function normalizeText(value) {
  if (value == null) return "";
  return String(value).trim();
}

function parseSpecMap(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return { ...value };
  if (typeof value !== "string") return {};
  const text = value.trim();
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
  } catch {
    // string specs are allowed by the queue contract but not executable here
  }
  return {};
}

function jsonText(value) {
  if (value === undefined) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify(String(value));
  }
}

function shortError(err) {
  return normalizeText(err?.message ?? err) || "gpu worker failed";
}

async function delay(ms) {
  await new Promise((resolve) => setTimeout(resolve, Math.max(1, Number(ms) || 1)));
}

function resolveAdapter({ adapter = null, housekeeperUrl = "", hostId = "" } = {}) {
  if (adapter) return adapter;
  return createGpuHousekeeperAdapter({ baseUrl: housekeeperUrl, hostId });
}

function dispatchLeaseId(envelope, leaseScope = "physical") {
  if (leaseScope !== "dispatch") return envelope.gpuId;
  return `dispatch:${envelope.gpuId}:${envelope.handleId}`;
}

function remoteJobIdFromSubmit(result = {}) {
  return normalizeText(result.remoteJobId ?? result.jobId ?? result.id);
}

function terminalStatus(raw = "") {
  const status = normalizeText(raw).toLowerCase();
  if (["success", "succeeded", "complete", "completed", "done"].includes(status)) return "success";
  if (["fail", "failed", "error", "defective"].includes(status)) return "fail";
  return "";
}

function parsePositiveMs(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback;
}

export function resolveGpuRuntimeStaleMs(value = process.env.PYA_GPU_RUNTIME_STALE_MS) {
  return parsePositiveMs(value, DEFAULT_GPU_RUNTIME_STALE_MS);
}

function leaseIsFresh(lease, nowMs) {
  if (!lease) return false;
  const heartbeatMs = Date.parse(String(lease.heartbeatAt || lease.acquiredAt || ""));
  const ttlMs = parsePositiveMs(lease.ttlMs, 30000);
  return Number.isFinite(heartbeatMs) && (nowMs - heartbeatMs) <= ttlMs;
}

async function activeGpuLease(worldRoot, envelope, nowMs) {
  const leaseIds = [
    dispatchLeaseId(envelope, "dispatch"),
    dispatchLeaseId(envelope, "physical")
  ].filter(Boolean);
  const seen = new Set();
  for (const leaseId of leaseIds) {
    if (seen.has(leaseId)) continue;
    seen.add(leaseId);
    const lease = await readGpuLease(worldRoot, { gpuId: leaseId });
    if (leaseIsFresh(lease, nowMs)) return lease;
  }
  return null;
}

function staleRuntimeMessage(ageMs) {
  const ageMinutes = Math.max(1, Math.round(ageMs / 60000));
  return `stale GPU runtime claim reclaimed after ${ageMinutes} minutes without a live lease`;
}

export async function reclaimStaleGpuRuntime({
  worldRoot,
  staleMs = resolveGpuRuntimeStaleMs(),
  nowMs = Date.now()
} = {}) {
  if (!worldRoot) throw new Error("gpu runtime GC defective: worldRoot is required");
  const thresholdMs = parsePositiveMs(staleMs, DEFAULT_GPU_RUNTIME_STALE_MS);
  const runtime = await listGpuRuntimeEnvelopes(worldRoot);
  const result = {
    scanned: runtime.length,
    protected: 0,
    reclaimed: 0,
    completed: 0,
    malformed: 0,
    entries: []
  };

  for (const candidate of runtime) {
    const ageMs = Math.max(0, nowMs - Number(candidate.mtimeMs || 0));
    if (ageMs < thresholdMs) continue;

    const envelope = candidate.envelope;
    if (envelope) {
      const liveLease = await activeGpuLease(worldRoot, envelope, nowMs);
      if (liveLease) {
        result.protected += 1;
        continue;
      }

      const current = await readGpuHandleStatus(worldRoot, envelope.handleId);
      if (isTerminalHandleStatus(current?.status)) {
        if (String(current.status).toLowerCase() === "success") {
          await ackRuntimeEnvelopeSuccess(worldRoot, { runtimePath: candidate.path });
          result.completed += 1;
          result.entries.push({ handleId: envelope.handleId, action: "completed_success" });
        } else {
          await ackRuntimeEnvelopeFail(worldRoot, {
            runtimePath: candidate.path,
            retryCount: envelope.retryCount,
            maxRetries: envelope.retryCount,
            requeuePhase: "input"
          });
          result.reclaimed += 1;
          result.entries.push({ handleId: envelope.handleId, action: "moved_terminal_failure" });
        }
        continue;
      }

      const message = staleRuntimeMessage(ageMs);
      await writeGpuHandleStatus(worldRoot, envelope.handleId, {
        status: "fail",
        agentName: envelope.agentName,
        gpuId: envelope.gpuId,
        intent: envelope.intent,
        lane: envelope.lane,
        queuedAt: envelope.queuedAt,
        startedAt: current?.startedAt || "",
        finishedAt: new Date(nowMs).toISOString(),
        retryCount: envelope.retryCount + 1,
        outcome: "fail",
        message,
        result: "",
        error: JSON.stringify({ code: "stale_gpu_runtime", ageMs, message })
      });
      await ackRuntimeEnvelopeFail(worldRoot, {
        runtimePath: candidate.path,
        retryCount: envelope.retryCount,
        maxRetries: envelope.retryCount,
        requeuePhase: "input"
      });
      for (const leaseId of [
        dispatchLeaseId(envelope, "dispatch"),
        dispatchLeaseId(envelope, "physical")
      ]) {
        const lease = await readGpuLease(worldRoot, { gpuId: leaseId });
        if (!lease || leaseIsFresh(lease, nowMs)) continue;
        await releaseGpuLease(worldRoot, {
          gpuId: leaseId,
          owner: lease.owner,
          handleId: lease.handleId
        });
      }
      result.reclaimed += 1;
      result.entries.push({ handleId: envelope.handleId, action: "failed_stale_runtime", message });
      continue;
    }

    await ackRuntimeEnvelopeFail(worldRoot, {
      runtimePath: candidate.path,
      retryCount: 0,
      maxRetries: 0,
      requeuePhase: "input"
    });
    result.malformed += 1;
    result.reclaimed += 1;
    result.entries.push({ filename: candidate.filename, action: "failed_malformed_runtime", error: candidate.error });
  }

  return result;
}

export function resolveGpuWorkerMaxPolls({
  pollIntervalMs = 250,
  maxPolls,
  timeoutMs = DEFAULT_GPU_REMOTE_JOB_TIMEOUT_MS
} = {}) {
  const explicitMaxPolls = Number(maxPolls);
  if (Number.isFinite(explicitMaxPolls) && explicitMaxPolls > 0) {
    return Math.max(1, Math.trunc(explicitMaxPolls));
  }
  const interval = Math.max(1, Number(pollIntervalMs) || 250);
  const timeout = Number(timeoutMs);
  const safeTimeout = Number.isFinite(timeout) && timeout > 0
    ? timeout
    : DEFAULT_GPU_REMOTE_JOB_TIMEOUT_MS;
  return Math.max(1, Math.ceil(safeTimeout / interval));
}

export function resolveGpuQueueWaitTimeoutMs({
  queueDepth = 1,
  baseTimeoutMs = 15 * 60 * 1000,
  explicitTimeoutMs,
  remoteJobTimeoutMs = DEFAULT_GPU_REMOTE_JOB_TIMEOUT_MS
} = {}) {
  const explicitTimeout = Number(explicitTimeoutMs);
  if (Number.isFinite(explicitTimeout) && explicitTimeout > 0) {
    return Math.trunc(explicitTimeout);
  }
  const depth = Math.max(1, Math.trunc(Number(queueDepth) || 1));
  const baseTimeout = Number(baseTimeoutMs);
  const safeBaseTimeout = Number.isFinite(baseTimeout) && baseTimeout > 0
    ? baseTimeout
    : 15 * 60 * 1000;
  const perJobTimeout = Number(remoteJobTimeoutMs);
  const safePerJobTimeout = Number.isFinite(perJobTimeout) && perJobTimeout > 0
    ? perJobTimeout
    : DEFAULT_GPU_REMOTE_JOB_TIMEOUT_MS;
  return Math.max(safeBaseTimeout, depth * safePerJobTimeout);
}

async function pollRemoteJob({ adapter, remoteJobId, pollIntervalMs, maxPolls, heartbeat }) {
  let lastPollError = null;
  for (let index = 0; index < maxPolls; index += 1) {
    let status;
    try {
      status = await adapter.getJobStatus({ remoteJobId });
      lastPollError = null;
    } catch (error) {
      lastPollError = error;
      if (typeof heartbeat === "function") await heartbeat();
      await delay(pollIntervalMs);
      continue;
    }
    const terminal = terminalStatus(status?.status);
    if (terminal) return { ...status, status: terminal };
    if (typeof heartbeat === "function") await heartbeat();
    await delay(pollIntervalMs);
  }
  if (lastPollError) throw new Error(`gpu worker could not read remote job ${remoteJobId}: ${shortError(lastPollError)}`);
  throw new Error(`gpu worker timed out waiting for remote job ${remoteJobId}`);
}

async function markQueued(worldRoot, envelope) {
  await writeGpuHandleStatus(worldRoot, envelope.handleId, {
    status: "queued",
    agentName: envelope.agentName,
    gpuId: envelope.gpuId,
    intent: envelope.intent,
    lane: envelope.lane,
    queuedAt: envelope.queuedAt,
    startedAt: "",
    finishedAt: "",
    retryCount: envelope.retryCount,
    outcome: "queued",
    message: "queued",
    result: "",
    error: ""
  });
}

async function markRunning(worldRoot, envelope) {
  await writeGpuHandleStatus(worldRoot, envelope.handleId, {
    status: "running",
    agentName: envelope.agentName,
    gpuId: envelope.gpuId,
    intent: envelope.intent,
    lane: envelope.lane,
    queuedAt: envelope.queuedAt,
    startedAt: new Date().toISOString(),
    retryCount: envelope.retryCount,
    outcome: "running",
    message: "running",
    error: ""
  });
}

export async function runGpuWorkerOnce({
  worldRoot,
  housekeeperUrl = "",
  adapter = null,
  workerTag = "gpu-worker",
  owner = "gpu-worker",
  hostId = "",
  gpuId = "",
  lane = "durable",
  pollIntervalMs = 250,
  maxPolls,
  remoteJobTimeoutMs = Number(process.env.PYA_GPU_WORKER_TIMEOUT_MS) || DEFAULT_GPU_REMOTE_JOB_TIMEOUT_MS,
  leaseTtlMs = 300000,
  retryMax = 0,
  leaseScope = "physical"
} = {}) {
  if (!worldRoot) throw new Error("gpu worker defective: worldRoot is required");
  if (!adapter && !normalizeText(housekeeperUrl)) {
    throw new Error("gpu worker defective: PYA_GPU_HOUSEKEEPER_URL is required");
  }

  const dependencySkips = [];
  const claimed = await claimOldestInputEnvelope(worldRoot, {
    workerTag,
    gpuId,
    lane,
    dependencyReady: async (envelope) => {
      const readiness = await gpuEnvelopeDependencyStatus(worldRoot, envelope);
      if (!readiness.ready) dependencySkips.push({
        handleId: envelope.handleId,
        reason: readiness.reason,
        dependencies: readiness.dependencies
      });
      return readiness;
    }
  });
  if (!claimed) {
    const depth = await queueDepth(worldRoot);
    return {
      received: 0,
      handled: 0,
      sent: 0,
      dependencyWaiting: dependencySkips,
      queueDepth: depth.total
    };
  }

  const envelope = claimed.envelope;
  await markQueued(worldRoot, envelope);
  const leaseId = dispatchLeaseId(envelope, leaseScope);
  const lease = await acquireGpuLease(worldRoot, {
    gpuId: leaseId,
    owner,
    handleId: envelope.handleId,
    ttlMs: leaseTtlMs
  });

  if (!lease.acquired) {
    await ackRuntimeEnvelopeFail(worldRoot, {
      runtimePath: claimed.path,
      retryCount: 0,
      maxRetries: 1,
      requeuePhase: "input"
    });
    const depth = await queueDepth(worldRoot);
    return { received: 1, handled: 0, sent: 0, busy: true, dependencyWaiting: dependencySkips, queueDepth: depth.total };
  }

  const housekeeper = resolveAdapter({ adapter, housekeeperUrl, hostId });
  const jobSpec = parseSpecMap(envelope.jobSpec);
  const runtimeName = normalizeText(envelope.serviceName || jobSpec.runtimeName);
  const profileName = normalizeText(envelope.residencyName || jobSpec.profileName);
  let success = false;

  try {
    if (!runtimeName || !profileName) {
      throw new Error("gpu worker defective: envelope missing serviceName/residencyName for housekeeper job");
    }

    await markRunning(worldRoot, envelope);
    const submit = await housekeeper.submitJob({
      handleId: envelope.handleId,
      runtimeName,
      profileName,
      jobSpec,
      deviceId: envelope.deviceId,
      dischargeAllowed: envelope.dischargeAllowed
    });
    const remoteJobId = remoteJobIdFromSubmit(submit);
    if (!remoteJobId) throw new Error("gpu worker defective: housekeeper did not return remoteJobId");

    const effectiveMaxPolls = resolveGpuWorkerMaxPolls({
      pollIntervalMs,
      maxPolls,
      timeoutMs: remoteJobTimeoutMs
    });
    const remote = await pollRemoteJob({
      adapter: housekeeper,
      remoteJobId,
      pollIntervalMs,
      maxPolls: effectiveMaxPolls,
      heartbeat: () => heartbeatGpuLease(worldRoot, {
        gpuId: leaseId,
        owner,
        handleId: envelope.handleId
      })
    });

    const finishedAt = normalizeText(remote.finishedAt) || new Date().toISOString();
    const message = normalizeText(remote.message) || remote.status;
    if (remote.status === "success") {
      success = true;
      await writeGpuHandleStatus(worldRoot, envelope.handleId, {
        status: "success",
        finishedAt,
        outcome: "success",
        message,
        result: jsonText(remote.result),
        error: ""
      });
      await ackRuntimeEnvelopeSuccess(worldRoot, { runtimePath: claimed.path });
    } else {
      await writeGpuHandleStatus(worldRoot, envelope.handleId, {
        status: "fail",
        finishedAt,
        retryCount: envelope.retryCount + 1,
        outcome: "fail",
        message,
        result: jsonText(remote.result),
        error: jsonText(remote.error ?? message)
      });
      await ackRuntimeEnvelopeFail(worldRoot, {
        runtimePath: claimed.path,
        retryCount: envelope.retryCount,
        maxRetries: retryMax,
        requeuePhase: "input"
      });
    }
  } catch (err) {
    await writeGpuHandleStatus(worldRoot, envelope.handleId, {
      status: "fail",
      finishedAt: new Date().toISOString(),
      retryCount: envelope.retryCount + 1,
      outcome: "fail",
      message: shortError(err),
      error: jsonText(shortError(err))
    });
    await ackRuntimeEnvelopeFail(worldRoot, {
      runtimePath: claimed.path,
      retryCount: envelope.retryCount,
      maxRetries: retryMax,
      requeuePhase: "input"
    });
  } finally {
    await releaseGpuLease(worldRoot, {
      gpuId: leaseId,
      owner,
      handleId: envelope.handleId
    });
  }

  const depth = await queueDepth(worldRoot);
  return {
    received: 1,
    handled: success ? 1 : 0,
    sent: success ? 1 : 0,
    dependencyWaiting: dependencySkips,
    queueDepth: depth.total
  };
}

async function runWorkerSafely(options) {
  try {
    return await runGpuWorkerOnce(options);
  } catch (error) {
    return {
      received: 0,
      handled: 0,
      sent: 0,
      queueDepth: 0,
      error: shortError(error)
    };
  }
}

export async function runGpuWorkerBatch({ concurrency = 2, ...options } = {}) {
  const limit = Math.max(1, Math.min(8, Math.trunc(Number(concurrency) || 1)));
  let staleRuntime = {
    scanned: 0,
    protected: 0,
    reclaimed: 0,
    completed: 0,
    malformed: 0,
    entries: []
  };
  const nowMs = Date.now();
  const gcIntervalMs = parsePositiveMs(options.staleRuntimeGcIntervalMs, DEFAULT_GPU_RUNTIME_GC_INTERVAL_MS);
  const lastGcAt = runtimeGcState.get(options.worldRoot) || 0;
  if (options.worldRoot && (nowMs - lastGcAt >= gcIntervalMs)) {
    runtimeGcState.set(options.worldRoot, nowMs);
    try {
      staleRuntime = await reclaimStaleGpuRuntime({
        worldRoot: options.worldRoot,
        staleMs: options.staleRuntimeMs,
        nowMs
      });
    } catch (error) {
      staleRuntime = {
        ...staleRuntime,
        error: shortError(error)
      };
    }
  }

  const pending = new Map();
  const results = [];
  let nextSlot = 0;
  let noWork = false;

  const start = () => {
    const slot = nextSlot++;
    const promise = runWorkerSafely({
      ...options,
      leaseScope: "dispatch",
      workerTag: `${options.workerTag || "gpu-worker"}-slot-${slot}`,
      owner: `${options.owner || "gpu-worker"}-slot-${slot}`
    });
    pending.set(promise, slot);
  };

  while (pending.size < limit) start();
  while (pending.size) {
    const completed = await Promise.race([...pending.keys()].map(async (promise) => ({
      promise,
      result: await promise
    })));
    pending.delete(completed.promise);
    results.push(completed.result);
    if (Number(completed.result?.received || 0) === 0) noWork = true;
    if (!noWork) start();
  }

  const summary = results.reduce((total, result) => ({
    received: total.received + Number(result?.received || 0),
    handled: total.handled + Number(result?.handled || 0),
    sent: total.sent + Number(result?.sent || 0),
    queueDepth: Math.max(total.queueDepth, Number(result?.queueDepth || 0)),
    dependencyWaiting: [...total.dependencyWaiting, ...(result?.dependencyWaiting || [])],
    errors: [...total.errors, ...(result?.error ? [result.error] : [])],
    busy: total.busy || result?.busy === true
  }), {
    received: 0,
    handled: 0,
    sent: 0,
    queueDepth: 0,
    dependencyWaiting: [],
    errors: [],
    busy: false
  });

  return { ...summary, staleRuntime };
}
