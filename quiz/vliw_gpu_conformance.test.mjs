import test from "node:test";
import assert from "node:assert/strict";

import { decodePyacPack, encodePyacPack } from "../program/library/vliw/database.mjs";
import { parse } from "../program/understand/index.mjs";
import { lowerSentence } from "../program/library/vliw/index.mjs";
import { decodePyashProgramSections, executePyashProgramPack } from "../program/library/vliw/programlet.mjs";
import {
  buildVliwGpuConformanceCases,
  buildVliwGpuConformanceBatches,
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

function valuesForPacks(batches, packs) {
  return packs.map((pack) => {
    const batch = batches.find((candidate) => Buffer.from(candidate.pack).equals(Buffer.from(pack)));
    assert.ok(batch, "only declared conformance batches are checked by the CPU fixture");
    return batch.kind === "codelets" ? batch.expectedValues : batch.expectedSections;
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
    "float32-vector-literal",
    "float64-vector-literal",
    "float32-dot-product",
    "pluk-tlas-collects-dot-products-into-prediction-vector",
    "iwsp-linear-scorer-named-vectors",
    "iwsp-linear-scorer-perturbed-candidate",
    "float64-dot-product",
    "uint16-vector-sixteen-lanes",
    "boolean-vector-sixteen-lanes",
    "float32-vector-sixteen-lanes",
    "float64-vector-sixteen-lanes",
    "float32-vector-explicit-six-count",
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

test("VLIW conformance packs independent codelets together and programlets as named sections", async () => {
  const cases = await buildVliwGpuConformanceCases();
  const batches = buildVliwGpuConformanceBatches(cases);
  const codeletCases = cases.filter(({ kind }) => kind === "codelets");
  const programletCases = cases.filter(({ kind }) => kind === "programlet");

  assert.equal(batches.length, 2);
  assert.equal(batches[0].kind, "codelets");
  assert.equal(batches[0].cases.length, codeletCases.length);
  assert.deepEqual(batches[0].expectedValues, codeletCases.flatMap(({ referenceValues }) => referenceValues));
  assert.equal(batches[1].kind, "programlets");
  assert.equal(batches[1].cases.length, programletCases.length);
  assert.equal(decodePyashProgramSections(batches[1].pack).length, programletCases.length);
});

test("JavaScript programlet reference matches spec-derived GPU expectations", async () => {
  const cases = (await buildVliwGpuConformanceCases()).filter(({ kind }) => kind === "programlet");
  for (const testCase of cases) {
    const { output } = await executePyashProgramPack(testCase.pack);
    assert.deepEqual([referenceValue(output)], testCase.expectedValues, testCase.name);
  }
});

test("Rust CPU reference matches dot-product collection, exact evaluation, and nested control-flow packs", async () => {
  const cases = await buildVliwGpuConformanceCases();
  const selected = cases.filter(({ name }) => [
    "pluk-tlas-collects-dot-products-into-prediction-vector",
    "iwsp-linear-scorer-named-vectors",
    "iwsp-linear-scorer-perturbed-candidate",
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

test("Rust CPU executes indexed typed vectors through the sixteen-lane boundary", () => {
  const cases = [
    {
      source: `ob ve num ${Array.from({ length: 16 }, (_, index) => index).join(" ")} be vector ya`,
      expected: { type: "vector", elementType: "unsigned-16", values: Array.from({ length: 16 }, (_, index) => index) }
    },
    {
      source: `ob ve bool ${Array.from({ length: 16 }, (_, index) => index % 2 ? "lie" : "truth").join(" ")} be vector ya`,
      expected: { type: "vector", elementType: "boolean", values: Array.from({ length: 16 }, (_, index) => index % 2 === 0) }
    },
    {
      source: `ob ve float32 ${Array.from({ length: 16 }, (_, index) => index + 0.25).join(" ")} be vector ya`,
      expected: { type: "vector", elementType: "float32", values: Array.from({ length: 16 }, (_, index) => index + 0.25) }
    },
    {
      source: `ob ve float64 ${Array.from({ length: 16 }, (_, index) => index + 0.125).join(" ")} be vector ya`,
      expected: { type: "vector", elementType: "float64", values: Array.from({ length: 16 }, (_, index) => index + 0.125) }
    },
    {
      source: "ob ve float32 1 2 3 4 5 6 be vector ya",
      expected: { type: "vector", elementType: "float32", values: [1, 2, 3, 4, 5, 6] }
    }
  ];
  const packs = cases.map(({ source }) => encodePyacPack(
    lowerSentence(parse(source)).map(({ words }) => words)
  ));
  const results = executeRustCpuReference(packs).map(([value]) => value);
  assert.deepEqual(results, cases.map(({ expected }) => expected));
});

test("Rust CPU executes the Pyash kl6m psas dot-product sentence for both float widths", () => {
  const cases = [
    {
      source: "ob ve float32 1 2 3 by ve float32 4 5 6 be kl6m psas do",
      expected: [{ type: "float32", value: 32 }]
    },
    {
      source: "ob ve float64 0.1 2 -3 by ve float64 0.2 4 -5 be kl6m psas do",
      expected: [{ type: "float64", value: 23.02 }]
    }
  ];
  const packs = cases.map(({ source }) => encodePyacPack(
    lowerSentence(parse(source)).map(({ words }) => words)
  ));
  assert.deepEqual(executeRustCpuReference(packs), cases.map(({ expected }) => expected));
});

test("Rust GPU conformance submits two batches and maps parallel section results by index", async () => {
  const cases = await buildVliwGpuConformanceCases();
  const batches = buildVliwGpuConformanceBatches(cases);
  const submissions = [];
  const progress = [];
  const releases = new Map();
  const run = runVliwGpuConformance({
    onProgress(event) { progress.push(event.phase); },
    executeCpuPacks(packs) {
      return valuesForPacks(batches, packs);
    },
    executePack(pack) {
      const batch = batches.find((candidate) => Buffer.from(candidate.pack).equals(Buffer.from(pack)));
      assert.ok(batch, "only declared conformance batches are submitted");
      submissions.push(batch.name);
      return new Promise((resolve) => releases.set(batch.name, () => {
        const sections = batch.kind === "programlets"
          ? batch.expectedSections.map((value, sectionIndex) => ({ sectionIndex, value }))
            .reverse()
            .map((section, completionOrder) => ({ ...section, completionOrder }))
          : undefined;
        resolve({
          ok: true,
          backend: "rust-gpu-vulkan",
          device: "fixture Vulkan GPU",
          values: batch.kind === "codelets" ? batch.expectedValues : sections.map(({ value }) => value),
          ...(sections ? { sections } : {})
        });
      }));
    }
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(submissions, [batches[0].name], "the codelet batch is submitted once");
  assert.deepEqual(progress.slice(0, cases.length), cases.map(() => "cpu-complete"));
  assert.equal(progress[cases.length], "start");
  releases.get(batches[0].name)();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(submissions, batches.map(({ name }) => name));
  releases.get(batches[1].name)();
  const completed = await run;

  assert.equal(progress.filter((phase) => phase === "complete").length, cases.length);
  const sectionCompletions = progress.slice(progress.indexOf("start", cases.length + 1) + 1);
  assert.deepEqual(sectionCompletions, batches[1].cases.slice().reverse().map(() => "complete"));
  assert.deepEqual(completed.map(({ name }) => name), cases.map(({ name }) => name));
});

test("Rust GPU conformance rejects CPU mismatches, non-GPU workers, and wrong values", async () => {
  const cases = await buildVliwGpuConformanceCases();
  const batches = buildVliwGpuConformanceBatches(cases);
  const codeletBatch = batches[0];
  await assert.rejects(
    runVliwGpuConformance({
      executeCpuPacks(packs) {
        return valuesForPacks(batches, packs).map((values, index) => index === 0
          ? [{ type: "unsigned", value: 99 }, ...values.slice(1)]
          : values);
      },
      async executePack() {
        assert.fail("GPU submission must not follow a failed CPU comparison");
      }
    }),
    /Rust CPU batch differs from JavaScript references/u
  );

  await assert.rejects(
    runVliwGpuConformance({
      executeCpuPacks(packs) { return valuesForPacks(batches, packs); },
      async executePack() {
        return { ok: true, backend: "cpu-fallback", device: "CPU", values: codeletBatch.expectedValues };
      }
    }),
    /unexpected GPU backend/u
  );

  await assert.rejects(
    runVliwGpuConformance({
      executeCpuPacks(packs) { return valuesForPacks(batches, packs); },
      async executePack() {
        return { ok: true, backend: "rust-gpu-vulkan", device: "GPU", values: [{ type: "unsigned", value: 99 }] };
      }
    }),
    /typed results differ from JavaScript references/u
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
