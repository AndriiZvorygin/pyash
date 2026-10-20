import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";

import { resolveGpuSourceIdentity } from "../../../program/runtime/gpu/source_identity.mjs";

test("GPU source identity defaults to the current host and OS account", () => {
  assert.deepEqual(resolveGpuSourceIdentity(), {
    hostId: os.hostname(),
    username: os.userInfo().username,
  });
});

test("GPU source identity accepts explicit host and username overrides", () => {
  assert.deepEqual(resolveGpuSourceIdentity({ hostId: "worker-2", username: "htaf" }), {
    hostId: "worker-2",
    username: "htaf",
  });
});

test("PYA_GPU_USERNAME overrides the OS account for source attribution", () => {
  const previous = process.env.PYA_GPU_USERNAME;
  process.env.PYA_GPU_USERNAME = "receipt-agent";
  try {
    assert.equal(resolveGpuSourceIdentity().username, "receipt-agent");
  } finally {
    if (previous === undefined) delete process.env.PYA_GPU_USERNAME;
    else process.env.PYA_GPU_USERNAME = previous;
  }
});
