import test from "node:test";
import assert from "node:assert/strict";

import { decodePyacPack } from "../program/library/vliw/database.mjs";
import {
  buildVliwGpuConformanceCases,
  runVliwGpuConformance
} from "../command/vliw_gpu_conformance.mjs";

test("Rust GPU conformance matrix compiles the supported typed and control-flow cases", () => {
  const cases = buildVliwGpuConformanceCases();

  assert.deepEqual(cases.map(({ name }) => name), [
    "nested-calls-and-isolated-locals",
    "numeric-branch",
    "bounded-loop",
    "typed-boolean-local",
    "scalar-arithmetic",
    "vector-arithmetic"
  ]);
  for (const testCase of cases) {
    assert.ok(decodePyacPack(testCase.pack).codelets.length > 0, `${testCase.name} lowers to PyAC`);
  }
});

test("Rust GPU conformance matrix checks backend identity and exact typed outputs", async () => {
  const cases = buildVliwGpuConformanceCases();
  const submissions = [];
  const progress = [];
  const completed = await runVliwGpuConformance({
    onProgress(event) { progress.push(event.phase); },
    async executePack(pack) {
      const testCase = cases.find((candidate) => Buffer.from(candidate.pack).equals(Buffer.from(pack)));
      assert.ok(testCase, "only declared conformance packs are submitted");
      submissions.push(testCase.name);
      return {
        ok: true,
        backend: "rust-gpu-vulkan",
        device: "fixture Vulkan GPU",
        values: testCase.expectedValues
      };
    }
  });

  assert.deepEqual(submissions, cases.map(({ name }) => name));
  assert.deepEqual(progress, cases.flatMap(() => ["start", "complete"]));
  assert.equal(completed.length, cases.length);
  assert.equal(completed.at(-1).name, "vector-arithmetic");
});

test("Rust GPU conformance matrix rejects wrong device or semantic results", async () => {
  const [first] = buildVliwGpuConformanceCases();
  await assert.rejects(
    runVliwGpuConformance({
      async executePack() {
        return { ok: true, backend: "cpu-fallback", device: "CPU", values: first.expectedValues };
      }
    }),
    /unexpected GPU backend/u
  );

  await assert.rejects(
    runVliwGpuConformance({
      async executePack() {
        return { ok: true, backend: "rust-gpu-vulkan", device: "GPU", values: [{ type: "unsigned", value: 99 }] };
      }
    }),
    /typed result mismatch/u
  );
});
