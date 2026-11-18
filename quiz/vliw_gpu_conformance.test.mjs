import test from "node:test";
import assert from "node:assert/strict";

import { decodePyacPack } from "../program/library/vliw/database.mjs";
import {
  buildVliwGpuConformanceCases,
  buildVliwGpuProgramletFailureCases,
  executeRustCpuReference,
  executeRustCpuProgramletFailureReference,
  runVliwGpuConformance,
  runVliwGpuProgramletFailureConformance
} from "../command/vliw_gpu_conformance.mjs";

test("Rust GPU conformance matrix matches the JavaScript references for typed and control-flow cases", async () => {
  const cases = await buildVliwGpuConformanceCases();

  assert.deepEqual(cases.map(({ name }) => name), [
    "nested-calls-and-isolated-locals",
    "numeric-branch",
    "bounded-loop",
    "nested-bounded-loops-through-calls",
    "conditional-call-composes-multi-action-arm",
    "typed-boolean-local",
    "scalar-and-vector-operators"
  ]);
  for (const testCase of cases) {
    assert.ok(decodePyacPack(testCase.pack).codelets.length > 0, `${testCase.name} lowers to PyAC`);
    assert.deepEqual(testCase.referenceValues, testCase.expectedValues, `${testCase.name} JavaScript oracle`);
  }
});

test("Rust GPU conformance matrix checks backend identity and exact typed outputs", async () => {
  const cases = await buildVliwGpuConformanceCases();
  const submissions = [];
  const progress = [];
  const completed = await runVliwGpuConformance({
    onProgress(event) { progress.push(event.phase); },
    async executeCpuPacks(packs) {
      return packs.map((pack) => {
        const testCase = cases.find((candidate) => Buffer.from(candidate.pack).equals(Buffer.from(pack)));
        assert.ok(testCase, "only declared conformance packs are checked by the CPU fixture");
        return testCase.referenceValues;
      });
    },
    async executePack(pack) {
      const testCase = cases.find((candidate) => Buffer.from(candidate.pack).equals(Buffer.from(pack)));
      assert.ok(testCase, "only declared conformance packs are submitted");
      submissions.push(testCase.name);
      return {
        ok: true,
        backend: "rust-gpu-vulkan",
        device: "fixture Vulkan GPU",
        values: testCase.referenceValues
      };
    }
  });

  assert.deepEqual(submissions, cases.map(({ name }) => name));
  assert.deepEqual(progress, [
    ...cases.map(() => "cpu-complete"),
    ...cases.flatMap(() => ["start", "complete"])
  ]);
  assert.equal(completed.length, cases.length);
  assert.equal(completed.at(-1).name, "scalar-and-vector-operators");
});

test("nested bounded loops agree with the Rust CPU pack executor", async () => {
  const testCase = (await buildVliwGpuConformanceCases()).find(
    ({ name }) => name === "nested-bounded-loops-through-calls"
  );

  assert.ok(testCase);
  const [rustValues] = executeRustCpuReference([testCase.pack]);
  assert.deepEqual(rustValues, testCase.referenceValues);
});

test("Rust GPU conformance matrix rejects wrong device or semantic results", async () => {
  const cases = await buildVliwGpuConformanceCases();
  const [first] = cases;
  const cpuReference = async (packs) => packs.map((pack) => {
    const testCase = cases.find((candidate) => Buffer.from(candidate.pack).equals(Buffer.from(pack)));
    assert.ok(testCase);
    return testCase.referenceValues;
  });
  await assert.rejects(
    runVliwGpuConformance({
      executeCpuPacks: cpuReference,
      async executePack() {
        return { ok: true, backend: "cpu-fallback", device: "CPU", values: first.expectedValues };
      }
    }),
    /unexpected GPU backend/u
  );

  await assert.rejects(
    runVliwGpuConformance({
      executeCpuPacks: async (packs) => packs.map((_, index) => index === 0
        ? [{ type: "unsigned", value: 99 }]
        : cases[index].referenceValues),
      async executePack() {
        return { ok: true, backend: "rust-gpu-vulkan", device: "GPU", values: first.referenceValues };
      }
    }),
    /Rust CPU result differs from JavaScript reference/u
  );

  await assert.rejects(
    runVliwGpuConformance({
      executeCpuPacks: cpuReference,
      async executePack() {
        return { ok: true, backend: "rust-gpu-vulkan", device: "GPU", values: [{ type: "unsigned", value: 99 }] };
      }
    }),
    /typed result differs from JavaScript reference/u
  );
});

test("programlet runtime failures preserve shared error codes across JS, Rust CPU, and Vulkan", async () => {
  const cases = await buildVliwGpuProgramletFailureCases();
  assert.deepEqual(cases.map(({ name, expectedRuntimeCode }) => [name, expectedRuntimeCode]), [
    ["programlet-division-by-zero", 2],
    ["programlet-constant-write", 7]
  ]);

  for (const testCase of cases) {
    assert.equal(
      executeRustCpuProgramletFailureReference(testCase.pack),
      testCase.expectedRuntimeCode,
      `${testCase.name}: Rust CPU error code`
    );
  }

  const submissions = [];
  const completed = await runVliwGpuProgramletFailureConformance({
    async executeCpuError(pack) {
      const testCase = cases.find((candidate) => Buffer.from(candidate.pack).equals(Buffer.from(pack)));
      assert.ok(testCase);
      return testCase.expectedRuntimeCode;
    },
    async executePack(pack) {
      const testCase = cases.find((candidate) => Buffer.from(candidate.pack).equals(Buffer.from(pack)));
      assert.ok(testCase);
      submissions.push(testCase.name);
      throw new Error(`Housekeeper worker: programlet: shared VLIW runtime error ${testCase.expectedRuntimeCode}`);
    }
  });

  assert.deepEqual(submissions, cases.map(({ name }) => name));
  assert.deepEqual(completed, cases.map(({ name, expectedRuntimeCode }) => ({
    name,
    errorCode: expectedRuntimeCode
  })));
});
