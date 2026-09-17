import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeGpuId,
  normalizeLane,
  normalizeHandleId,
  normalizeDependencyHandles,
  buildGpuQueueEnvelope,
  assertGpuQueueEnvelope
} from "../../../program/runtime/gpu/contract.mjs";

test("gpu contract queue envelope normalization works", () => {
  const envelope = buildGpuQueueEnvelope({
    handleId: "Handle One",
    agentName: "  agent-one  ",
    gpuId: " RTX 4090:0 ",
    intent: " Verify ",
    lane: " FAST ",
    queuedAt: "2026-03-01T10:00:00.000Z",
    retryCount: 2,
    payloadSentence: { mood: "do", be: "gpu verify", ob: { text: "hello" } }
  });

  assert.equal(envelope.handleId, "handle-one");
  assert.equal(envelope.agentName, "agent-one");
  assert.equal(envelope.gpuId, "rtx-4090:0");
  assert.equal(envelope.intent, "verify");
  assert.equal(envelope.lane, "fast");
  assert.equal(envelope.retryCount, 2);
  assert.deepEqual(envelope.dependsOnHandles, []);
  assert.ok(envelope.payloadSentence);
  assert.doesNotThrow(() => assertGpuQueueEnvelope(envelope));
});

test("gpu contract validator rejects malformed queue envelopes", () => {
  assert.throws(
    () => assertGpuQueueEnvelope({}),
    /gpu queue envelope defective: missing handle id/
  );
  assert.throws(
    () => assertGpuQueueEnvelope({
      handleId: "h1",
      agentName: "a1",
      gpuId: "",
      intent: "verify",
      lane: "durable",
      queuedAt: "2026-03-01T10:00:00.000Z",
      retryCount: 0,
      payloadSentence: { mood: "do" }
    }),
    /gpu queue envelope defective: missing gpu id/
  );
  assert.throws(
    () => assertGpuQueueEnvelope({
      handleId: "h1",
      agentName: "a1",
      gpuId: "gpu-0",
      intent: "verify",
      lane: "durable",
      queuedAt: "bad-date",
      retryCount: 0,
      payloadSentence: { mood: "do" }
    }),
    /gpu queue envelope defective: invalid queued at/
  );
});

test("gpu id, lane, and handle id normalization is stable", () => {
  assert.equal(normalizeGpuId("  RTX__4090:0  "), "rtx__4090:0");
  assert.equal(normalizeGpuId(""), "");
  assert.equal(normalizeLane("  durable  "), "durable");
  assert.equal(normalizeLane("", "durable"), "durable");
  assert.equal(normalizeHandleId("  Handle__ABC  "), "handle__abc");
  assert.equal(normalizeHandleId(""), "");
  assert.deepEqual(normalizeDependencyHandles(["First Handle", "first-handle", ""]), ["first-handle"]);
});

test("gpu queue envelope carries explicit handle dependencies", () => {
  const envelope = buildGpuQueueEnvelope({
    handleId: "consumer",
    agentName: "agent-a",
    gpuId: "gpu-0",
    intent: "verify",
    payloadSentence: { mood: "do", be: "gpu verify", ob: { text: "consumer" } },
    jobSpec: { kind: "sleep", dependsOnHandles: ["producer"] },
    dependsOnHandles: ["second", "producer"]
  });

  assert.deepEqual(envelope.dependsOnHandles, ["second", "producer"]);
  assert.doesNotThrow(() => assertGpuQueueEnvelope(envelope));
});
