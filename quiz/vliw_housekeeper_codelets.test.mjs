import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { lowerSentence } from "../program/library/vliw/index.mjs";
import { encodePyacPack } from "../program/library/vliw/database.mjs";
import { createHousekeeperVliwPackExecutor } from "../program/library/vliw/rust_gpu_pack.mjs";

function numericPack() {
  const codelets = [
    "ob num 65535 with num 65535 be multiply do",
    "ob num 9 with num 4 be divide do",
    "ob num 7 to num 3 be xor do"
  ].flatMap((source) => lowerSentence(parse(source))).map((codelet) => codelet.words);
  return encodePyacPack(codelets);
}

test("Housekeeper Rust-GPU executor submits the original PyAC pack bytes", async () => {
  const pack = numericPack();
  const calls = [];
  const expected = {
    ok: true,
    backend: "rust-gpu-vulkan",
    device: "NVIDIA GeForce RTX 3090",
    values: [
      { type: "unsigned", value: 4_294_836_225 },
      { type: "unsigned", value: 2 },
      { type: "unsigned", value: 4 }
    ],
    runtimeTimingMs: {
      kernelGpuMs: 0.004,
      kernelTimingSource: "vulkan-timestamp-query"
    }
  };
  const execute = createHousekeeperVliwPackExecutor({
    managerUrl: "http://housekeeper.test",
    secret: "test-secret",
    hostId: "mriczo",
    username: "htaf",
    deviceId: "gpu0",
    makeHandleId: () => "pack-job-1",
    async fetchImpl(url, options = {}) {
      calls.push({ url, options });
      if (url.endsWith("/submit-pyac")) {
        assert.equal(options.method, "POST");
        assert.equal(options.headers["content-type"], "application/vnd.pyac-vliw-upload");
        assert.equal(Buffer.from(options.body).subarray(0, 8).toString("ascii"), "PYACVLIW");
        assert.equal(Buffer.from(options.body).includes(Buffer.from("packBase64")), false);
        return { ok: true, status: 200, json: async () => ({ accepted: true, remoteJobId: "remote-pack-1" }) };
      }
      assert.equal(url, "http://housekeeper.test/job/remote-pack-1");
      return { ok: true, status: 200, json: async () => ({
        status: "success",
        submittedAt: "2026-11-19T18:00:00.000Z",
        startedAt: "2026-11-19T18:00:00.025Z",
        finishedAt: "2026-11-19T18:00:00.075Z",
        remoteJobId: "remote-pack-1",
        executionHostId: "mriczo",
        result: expected
      }) };
    }
  });

  const result = await execute(pack);
  const { housekeeperTiming, ...payload } = result;
  assert.deepEqual(payload, expected);
  assert.equal(housekeeperTiming.handleId, "pack-job-1");
  assert.equal(housekeeperTiming.remoteJobId, "remote-pack-1");
  assert.equal(housekeeperTiming.queuedAt, "2026-11-19T18:00:00.000Z");
  assert.equal(housekeeperTiming.workerStartedAt, "2026-11-19T18:00:00.025Z");
  assert.equal(housekeeperTiming.workerFinishedAt, "2026-11-19T18:00:00.075Z");
  assert.equal(housekeeperTiming.localQueueWaitMs, 25);
  assert.equal(housekeeperTiming.workerWallMs, 50);
  assert.equal(housekeeperTiming.housekeeperQueueWaitMs, 25);
  assert.equal(housekeeperTiming.housekeeperActiveMs, 50);
  assert.equal(housekeeperTiming.executionHostId, "mriczo");
  assert.deepEqual(housekeeperTiming.runtimeTimingMs, expected.runtimeTimingMs);
  assert.ok(housekeeperTiming.clientRoundTripMs >= 0);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.headers["x-pyash-device-id"], "gpu0");
});

test("invalid PyAC bytes fail before the Housekeeper queue is touched", async () => {
  let submissions = 0;
  const execute = createHousekeeperVliwPackExecutor({
    managerUrl: "http://housekeeper.test",
    secret: "test-secret",
    hostId: "mriczo",
    username: "htaf",
    async fetchImpl() { submissions += 1; }
  });
  await assert.rejects(execute(new Uint8Array([1, 2, 3])), /shorter than its header/u);
  assert.equal(submissions, 0);
});

test("Housekeeper worker failures include the durable job identity", async () => {
  const execute = createHousekeeperVliwPackExecutor({
    managerUrl: "http://housekeeper.test",
    secret: "test-secret",
    hostId: "mriczo",
    username: "htaf",
    makeHandleId: () => "failed-pack-1",
    async fetchImpl(url) {
      return url.endsWith("/submit-pyac")
        ? { ok: true, status: 200, json: async () => ({ accepted: true, remoteJobId: "remote-failed" }) }
        : { ok: true, status: 200, json: async () => ({ status: "fail", error: "Vulkan adapter unavailable" }) };
    }
  });
  await assert.rejects(execute(numericPack()), /failed-pack-1 failed: Vulkan adapter unavailable/u);
});

test("Housekeeper failures preserve GPU service timings returned with runtime errors", async () => {
  const runtimeTimingMs = { kernelGpuMs: 0.006, kernelTimingSource: "vulkan-timestamp-query" };
  const execute = createHousekeeperVliwPackExecutor({
    managerUrl: "http://housekeeper.test",
    secret: "test-secret",
    hostId: "mriczo",
    username: "htaf",
    makeHandleId: () => "runtime-err-1",
    async fetchImpl(url) {
      return url.endsWith("/submit-pyac")
        ? { ok: true, status: 200, json: async () => ({ accepted: true, remoteJobId: "remote-runtime-error" }) }
        : { ok: true, status: 200, json: async () => ({
          status: "fail",
          error: JSON.stringify({
            message: `Rust VLIW runtime request failed 422: ${JSON.stringify({
              error: "programlet: shared VLIW runtime error 2",
              runtimeTimingMs
            })}`
          })
        }) };
    }
  });
  await assert.rejects(execute(numericPack()), (error) => {
    assert.deepEqual(error.housekeeperTiming.runtimeTimingMs, runtimeTimingMs);
    return true;
  });
});
