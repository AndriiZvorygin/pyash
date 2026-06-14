import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { enqueueInputEnvelope, queueDepth } from "../../../program/runtime/gpu/queue.mjs";
import { acquireGpuLease, releaseGpuLease } from "../../../program/runtime/gpu/lease.mjs";
import { readGpuHandleStatus } from "../../../program/runtime/gpu/handle_status.mjs";
import { runGpuWorkerOnce } from "../../../program/runtime/gpu/worker.mjs";

function payload(text) {
  return {
    mood: "do",
    be: "gpu mind",
    ob: { text: String(text ?? "") }
  };
}

async function enqueueMind(worldRoot, overrides = {}) {
  await enqueueInputEnvelope(worldRoot, {
    queuedAt: "2026-03-10T10:00:00.000Z",
    handleId: "mind-job-one",
    agentName: "mind-ollama-runner",
    gpuId: "gpu-0",
    intent: "mind",
    lane: "durable",
    payloadSentence: payload("hello"),
    serviceName: "ollama",
    residencyName: "qwen-test",
    residencyRequired: true,
    beginRequired: true,
    dischargeAllowed: true,
    jobSpec: {
      kind: "ollama-generate",
      payload: { mode: "generate", model: "qwen-test", prompt: "hello" }
    },
    ...overrides
  });
}

test("gpu worker claims oldest envelope, submits to housekeeper, and writes success handle status", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-gpu-worker-success-"));
  const worldRoot = path.join(root, "world");
  const calls = [];

  await enqueueMind(worldRoot);
  const result = await runGpuWorkerOnce({
    worldRoot,
    pollIntervalMs: 1,
    maxPolls: 5,
    adapter: {
      async submitJob(args) {
        calls.push(["submit", args]);
        return { remoteJobId: "remote-one" };
      },
      async getJobStatus(args) {
        calls.push(["status", args]);
        return {
          status: "success",
          message: "completed",
          result: { response: "hello back" },
          finishedAt: "2026-03-10T10:00:05.000Z"
        };
      }
    }
  });

  assert.equal(result.received, 1);
  assert.equal(result.handled, 1);
  assert.equal(calls[0][0], "submit");
  assert.equal(calls[0][1].runtimeName, "ollama");
  assert.equal(calls[0][1].profileName, "qwen-test");
  assert.equal(calls[0][1].jobSpec.kind, "ollama-generate");

  const status = await readGpuHandleStatus(worldRoot, "mind-job-one");
  assert.equal(status?.status, "success");
  assert.deepEqual(JSON.parse(status.result), { response: "hello back" });

  const depth = await queueDepth(worldRoot);
  assert.equal(depth.total, 0);
});

test("gpu worker requeues predictably when the gpu lease is busy", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-gpu-worker-busy-"));
  const worldRoot = path.join(root, "world");
  await enqueueMind(worldRoot, { handleId: "mind-job-busy" });
  const held = await acquireGpuLease(worldRoot, {
    gpuId: "gpu-0",
    owner: "other-worker",
    handleId: "held-job",
    ttlMs: 30000
  });
  assert.equal(held.acquired, true);

  const result = await runGpuWorkerOnce({
    worldRoot,
    adapter: {
      async submitJob() {
        throw new Error("should not submit while busy");
      },
      async getJobStatus() {
        throw new Error("should not poll while busy");
      }
    }
  });

  assert.equal(result.busy, true);
  const depth = await queueDepth(worldRoot);
  assert.equal(depth.input, 1);
  await releaseGpuLease(worldRoot, { gpuId: "gpu-0", owner: "other-worker", handleId: "held-job" });
});

test("gpu worker writes fail handle status when remote job fails", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-gpu-worker-fail-"));
  const worldRoot = path.join(root, "world");
  await enqueueMind(worldRoot, { handleId: "mind-job-fail" });

  const result = await runGpuWorkerOnce({
    worldRoot,
    pollIntervalMs: 1,
    maxPolls: 5,
    adapter: {
      async submitJob() {
        return { remoteJobId: "remote-fail" };
      },
      async getJobStatus() {
        return {
          status: "fail",
          message: "remote boom",
          error: { message: "remote boom" },
          finishedAt: "2026-03-10T10:01:05.000Z"
        };
      }
    }
  });

  assert.equal(result.handled, 0);
  const status = await readGpuHandleStatus(worldRoot, "mind-job-fail");
  assert.equal(status?.status, "fail");
  assert.equal(status?.message, "remote boom");
  assert.deepEqual(JSON.parse(status.error), { message: "remote boom" });

  const depth = await queueDepth(worldRoot);
  assert.equal(depth.total, 0);
});
