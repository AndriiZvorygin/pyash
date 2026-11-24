import assert from "node:assert/strict";
import test from "node:test";
import { typedDispatchCases } from "../command/vliw_gpu_conformance/typed_dispatch.mjs";
import { executeRustCpuReference, executeRustCpuProgramletFailureReference } from "../command/vliw_gpu_conformance.mjs";
import { createPinnedVliwPackExecutor } from "../program/library/vliw/rust_gpu_pack.mjs";

test("canonical VLIW overload packs execute on the Rust CPU reference", () => {
  const cases = typedDispatchCases();
  const successes = cases.filter(([, , expected]) => typeof expected === "object");
  assert.deepEqual(
    executeRustCpuReference(successes.map(([, pack]) => pack)),
    successes.map(([, , expected]) => [expected])
  );
  const [, invalid, code] = cases.at(-1);
  assert.equal(executeRustCpuProgramletFailureReference(invalid), code);
});

test("CUDA conformance submits a pinned Housekeeper job without discharging other runtimes", async () => {
  const [, pack, value] = typedDispatchCases()[0];
  const execute = createPinnedVliwPackExecutor({
    targetHostId: "swac",
    managerUrl: "http://housekeeper.test",
    secret: "test-secret",
    hostId: "mriczo",
    username: "htaf",
    async fetchImpl(url, request = {}) {
      if (url.endsWith("/submit-pyac")) {
        assert.equal(request.headers["x-pyash-target-host-id"], "swac");
        assert.equal(request.headers["x-pyash-discharge-allowed"], "false");
        assert.deepEqual(Buffer.from(request.body).subarray(-pack.byteLength), Buffer.from(pack));
        return { ok: true, status: 200, json: async () => ({ accepted: true, remoteJobId: "job-cuda" }) };
      }
      return { ok: true, status: 200, json: async () => ({
        status: "success",
        executionHostId: "swac",
        remoteJobId: "job-cuda",
        result: { ok: true, values: [value], backend: "rust-cuda-cubin", runtimeTimingMs: { kernelGpuMs: 1 } }
      }) };
    }
  });
  const result = await execute(pack);
  assert.deepEqual(result.values, [value]);
  assert.equal(result.housekeeperTiming.remoteJobId, "job-cuda");
});

test("a successful result from the wrong host cannot pass a pinned CUDA check", async () => {
  const [, pack] = typedDispatchCases()[0];
  const execute = createPinnedVliwPackExecutor({
    targetHostId: "swac",
    managerUrl: "http://housekeeper.test",
    secret: "test-secret",
    hostId: "mriczo",
    username: "htaf",
    async fetchImpl(url) {
      return url.endsWith("/submit-pyac")
        ? { ok: true, status: 200, json: async () => ({ accepted: true, remoteJobId: "job-wrong-host" }) }
        : { ok: true, status: 200, json: async () => ({
          status: "success", executionHostId: "mriczo", result: { ok: true, values: [], backend: "rust-cuda-cubin" }
        }) };
    }
  });
  await assert.rejects(execute(pack), /expected host swac, got mriczo/u);
});
