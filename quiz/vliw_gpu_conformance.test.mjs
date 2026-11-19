import test from "node:test";
import assert from "node:assert/strict";

import { decodePyacPack } from "../program/library/vliw/database.mjs";
import {
  buildVliwGpuConformanceCases,
  runVliwGpuConformance
} from "../command/vliw_gpu_conformance.mjs";
import { executePyashProgramPack } from "../program/library/vliw/programlet.mjs";

function referenceValue(output) {
  if (typeof output?.boolean === "boolean") return { type: "boolean", value: output.boolean };
  if (typeof output?.num === "number") {
    return {
      type: output.num < 0 ? "signed" : "unsigned",
      value: output.num
    };
  }
  assert.fail(`unsupported programlet reference result: ${JSON.stringify(output)}`);
}

test("Rust GPU conformance matrix compiles the supported typed and control-flow cases", () => {
  const cases = buildVliwGpuConformanceCases();

  assert.deepEqual(cases.map(({ name }) => name), [
    "nested-calls-and-isolated-locals",
    "numeric-branch",
    "bounded-loop",
    "nested-bounded-loops-keep-independent-cursors",
    "nested-bounded-loops-reuse-symbols",
    "typed-boolean-local",
    "scalar-arithmetic",
    "float32-literal",
    "float32-plus",
    "float32-subtract",
    "float32-multiply",
    "float32-divide",
    "fixed16-literal",
    "fixed16-plus",
    "fixed16-subtract",
    "fixed16-multiply-rounds-even",
    "fixed16-divide",
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
    assert.ok(decodePyacPack(testCase.pack).codelets.length > 0, `${testCase.name} lowers to PyAC`);
  }
});

test("JavaScript implementation matches the spec-derived programlet expectations", async () => {
  const cases = buildVliwGpuConformanceCases().filter(({ kind }) => kind === "programlet");
  for (const testCase of cases) {
    const { output } = await executePyashProgramPack(testCase.pack);
    assert.deepEqual(
      [referenceValue(output)],
      testCase.expectedValues,
      `${testCase.name}: Pyash reference result differs from the specified programlet result`
    );
  }
});

test("Rust GPU conformance submits the whole matrix before awaiting exact typed outputs", async () => {
  const cases = buildVliwGpuConformanceCases();
  const submissions = [];
  const progress = [];
  const releases = new Map();
  const run = runVliwGpuConformance({
    onProgress(event) { progress.push(event.phase); },
    executePack(pack) {
      const testCase = cases.find((candidate) => Buffer.from(candidate.pack).equals(Buffer.from(pack)));
      assert.ok(testCase, "only declared conformance packs are submitted");
      submissions.push(testCase.name);
      return new Promise((resolve) => releases.set(testCase.name, () => resolve({
          ok: true,
          backend: "rust-gpu-vulkan",
          device: "fixture Vulkan GPU",
          values: testCase.expectedValues
        })));
    }
  });

  assert.deepEqual(submissions, cases.map(({ name }) => name), "every case is submitted without waiting for an earlier result");
  assert.deepEqual(progress, cases.map(() => "start"), "all cases start before any result completes");
  for (const testCase of [...cases].reverse()) releases.get(testCase.name)();
  const completed = await run;

  assert.deepEqual(submissions, cases.map(({ name }) => name));
  assert.deepEqual(progress, [
    ...cases.map(() => "start"),
    ...[...cases].reverse().map(() => "complete")
  ]);
  assert.equal(completed.length, cases.length);
  assert.equal(completed.at(-1).name, "boolean-and-local-comparison-leaves-false-branch");
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
