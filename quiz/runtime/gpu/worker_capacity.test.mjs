import test from "node:test";
import assert from "node:assert/strict";

import {
  MAX_GPU_WORKER_CONCURRENCY,
  discoverGpuWorkerCapacity,
  parseGpuWorkerConcurrencyOverride,
  resolveGpuWorkerConcurrency
} from "../../../program/runtime/gpu/worker_capacity.mjs";

test("GPU worker defaults to Housekeeper dispatch slots and accepts an explicit override", () => {
  assert.equal(resolveGpuWorkerConcurrency({ discoveredDispatchSlots: 5 }), 5);
  assert.equal(resolveGpuWorkerConcurrency({ discoveredDispatchSlots: 0 }), 1);
  assert.equal(parseGpuWorkerConcurrencyOverride("3"), 3);
  assert.equal(parseGpuWorkerConcurrencyOverride("0"), undefined);
  assert.equal(resolveGpuWorkerConcurrency({ requested: "7", discoveredDispatchSlots: 2 }), 7);
  assert.equal(resolveGpuWorkerConcurrency({ discoveredDispatchSlots: 100 }), MAX_GPU_WORKER_CONCURRENCY);
});

test("GPU worker fan-out uses primary Housekeeper devices and configured peer slots", async () => {
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
      if (baseUrl !== "http://entry") throw new Error("worker must not probe peers directly");
      return snapshots.get(baseUrl);
    }
  });

  const capacity = await discoverGpuWorkerCapacity({
    housekeeperUrl: "http://entry",
    adapterFactory,
    timeoutMs: 1200
  });

  assert.deepEqual(capacity, {
    dispatchSlots: 5,
    hostCount: 4,
    configuredPeerCount: 3,
    localDeviceSlots: 2
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

  assert.equal(capacity.dispatchSlots, 2);
});
