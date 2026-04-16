import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  readGpuHandleStatus,
  writeGpuHandleStatus,
  isTerminalHandleStatus
} from "../../../program/runtime/gpu/handle_status.mjs";

test("gpu handle status missing handle returns null", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-gpu-handle-missing-"));
  const worldRoot = path.join(root, "world");
  const missing = await readGpuHandleStatus(worldRoot, "no-such-handle");
  assert.equal(missing, null);
});

test("gpu handle status write then read round-trip works", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-gpu-handle-roundtrip-"));
  const worldRoot = path.join(root, "world");
  await writeGpuHandleStatus(worldRoot, "job-one", {
    status: "queued",
    agentName: "agent-a",
    gpuId: "gpu-0",
    intent: "verify",
    lane: "durable",
    queuedAt: "2026-03-02T10:00:00.000Z",
    startedAt: "",
    finishedAt: "",
    retryCount: 0,
    outcome: "queued",
    message: "queued"
  });
  const read = await readGpuHandleStatus(worldRoot, "job-one");
  assert.equal(read?.handleId, "job-one");
  assert.equal(read?.status, "queued");
  assert.equal(read?.agentName, "agent-a");
  assert.equal(read?.gpuId, "gpu-0");
  assert.equal(read?.message, "queued");
});

test("gpu handle status write merges existing data", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-gpu-handle-merge-"));
  const worldRoot = path.join(root, "world");
  await writeGpuHandleStatus(worldRoot, "job-merge", {
    status: "queued",
    agentName: "agent-a",
    gpuId: "gpu-0",
    intent: "verify",
    lane: "durable",
    queuedAt: "2026-03-02T10:01:00.000Z",
    startedAt: "",
    finishedAt: "",
    retryCount: 0,
    outcome: "queued",
    message: "queued"
  });
  await writeGpuHandleStatus(worldRoot, "job-merge", {
    status: "running",
    startedAt: "2026-03-02T10:01:05.000Z",
    message: "running"
  });
  const read = await readGpuHandleStatus(worldRoot, "job-merge");
  assert.equal(read?.status, "running");
  assert.equal(read?.startedAt, "2026-03-02T10:01:05.000Z");
  assert.equal(read?.queuedAt, "2026-03-02T10:01:00.000Z");
  assert.equal(read?.agentName, "agent-a");
  assert.equal(read?.gpuId, "gpu-0");
});

test("gpu handle status queued to running to success lifecycle persists", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-gpu-handle-success-"));
  const worldRoot = path.join(root, "world");
  await writeGpuHandleStatus(worldRoot, "job-success", {
    status: "queued",
    agentName: "agent-a",
    gpuId: "gpu-0",
    intent: "verify",
    lane: "durable",
    queuedAt: "2026-03-02T10:02:00.000Z",
    startedAt: "",
    finishedAt: "",
    retryCount: 0,
    outcome: "queued",
    message: "queued"
  });
  await writeGpuHandleStatus(worldRoot, "job-success", {
    status: "running",
    startedAt: "2026-03-02T10:02:03.000Z",
    outcome: "running",
    message: "running"
  });
  await writeGpuHandleStatus(worldRoot, "job-success", {
    status: "success",
    finishedAt: "2026-03-02T10:02:10.000Z",
    outcome: "success",
    message: "done"
  });
  const read = await readGpuHandleStatus(worldRoot, "job-success");
  assert.equal(read?.status, "success");
  assert.equal(read?.outcome, "success");
  assert.equal(read?.message, "done");
  assert.equal(read?.startedAt, "2026-03-02T10:02:03.000Z");
  assert.equal(read?.finishedAt, "2026-03-02T10:02:10.000Z");
});

test("gpu handle status queued to fail lifecycle persists", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-gpu-handle-fail-"));
  const worldRoot = path.join(root, "world");
  await writeGpuHandleStatus(worldRoot, "job-fail", {
    status: "queued",
    agentName: "agent-a",
    gpuId: "gpu-0",
    intent: "verify",
    lane: "durable",
    queuedAt: "2026-03-02T10:03:00.000Z",
    startedAt: "",
    finishedAt: "",
    retryCount: 0,
    outcome: "queued",
    message: "queued"
  });
  await writeGpuHandleStatus(worldRoot, "job-fail", {
    status: "fail",
    finishedAt: "2026-03-02T10:03:04.000Z",
    retryCount: 1,
    outcome: "fail",
    message: "boom"
  });
  const read = await readGpuHandleStatus(worldRoot, "job-fail");
  assert.equal(read?.status, "fail");
  assert.equal(read?.retryCount, 1);
  assert.equal(read?.outcome, "fail");
  assert.equal(read?.message, "boom");
});

test("gpu handle status terminal helper is true only for success and fail", () => {
  assert.equal(isTerminalHandleStatus("success"), true);
  assert.equal(isTerminalHandleStatus("fail"), true);
  assert.equal(isTerminalHandleStatus("queued"), false);
  assert.equal(isTerminalHandleStatus("running"), false);
  assert.equal(isTerminalHandleStatus("cancel"), false);
});

test("gpu handle status invalid writes are rejected", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-gpu-handle-invalid-"));
  const worldRoot = path.join(root, "world");

  await assert.rejects(
    () => writeGpuHandleStatus(worldRoot, "job-invalid", {
      status: "done",
      agentName: "agent-a",
      gpuId: "gpu-0",
      intent: "verify",
      lane: "durable",
      queuedAt: "2026-03-02T10:04:00.000Z",
      startedAt: "",
      finishedAt: "",
      retryCount: 0,
      outcome: "done",
      message: "bad status"
    }),
    /gpu handle status defective: invalid status/
  );

  await assert.rejects(
    () => writeGpuHandleStatus(worldRoot, "job-invalid-2", {
      status: "queued",
      agentName: "agent-a",
      gpuId: "gpu-0",
      intent: "verify",
      lane: "durable",
      queuedAt: "not-a-date",
      startedAt: "",
      finishedAt: "",
      retryCount: 0,
      outcome: "queued",
      message: "bad date"
    }),
    /gpu handle status defective: invalid queued at/
  );
});
