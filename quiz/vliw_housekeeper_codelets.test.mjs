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
  let submitted;
  const expected = {
    ok: true,
    backend: "rust-gpu-vulkan",
    device: "NVIDIA GeForce RTX 3090",
    values: [
      { type: "unsigned", value: 4_294_836_225 },
      { type: "unsigned", value: 2 },
      { type: "unsigned", value: 4 }
    ]
  };
  const execute = createHousekeeperVliwPackExecutor({
    worldRoot: "/tmp/pyash-world",
    deviceId: "gpu0",
    makeHandleId: () => "pack-job-1",
    async submitDuty(duty, options) {
      submitted = { duty, options };
    },
    async readStatus(worldRoot, handleId) {
      assert.equal(worldRoot, "/tmp/pyash-world");
      assert.equal(handleId, "pack-job-1");
      return {
        status: "success",
        queuedAt: "2026-11-19T18:00:00.000Z",
        startedAt: "2026-11-19T18:00:00.025Z",
        finishedAt: "2026-11-19T18:00:00.075Z",
        result: JSON.stringify(expected)
      };
    }
  });

  const result = await execute(pack);
  const { housekeeperTiming, ...payload } = result;
  assert.deepEqual(payload, expected);
  assert.equal(housekeeperTiming.handleId, "pack-job-1");
  assert.equal(housekeeperTiming.queuedAt, "2026-11-19T18:00:00.000Z");
  assert.equal(housekeeperTiming.startedAt, "2026-11-19T18:00:00.025Z");
  assert.equal(housekeeperTiming.finishedAt, "2026-11-19T18:00:00.075Z");
  assert.equal(housekeeperTiming.queueWaitMs, 25);
  assert.equal(housekeeperTiming.activeMs, 50);
  assert.ok(housekeeperTiming.clientRoundTripMs >= 0);
  assert.equal(submitted.duty.be, "gpu vliw");
  const jobSpec = JSON.parse(submitted.duty.ob.text);
  assert.equal(jobSpec.kind, "pyac-pack-execute");
  assert.equal(jobSpec.profileName, "pyac-vliw-rust-gpu");
  assert.equal(jobSpec.resourceRequest.deviceId, "gpu0");
  assert.ok(jobSpec.resourceRequest.vramRequiredMb >= 64);
  assert.deepEqual(Buffer.from(jobSpec.payload.packBase64, "base64"), Buffer.from(pack));
});

test("invalid PyAC bytes fail before the Housekeeper queue is touched", async () => {
  let submissions = 0;
  const execute = createHousekeeperVliwPackExecutor({
    async submitDuty() { submissions += 1; }
  });
  await assert.rejects(execute(new Uint8Array([1, 2, 3])), /shorter than its header/u);
  assert.equal(submissions, 0);
});

test("Housekeeper worker failures include the durable job identity", async () => {
  const execute = createHousekeeperVliwPackExecutor({
    makeHandleId: () => "pack-job-failed",
    async submitDuty() {},
    async readStatus() {
      return { status: "fail", error: "Vulkan adapter unavailable" };
    }
  });
  await assert.rejects(execute(numericPack()), /pack-job-failed failed: Vulkan adapter unavailable/u);
});
