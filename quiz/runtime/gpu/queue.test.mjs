import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  gpuQueuePaths,
  ensureGpuQueueDirs,
  enqueueInputEnvelope,
  claimOldestInputEnvelope,
  ackRuntimeEnvelopeFail,
  queueDepth
} from "../../../program/runtime/gpu/queue.mjs";

function payload(text) {
  return {
    mood: "do",
    be: "gpu verify",
    ob: { text: String(text ?? "") }
  };
}

test("gpu queue creates expected directory layout under world/holding/gpu", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-gpu-queue-layout-"));
  const worldRoot = path.join(root, "world");
  const paths = await ensureGpuQueueDirs(worldRoot);
  assert.equal(paths.root, path.join(worldRoot, "holding", "gpu"));

  const statInput = await fs.stat(paths.inputDir);
  const statRuntime = await fs.stat(paths.runtimeDir);
  const statProduce = await fs.stat(paths.produceDir);
  const statSuccess = await fs.stat(paths.produceSuccessDir);
  const statFail = await fs.stat(paths.produceFailDir);
  const statTmp = await fs.stat(paths.tmpDir);
  assert.equal(statInput.isDirectory(), true);
  assert.equal(statRuntime.isDirectory(), true);
  assert.equal(statProduce.isDirectory(), true);
  assert.equal(statSuccess.isDirectory(), true);
  assert.equal(statFail.isDirectory(), true);
  assert.equal(statTmp.isDirectory(), true);
});

test("gpu queue enqueues two input envelopes and claims oldest-first", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-gpu-queue-order-"));
  const worldRoot = path.join(root, "world");

  await enqueueInputEnvelope(worldRoot, {
    queuedAt: "2026-03-01T10:00:10.000Z",
    handleId: "job-old",
    agentName: "agent-a",
    gpuId: "gpu-0",
    intent: "verify",
    lane: "durable",
    payloadSentence: payload("old")
  });
  await enqueueInputEnvelope(worldRoot, {
    queuedAt: "2026-03-01T10:00:11.000Z",
    handleId: "job-new",
    agentName: "agent-a",
    gpuId: "gpu-0",
    intent: "verify",
    lane: "durable",
    payloadSentence: payload("new")
  });

  const first = await claimOldestInputEnvelope(worldRoot, { workerTag: "gpu-worker" });
  assert.equal(first?.envelope?.handleId, "job-old");
  assert.equal(first?.envelope?.payloadSentence?.ob?.text, "old");
});

test("gpu queue claim filters by lane and gpuId", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-gpu-queue-scope-"));
  const worldRoot = path.join(root, "world");

  await enqueueInputEnvelope(worldRoot, {
    queuedAt: "2026-03-01T10:01:10.000Z",
    handleId: "job-fast-g1",
    agentName: "agent-a",
    gpuId: "gpu-1",
    intent: "verify",
    lane: "fast",
    payloadSentence: payload("fast-g1")
  });
  await enqueueInputEnvelope(worldRoot, {
    queuedAt: "2026-03-01T10:01:11.000Z",
    handleId: "job-durable-g0",
    agentName: "agent-a",
    gpuId: "gpu-0",
    intent: "verify",
    lane: "durable",
    payloadSentence: payload("durable-g0")
  });

  const wrongLane = await claimOldestInputEnvelope(worldRoot, {
    workerTag: "gpu-worker",
    gpuId: "gpu-0",
    lane: "fast"
  });
  assert.equal(wrongLane, null);

  const rightScope = await claimOldestInputEnvelope(worldRoot, {
    workerTag: "gpu-worker",
    gpuId: "gpu-1",
    lane: "fast"
  });
  assert.equal(rightScope?.envelope?.handleId, "job-fast-g1");
});

test("gpu queue fail ack requeues before maxRetries", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-gpu-queue-requeue-"));
  const worldRoot = path.join(root, "world");

  await enqueueInputEnvelope(worldRoot, {
    queuedAt: "2026-03-01T10:02:10.000Z",
    handleId: "job-retry",
    agentName: "agent-a",
    gpuId: "gpu-0",
    intent: "verify",
    lane: "durable",
    payloadSentence: payload("retry")
  });
  const claim = await claimOldestInputEnvelope(worldRoot, { workerTag: "gpu-worker" });
  const nextPath = await ackRuntimeEnvelopeFail(worldRoot, {
    runtimePath: claim.path,
    retryCount: 0,
    maxRetries: 2,
    requeuePhase: "input"
  });
  assert.match(nextPath, /\/input\//);

  const depth = await queueDepth(worldRoot);
  assert.equal(depth.input, 1);
});

test("gpu queue fail ack sends to produce/fail at retry cap", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-gpu-queue-failout-"));
  const worldRoot = path.join(root, "world");
  const paths = gpuQueuePaths(worldRoot);

  await enqueueInputEnvelope(worldRoot, {
    queuedAt: "2026-03-01T10:03:10.000Z",
    handleId: "job-failout",
    agentName: "agent-a",
    gpuId: "gpu-0",
    intent: "verify",
    lane: "durable",
    payloadSentence: payload("failout")
  });
  const claim = await claimOldestInputEnvelope(worldRoot, { workerTag: "gpu-worker" });
  const failedPath = await ackRuntimeEnvelopeFail(worldRoot, {
    runtimePath: claim.path,
    retryCount: 2,
    maxRetries: 2,
    requeuePhase: "input"
  });
  assert.match(failedPath, /produce\/fail\//);

  const depth = await queueDepth(worldRoot);
  assert.equal(depth.input, 0);
  assert.equal(depth.runtime, 0);
  assert.equal(depth.produceWaiting, 0);
  const failed = await fs.readdir(paths.produceFailDir);
  assert.equal(failed.length, 1);
});
