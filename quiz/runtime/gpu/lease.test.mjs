import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  acquireGpuLease,
  heartbeatGpuLease,
  releaseGpuLease,
  readGpuLease
} from "../../../program/runtime/gpu/lease.mjs";

test("gpu lease first owner acquires lease", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-gpu-lease-first-"));
  const worldRoot = path.join(root, "world");
  const first = await acquireGpuLease(worldRoot, {
    gpuId: "gpu-0",
    owner: "worker-a",
    handleId: "h1",
    ttlMs: 10000
  });
  assert.equal(first.acquired, true);
  assert.equal(first.lease?.owner, "worker-a");
});

test("gpu lease blocks second owner while lease is fresh", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-gpu-lease-busy-"));
  const worldRoot = path.join(root, "world");
  await acquireGpuLease(worldRoot, {
    gpuId: "gpu-0",
    owner: "worker-a",
    handleId: "h1",
    ttlMs: 10000
  });

  const second = await acquireGpuLease(worldRoot, {
    gpuId: "gpu-0",
    owner: "worker-b",
    handleId: "h2",
    ttlMs: 10000
  });
  assert.equal(second.acquired, false);
  assert.equal(second.reason, "busy");
});

test("gpu lease stale lease can be reclaimed", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-gpu-lease-stale-"));
  const worldRoot = path.join(root, "world");
  await acquireGpuLease(worldRoot, {
    gpuId: "gpu-0",
    owner: "worker-a",
    handleId: "h1",
    ttlMs: 1000
  });

  await new Promise((resolve) => setTimeout(resolve, 1150));
  const second = await acquireGpuLease(worldRoot, {
    gpuId: "gpu-0",
    owner: "worker-b",
    handleId: "h2",
    ttlMs: 1000
  });
  assert.equal(second.acquired, true);
  assert.equal(second.lease?.owner, "worker-b");
});

test("gpu lease heartbeat refreshes lease", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-gpu-lease-heartbeat-"));
  const worldRoot = path.join(root, "world");
  await acquireGpuLease(worldRoot, {
    gpuId: "gpu-0",
    owner: "worker-a",
    handleId: "h1",
    ttlMs: 10000
  });

  const before = await readGpuLease(worldRoot, { gpuId: "gpu-0" });
  await new Promise((resolve) => setTimeout(resolve, 25));
  const beat = await heartbeatGpuLease(worldRoot, {
    gpuId: "gpu-0",
    owner: "worker-a",
    handleId: "h1"
  });
  const after = await readGpuLease(worldRoot, { gpuId: "gpu-0" });
  assert.ok(beat);
  assert.notEqual(after?.heartbeatAt, before?.heartbeatAt);
});

test("gpu lease only owner can release", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-gpu-lease-release-"));
  const worldRoot = path.join(root, "world");
  await acquireGpuLease(worldRoot, {
    gpuId: "gpu-0",
    owner: "worker-a",
    handleId: "h1",
    ttlMs: 10000
  });

  const wrong = await releaseGpuLease(worldRoot, {
    gpuId: "gpu-0",
    owner: "worker-b",
    handleId: "h1"
  });
  assert.equal(wrong, false);
  const stillThere = await readGpuLease(worldRoot, { gpuId: "gpu-0" });
  assert.ok(stillThere);

  const right = await releaseGpuLease(worldRoot, {
    gpuId: "gpu-0",
    owner: "worker-a",
    handleId: "h1"
  });
  assert.equal(right, true);
  const gone = await readGpuLease(worldRoot, { gpuId: "gpu-0" });
  assert.equal(gone, null);
});
