import test from "node:test";
import assert from "node:assert/strict";

import {
  MAX_GPU_WORKER_CONCURRENCY,
  discoverGpuWorkerCapacity,
  parseGpuWorkerConcurrencyOverride,
  resolveGpuWorkerConcurrency
} from "../../../program/runtime/gpu/worker_capacity.mjs";

test("GPU worker defaults to reachable device count and accepts an explicit override", () => {
  assert.equal(resolveGpuWorkerConcurrency({ discoveredDeviceSlots: 5 }), 5);
  assert.equal(resolveGpuWorkerConcurrency({ discoveredDeviceSlots: 0 }), 1);
  assert.equal(parseGpuWorkerConcurrencyOverride("3"), 3);
  assert.equal(parseGpuWorkerConcurrencyOverride("0"), undefined);
  assert.equal(resolveGpuWorkerConcurrency({ requested: "7", discoveredDeviceSlots: 2 }), 7);
  assert.equal(resolveGpuWorkerConcurrency({ discoveredDeviceSlots: 100 }), MAX_GPU_WORKER_CONCURRENCY);
});

test("GPU worker capacity counts devices across reachable configured peers", async () => {
  const snapshots = new Map([
    ["http://entry", {
      hostId: "mriczo",
      devices: [{ deviceId: "gpu0" }, { deviceId: "gpu1" }],
      federation: { peers: [
        { hostId: "swac", url: "http://swac" },
        { hostId: "macstudio", url: "http://macstudio" },
        { hostId: "offline", url: "http://offline" }
      ] }
    }],
    ["http://swac", {
      hostId: "swac",
      devices: [{ deviceId: "gpu0" }],
      federation: { peers: [] }
    }],
    ["http://macstudio", {
      hostId: "macstudio",
      devices: [{ deviceId: "apple0" }, { deviceId: "apple1" }],
      federation: { peers: [] }
    }]
  ]);
  const adapterFactory = ({ baseUrl }) => ({
    async getSnapshot({ timeoutMs }) {
      assert.equal(timeoutMs, 1200);
      if (!snapshots.has(baseUrl)) throw new Error("peer unavailable");
      return snapshots.get(baseUrl);
    }
  });

  const capacity = await discoverGpuWorkerCapacity({
    housekeeperUrl: "http://entry",
    adapterFactory,
    timeoutMs: 1200
  });

  assert.deepEqual(capacity, {
    deviceSlots: 5,
    hostCount: 3,
    reachablePeerCount: 2
  });
});

test("GPU worker capacity uses execution slots when device telemetry is absent", async () => {
  const capacity = await discoverGpuWorkerCapacity({
    housekeeperUrl: "http://entry",
    adapterFactory: () => ({
      async getSnapshot() {
        return {
          hostId: "mriczo",
          devices: [],
          executionSlots: [{ deviceId: "gpu0" }, { deviceId: "gpu1" }],
          federation: { peers: [] }
        };
      }
    })
  });

  assert.equal(capacity.deviceSlots, 2);
});
