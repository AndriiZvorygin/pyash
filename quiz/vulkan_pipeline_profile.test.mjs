import assert from "node:assert/strict";
import test from "node:test";
import { parseStageLine, renderProfileReport } from "../rust/pyac-gpu/profile-pipeline-build.mjs";

test("pipeline profile maps Vulkan initialization and entry-point timing logs", () => {
  assert.deepEqual(parseStageLine("[pyac-vliw] creating programlet pipeline"), {
    stage: "programlet pipeline creation",
    complete: false,
    durationSeconds: null,
  });
  assert.deepEqual(parseStageLine("[pyac-vliw] programlet pipeline ready in 12.34s"), {
    stage: "programlet pipeline ready",
    complete: true,
    durationSeconds: 12.34,
  });
  assert.equal(parseStageLine("unrelated log line"), null);
});

test("pipeline profile report preserves stop stage and resource evidence", () => {
  const report = renderProfileReport({
    host: "swac",
    gpu: { name: "NVIDIA GeForce RTX 3060", driver: "535.247.01", freeMiB: 11000, utilization: 0 },
    compiler: "/tmp/pyac-vliw-pipeline-compiler",
    compilerPid: 12345,
    availableRamBytes: 24 * 1024 ** 3,
    result: "failed (exit null)",
    stopReason: "16-GiB process-tree RSS limit",
    elapsedMs: 60_000,
    peakRssBytes: 16 * 1024 ** 3,
    lastStage: "programlet pipeline creation",
    stages: [{ stage: "programlet pipeline creation", atMs: 35_000 }],
    artifact: null,
  });
  assert.match(report, /programlet pipeline creation/u);
  assert.match(report, /16-GiB process-tree RSS limit/u);
  assert.match(report, /does not compile Rust-GPU source to SPIR-V/u);
  assert.match(report, /Compiler PID: 12345/u);
});
