import test from "node:test";
import assert from "node:assert/strict";

import { decodePyacPack } from "../program/library/vliw/database.mjs";
import { executePyashProgramPack } from "../program/library/vliw/programlet.mjs";
import {
  buildVliwGpuConformanceCases,
  buildVliwGpuProgramletFailureCases,
  executeRustCpuReference,
  executeRustCpuProgramletFailureReference,
  runVliwGpuConformance,
  runVliwGpuProgramletFailureConformance
} from "../command/vliw_gpu_conformance.mjs";

function referenceValue(output) {
  if (typeof output?.boolean === "boolean") return { type: "boolean", value: output.boolean };
  if (typeof output?.num === "number") {
    return {
      type: output.num < 0 ? "signed" : "unsigned",
      value: output.num
    };
  }
  assert.fail("unsupported programlet reference result: " + JSON.stringify(output));
}

function valuesForPacks(cases, packs) {
  return packs.map((pack) => {
    const testCase = cases.find((candidate) => Buffer.from(candidate.pack).equals(Buffer.from(pack)));
    assert.ok(testCase, "only declared conformance packs are checked by the CPU fixture");
    return testCase.referenceValues;
  });
}

test("VLIW GPU conformance matrix covers the merged typed and control-flow contract", async () => {
  const cases = await buildVliwGpuConformanceCases();

  assert.deepEqual(cases.map(({ name }) => name), [
    "nested-calls-and-isolated-locals",
    "numeric-branch",
    "bounded-loop",
    "nested-bounded-loops-keep-independent-cursors",
    "nested-bounded-loops-reuse-symbols",
    "typed-boolean-local",
    "scalar-arithmetic",
    "vector-arithmetic",
    "boolean-not-literal",
    "boolean-and-literals",
    "boolean-or-literals",
    "nested-boolean-and-not",
    "boolean-equal-literal-comparison",
    "boolean-tiny-literal-comparison",
    "nested-boolean-not-equal-comparison",
    "forwarded-typed-case-arguments",
    "boolean-argument-true-branch",
    "boolean-argument-false-branch",
    "loop-index-local",
    "empty-loop-range",
    "conditional-loop-cursor-return",
    "maximum-call-depth",
    "maximum-codelet-count",
    "giant-branch",
    "signed-local-comparison",
    "boolean-and-local-comparison-leaves-true-branch",
    "boolean-and-local-comparison-leaves-false-branch"
  ]);
  for (const testCase of cases) {
    assert.ok(decodePyacPack(testCase.pack).codelets.length > 0, testCase.name + " lowers to PyAC");
    assert.deepEqual(testCase.referenceValues, testCase.expectedValues, testCase.name + " JavaScript oracle");
  }
});

test("JavaScript programlet reference matches spec-derived GPU expectations", async () => {
  const cases = (await buildVliwGpuConformanceCases()).filter(({ kind }) => kind === "programlet");
  for (const testCase of cases) {
    const { output } = await executePyashProgramPack(testCase.pack);
    assert.deepEqual([referenceValue(output)], testCase.expectedValues, testCase.name);
  }
});

test("Rust CPU reference matches nested bounded-loop and boolean-composition packs", async () => {
  const cases = await buildVliwGpuConformanceCases();
  const selected = cases.filter(({ name }) => [
    "nested-bounded-loops-keep-independent-cursors",
    "nested-bounded-loops-reuse-symbols",
    "boolean-argument-true-branch",
    "boolean-argument-false-branch",
    "boolean-and-local-comparison-leaves-true-branch",
    "boolean-and-local-comparison-leaves-false-branch"
  ].includes(name));
  const rustValues = executeRustCpuReference(selected.map(({ pack }) => pack));

  assert.deepEqual(rustValues, selected.map(({ referenceValues }) => referenceValues));
});

test("Rust GPU conformance queues all cases and checks exact typed results", async () => {
  const cases = await buildVliwGpuConformanceCases();
  const submissions = [];
  const progress = [];
  const releases = new Map();
  const run = runVliwGpuConformance({
    onProgress(event) { progress.push(event.phase); },
    executeCpuPacks(packs) {
      return valuesForPacks(cases, packs);
    },
    executePack(pack) {
      const testCase = cases.find((candidate) => Buffer.from(candidate.pack).equals(Buffer.from(pack)));
      assert.ok(testCase, "only declared conformance packs are submitted");
      submissions.push(testCase.name);
      return new Promise((resolve) => releases.set(testCase.name, () => resolve({
        ok: true,
        backend: "rust-gpu-vulkan",
        device: "fixture Vulkan GPU",
        values: testCase.referenceValues
      })));
    }
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(submissions, cases.map(({ name }) => name), "all GPU cases are submitted before awaiting results");
  assert.deepEqual(progress.slice(0, cases.length), cases.map(() => "cpu-complete"));
  assert.deepEqual(progress.slice(cases.length), cases.map(() => "start"));
  for (const testCase of [...cases].reverse()) releases.get(testCase.name)();
  const completed = await run;

  assert.deepEqual(progress.slice(cases.length * 2), [...cases].reverse().map(() => "complete"));
  assert.deepEqual(completed.map(({ name }) => name), cases.map(({ name }) => name));
});

test("Rust GPU conformance rejects CPU mismatches, non-GPU workers, and wrong values", async () => {
  const cases = await buildVliwGpuConformanceCases();
  const first = cases[0];
  await assert.rejects(
    runVliwGpuConformance({
      executeCpuPacks(packs) {
        return valuesForPacks(cases, packs).map((values, index) => index === 0
          ? [{ type: "unsigned", value: 99 }]
          : values);
      },
      async executePack() {
        assert.fail("GPU submission must not follow a failed CPU comparison");
      }
    }),
    /Rust CPU result differs from JavaScript reference/u
  );

  await assert.rejects(
    runVliwGpuConformance({
      executeCpuPacks(packs) { return valuesForPacks(cases, packs); },
      async executePack() {
        return { ok: true, backend: "cpu-fallback", device: "CPU", values: first.referenceValues };
      }
    }),
    /unexpected GPU backend/u
  );

  await assert.rejects(
    runVliwGpuConformance({
      executeCpuPacks(packs) { return valuesForPacks(cases, packs); },
      async executePack() {
        return { ok: true, backend: "rust-gpu-vulkan", device: "GPU", values: [{ type: "unsigned", value: 99 }] };
      }
    }),
    /typed result differs from JavaScript reference/u
  );
});

test("programlet runtime failures keep shared error codes across JS, Rust CPU, and Vulkan", async () => {
  const cases = await buildVliwGpuProgramletFailureCases();
  assert.deepEqual(cases.map(({ name, expectedRuntimeCode }) => [name, expectedRuntimeCode]), [
    ["programlet-division-by-zero", 2],
    ["programlet-constant-write", 7]
  ]);

  for (const testCase of cases) {
    assert.equal(
      executeRustCpuProgramletFailureReference(testCase.pack),
      testCase.expectedRuntimeCode,
      testCase.name + " Rust CPU error code"
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
      throw new Error("Housekeeper worker: programlet: shared VLIW runtime error " + testCase.expectedRuntimeCode);
    }
  });

  assert.deepEqual(submissions, cases.map(({ name }) => name));
  assert.deepEqual(completed, cases.map(({ name, expectedRuntimeCode }) => ({
    name,
    errorCode: expectedRuntimeCode
  })));
});
