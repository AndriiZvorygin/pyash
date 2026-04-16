import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  writeGpuHealthSnapshot,
  readGpuHealthSnapshotSync
} from "../../../program/runtime/gpu/health_snapshot.mjs";

test("gpu health snapshot missing file returns null", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-gpu-health-missing-"));
  const worldRoot = path.join(root, "world");
  const read = readGpuHealthSnapshotSync(worldRoot);
  assert.equal(read, null);
});

test("gpu health snapshot write then read round-trip works", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-gpu-health-roundtrip-"));
  const worldRoot = path.join(root, "world");
  await writeGpuHealthSnapshot({
    worldRoot,
    queueDepth: 4,
    healthy: true,
    statusText: "ready",
    activeMode: "durable",
    leaseCount: 2,
    workerSeenAt: "2026-03-03T11:00:00.000Z",
    updatedAt: "2026-03-03T11:00:01.000Z"
  });
  const read = readGpuHealthSnapshotSync(worldRoot);
  assert.equal(read?.queueDepth, 4);
  assert.equal(read?.healthy, true);
  assert.equal(read?.statusText, "ready");
  assert.equal(read?.activeMode, "durable");
  assert.equal(read?.leaseCount, 2);
  assert.equal(read?.workerSeenAt, "2026-03-03T11:00:00.000Z");
  assert.equal(read?.updatedAt, "2026-03-03T11:00:01.000Z");
});

test("gpu health snapshot queueDepth and leaseCount normalize to non-negative integers", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-gpu-health-normalize-"));
  const worldRoot = path.join(root, "world");
  await writeGpuHealthSnapshot({
    worldRoot,
    queueDepth: -3.7,
    healthy: true,
    statusText: "ready",
    activeMode: "",
    leaseCount: "7.8",
    workerSeenAt: "",
    updatedAt: "2026-03-03T11:01:00.000Z"
  });
  const read = readGpuHealthSnapshotSync(worldRoot);
  assert.equal(read?.queueDepth, 0);
  assert.equal(read?.leaseCount, 7);
});

test("gpu health snapshot rejects invalid updatedAt", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-gpu-health-invalid-time-"));
  const worldRoot = path.join(root, "world");
  await assert.rejects(
    () => writeGpuHealthSnapshot({
      worldRoot,
      queueDepth: 0,
      healthy: true,
      statusText: "ready",
      activeMode: "",
      leaseCount: 0,
      workerSeenAt: "",
      updatedAt: "not-a-date"
    }),
    /gpu health defective: invalid updated at/
  );
});

test("gpu health snapshot healthy false persists correctly", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-gpu-health-false-"));
  const worldRoot = path.join(root, "world");
  await writeGpuHealthSnapshot({
    worldRoot,
    queueDepth: 1,
    healthy: false,
    statusText: "degraded",
    activeMode: "durable",
    leaseCount: 1,
    workerSeenAt: "2026-03-03T11:02:00.000Z",
    updatedAt: "2026-03-03T11:02:01.000Z"
  });
  const read = readGpuHealthSnapshotSync(worldRoot);
  assert.equal(read?.healthy, false);
  assert.equal(read?.statusText, "degraded");
});

test("gpu health snapshot later write replaces prior snapshot cleanly", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-gpu-health-replace-"));
  const worldRoot = path.join(root, "world");
  const target = path.join(worldRoot, "conduct", "service", "gpu_health.pya");

  await writeGpuHealthSnapshot({
    worldRoot,
    queueDepth: 9,
    healthy: true,
    statusText: "ready",
    activeMode: "fast",
    leaseCount: 4,
    workerSeenAt: "2026-03-03T11:03:00.000Z",
    updatedAt: "2026-03-03T11:03:01.000Z"
  });
  await writeGpuHealthSnapshot({
    worldRoot,
    queueDepth: 1,
    healthy: false,
    statusText: "degraded",
    activeMode: "durable",
    leaseCount: 0,
    workerSeenAt: "2026-03-03T11:03:05.000Z",
    updatedAt: "2026-03-03T11:03:06.000Z"
  });

  const read = readGpuHealthSnapshotSync(worldRoot);
  assert.equal(read?.queueDepth, 1);
  assert.equal(read?.healthy, false);
  assert.equal(read?.statusText, "degraded");
  assert.equal(read?.activeMode, "durable");
  assert.equal(read?.leaseCount, 0);
  assert.equal(read?.workerSeenAt, "2026-03-03T11:03:05.000Z");
  assert.equal(read?.updatedAt, "2026-03-03T11:03:06.000Z");

  const text = await fs.readFile(target, "utf8");
  const occurrences = (text.match(/su name gpu health be map def/g) || []).length;
  assert.equal(occurrences, 1);
});
