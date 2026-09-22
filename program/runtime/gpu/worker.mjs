import {
  claimOldestInputEnvelope,
  ackRuntimeEnvelopeSuccess,
  ackRuntimeEnvelopeFail,
  queueDepth
} from "./queue.mjs";
import { acquireGpuLease, heartbeatGpuLease, releaseGpuLease } from "./lease.mjs";
import { writeGpuHandleStatus } from "./handle_status.mjs";
import { createGpuHousekeeperAdapter } from "./housekeeper_adapter.mjs";
import { gpuEnvelopeDependencyStatus } from "./readiness.mjs";

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
  maxPolls = 1200,
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

    const remote = await pollRemoteJob({
      adapter: housekeeper,
      remoteJobId,
      pollIntervalMs,
      maxPolls,
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

  return results.reduce((total, result) => ({
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
}
