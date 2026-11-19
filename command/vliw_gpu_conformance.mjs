import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { parse } from "../program/understand/index.mjs";
import { decodeCodelet, decodePyashProgram, executeCodelets, lowerPyashProgram, lowerSentence } from "../program/library/vliw/index.mjs";
import { decodePyacPack, encodePyacPack } from "../program/library/vliw/database.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, remember } from "../program/remember/index.mjs";
import {
  compilePyashProgramSource,
  decodePyashProgramPack,
  executePyashProgramPack
} from "../program/library/vliw/programlet.mjs";
import { createHousekeeperVliwPackExecutor } from "../program/library/vliw/rust_gpu_pack.mjs";

function programlet(name, source, invocation, expectedValues) {
  const compiled = compilePyashProgramSource(source, { invocation });
  return { name, kind: "programlet", pack: compiled.pack, expectedValues };
}

function codeletPack(name, sources, expectedValues) {
  const sentences = Array.isArray(sources) ? sources : [sources];
  const codelets = sentences.flatMap((source) => lowerSentence(parse(source))).map((codelet) => codelet.words);
  return { name, kind: "codelets", pack: encodePyacPack(codelets), expectedValues };
}

function vectorPack(name, source, expectedValues) {
  const vectors = lowerPyashProgram([parse(source)]).vectors;
  return { name, kind: "codelets", pack: encodePyacPack(vectors), expectedValues };
}

function normalizeReferenceValue(value, numericType = null) {
  const result = value?.ob ?? value;
  if (typeof result?.boolean === "boolean") return { type: "boolean", value: result.boolean };
  if (typeof result?.num === "number" && Number.isFinite(result.num)) {
    if (numericType === "float32") return { type: "float32", value: Math.fround(result.num) };
    if (numericType === "float64") return { type: "float64", value: result.num };
    if (value?.as?.name === "rational" || numericType === "fixed16") {
      const numerator = Math.round(result.num * 46_656);
      return { type: "fixed16", value: numerator / 46_656, numerator, denominator: 46_656 };
    }
  }
  if (Number.isInteger(result?.num)) {
    return { type: result.num < 0 ? "signed" : "unsigned", value: result.num };
  }
  if (typeof result?.num === "number" && Number.isFinite(result.num)) {
    return { type: "float32", value: Math.fround(result.num) };
  }
  const vector = result?.ve;
  if (Array.isArray(vector?.values)) {
    const elementType = vector.type === "float32" || vector.type === "float64"
      ? vector.type
      : vector.type === "text" ? "text"
        : vector.type === "bool" ? "boolean"
          : vector.values.some((entry) => entry < 0)
            ? "signed-16"
            : vector.values.some((entry) => entry > 0xffff) ? "unsigned-32" : "unsigned-16";
    const values = vector.type === "bool"
      ? vector.values.map((entry) => entry === "truth" || entry === true)
      : vector.values;
    return {
      type: "vector",
      elementType,
      values
    };
  }
  throw new TypeError(`VLIW conformance reference returned an unsupported value: ${JSON.stringify(value)}`);
}

async function evaluateReference(testCase) {
  if (testCase.kind === "programlet") {
    const { output } = await executePyashProgramPack(testCase.pack);
    return [normalizeReferenceValue(output)];
  }
  const decoded = decodePyacPack(testCase.pack);
  try {
    const facts = await executeCodelets(decoded.codelets);
    return facts.map((fact, index) => {
      const instruction = decodeCodelet(decoded.codelets[index]);
      const quoteFamily = instruction.items.find((item) => item.kind === "quote")?.quote.family;
      const numericType = instruction.sentence?.as?.name === "rational"
        ? "fixed16"
        : quoteFamily === "float32" ? "float32"
          : quoteFamily === "float64" ? "float64" : null;
      return normalizeReferenceValue(fact, numericType);
    });
  } catch (error) {
    if (!new Set(["unsupported-codelet", "malformed-quote"]).has(error?.code)) throw error;
  }

  const sentences = decodePyashProgram(decoded.codelets);
  forget();
  try {
    const values = [];
    for (const sentence of sentences) {
        if (sentence.be === "vector") {
          values.push(normalizeReferenceValue(sentence.ob));
          continue;
        }
      const outcome = await interpret(sentence);
      const result = remember("result");
      if (result?.ob !== undefined) {
        values.push(normalizeReferenceValue(result));
      } else if (typeof outcome?.value === "boolean") {
        values.push(normalizeReferenceValue({ boolean: outcome.value }));
      } else {
        throw new Error(`VLIW conformance sentence produced no result: ${JSON.stringify(sentence)}`);
      }
    }
    return values;
  } finally {
    forget();
  }
}

export async function buildVliwGpuConformanceCases() {
  const nestedCalls = [
    "su name count once to name num answer be ceremony def",
    "exists su name count ob num 0 as name variable be number ya",
    "ob num 1 to name num count be plus do",
    "su name count ret",
    "su name count once be ceremony prah",
    "su name count twice to name num answer be ceremony def",
    "to name num first be count once do",
    "to name num second be count once do",
    "su name second ret",
    "su name count twice be ceremony prah"
  ].join("\n");
  const branch = [
    "su name choose once to name num answer be ceremony def",
    "ob num 3 be tiny from num 5 then ob num 2 to name num answer be plus do",
    "su name answer ret",
    "su name choose once be ceremony prah"
  ].join("\n");
  const loop = [
    "su name count fromindex num 0 to name num answer be ceremony def",
    "ob num 1 to name num answer be plus do",
    "su name answer ret",
    "su name count be ceremony prah"
  ].join("\n");
  const nestedLoops = [
    "su name count once fromindex num 0 toindex num 0 to name num answer be ceremony def",
    "ob num 1 to name num answer be plus do",
    "su name answer ret",
    "su name count once be ceremony prah",
    "su name count twice fromindex num 0 toindex num 0 to name num answer be ceremony def",
    "exists su name second ob num 0 as name variable be number ya",
    "to name num second fromindex num 0 toindex num 3 be count once do",
    "ob name second to name num answer be plus do",
    "su name answer ret",
    "su name count twice be ceremony prah"
  ].join("\n");
  const booleanLocal = [
    "su name count once ob bool lie to name bool answer be ceremony def",
    "exists su name count ob bool truth as name variable be boolean ya",
    "ob bool lie to name bool count be boolean do",
    "this ob name count ret",
    "su name count once be ceremony prah"
  ].join("\n");
  const forwardedArguments = [
    "su name plus two ob num 0 to name num answer be ceremony def",
    "exists su name first ob num of ob of this as name variable be number ya",
    "ob num 2 to name num first be plus do",
    "this ob name first ret",
    "su name plus two be ceremony prah",
    "su name count twice ob num 0 to name num answer be ceremony def",
    "exists su name count ob num of ob of this as name variable be number ya",
    "ob num of count to name num count be plus two do",
    "this ob name count ret",
    "su name count twice be ceremony prah"
  ].join("\n");
  const booleanArgumentBranches = [
    "su name choose once ob bool lie from bool truth to name num answer be ceremony def",
    "exists su name count ob bool of ob of this as name variable be boolean ya",
    "exists su name first ob bool truth as name permanently boolean be boolean ya",
    "ob name bool count be equally from name bool first then ob num 1 to name num answer be plus do else ob num 2 to name num answer be plus do",
    "su name answer ret",
    "su name choose once be ceremony prah"
  ].join("\n");
  const loopIndexLocal = [
    "su name count once fromindex num 0 to name num answer be ceremony def",
    "exists su name count ob num of fromindex of this as name variable be number ya",
    "ob num 2 be equally from name num count then ob num 1 to name num answer be plus do",
    "su name answer ret",
    "su name count once be ceremony prah"
  ].join("\n");
  const earlyLoopExit = [
    "su name count once to name num answer fromindex num 0 toindex num 0 be ceremony def",
    "exists su name answer ob num of fromindex of this as name variable be number ya",
    "ob name answer be equally from num 2 then this fromindex num of toindex of this ret",
    "su name answer ret",
    "su name count once be ceremony prah"
  ].join("\n");
  const callDepthWords = ["one", "two", "three", "four", "five", "six", "seven", "eight"];
  const maximumCallDepth = callDepthWords.flatMap((word, index) => {
    const next = callDepthWords[index + 1];
    return [
      `su name count ${word} to name num answer be ceremony def`,
      next ? `to name num answer be count ${next} do` : "ob num 1 to name num answer be plus do",
      "su name answer ret",
      `su name count ${word} be ceremony prah`
    ];
  }).join("\n");
  const maximumCodeletCount = [
    "su name count once to name num answer be ceremony def",
    ...Array.from({ length: 60 }, () => "ob num 1 to name num answer be plus do"),
    "su name answer ret",
    "su name count once be ceremony prah"
  ].join("\n");
  const giantBranch = [
    "su name choose once to name num answer be ceremony def",
    "ob num 5 be giant from num 3 then ob num 1 to name num answer be plus do else ob num 2 to name num answer be plus do",
    "su name answer ret",
    "su name choose once be ceremony prah"
  ].join("\n");
  const signedLocalComparison = [
    "su name choose once to name num answer be ceremony def",
    "exists su name count ob num 5 as name variable be number ya",
    "ob name count to name num count be invert do",
    "ob name count be tiny from num 0 then ob num 1 to name num answer be plus do else ob num 2 to name num answer be plus do",
    "su name answer ret",
    "su name choose once be ceremony prah"
  ].join("\n");
  const booleanLocalComparisonBranches = [
    "su name choose once ob num 0 to name num answer be ceremony def",
    "exists su name count ob num of ob of this as name variable be number ya",
    "be and ob la ob name count be equally from num 5 do ko with la ob name count be giant from num 3 do ko then ob num 1 to name num answer be plus do else ob num 2 to name num answer be plus do",
    "su name answer ret",
    "su name choose once be ceremony prah"
  ].join("\n");

  const cases = [
    programlet(
      "nested-calls-and-isolated-locals",
      nestedCalls,
      "to name num answer be count twice do",
      [{ type: "unsigned", value: 1 }]
    ),
    programlet(
      "numeric-branch",
      branch,
      "to name num answer be choose once do",
      [{ type: "unsigned", value: 2 }]
    ),
    programlet(
      "bounded-loop",
      loop,
      "fromindex num 1 toindex num 4 to name num answer be count do",
      [{ type: "unsigned", value: 3 }]
    ),
    programlet(
      "nested-bounded-loops-keep-independent-cursors",
      nestedLoops,
      "to name num answer fromindex num 1 toindex num 4 be count twice do",
      [{ type: "unsigned", value: 9 }]
    ),
    programlet(
      "nested-bounded-loops-reuse-symbols",
      nestedLoops,
      "to name num answer fromindex num 1 toindex num 300 be count twice do",
      [{ type: "unsigned", value: 897 }]
    ),
    programlet(
      "typed-boolean-local",
      booleanLocal,
      "ob bool truth to name bool answer be count once do",
      [{ type: "boolean", value: false }]
    ),
    codeletPack(
      "scalar-arithmetic",
      "ob num 65535 with num 65535 be multiply do",
      [{ type: "unsigned", value: 4_294_836_225 }]
    ),
    codeletPack(
      "float32-literal",
      "ob num 0.125 be number ya",
      [{ type: "float32", value: 0.125 }]
    ),
    codeletPack(
      "float32-plus",
      "ob num 0.1 to num 0.2 be plus do",
      [{ type: "float32", value: Math.fround(Math.fround(0.1) + Math.fround(0.2)) }]
    ),
    codeletPack(
      "float32-subtract",
      "ob num 5.5 from num 2 be subtract do",
      [{ type: "float32", value: Math.fround(Math.fround(5.5) - Math.fround(2)) }]
    ),
    codeletPack(
      "float32-multiply",
      "ob num 1.5 with num 2 be multiply do",
      [{ type: "float32", value: Math.fround(Math.fround(1.5) * Math.fround(2)) }]
    ),
    codeletPack(
      "float32-divide",
      "ob num 1.5 with num 4 be divide do",
      [{ type: "float32", value: Math.fround(Math.fround(1.5) / Math.fround(4)) }]
    ),
    codeletPack(
      "fixed16-literal",
      "ob num 0.125 as name rational be number ya",
      [{ type: "fixed16", value: 0.125, numerator: 5_832, denominator: 46_656 }]
    ),
    codeletPack(
      "fixed16-plus",
      "ob num 0.5 as name rational to num 0.25 be plus do",
      [{ type: "fixed16", value: 0.75, numerator: 34_992, denominator: 46_656 }]
    ),
    codeletPack(
      "fixed16-subtract",
      "ob num 0.5 as name rational from num 0.25 be subtract do",
      [{ type: "fixed16", value: 0.25, numerator: 11_664, denominator: 46_656 }]
    ),
    codeletPack(
      "fixed16-multiply-rounds-even",
      `ob num ${3 / 46_656} as name rational with num 0.5 be multiply do`,
      [{ type: "fixed16", value: 2 / 46_656, numerator: 2, denominator: 46_656 }]
    ),
    codeletPack(
      "fixed16-divide",
      "ob num 0.25 as name rational with num 0.5 be divide do",
      [{ type: "fixed16", value: 0.5, numerator: 23_328, denominator: 46_656 }]
    ),
    codeletPack(
      "vector-arithmetic",
      "ob ve num 1 2 3 4 to num 2 be plus do",
      [{ type: "vector", elementType: "unsigned-16", values: [3, 4, 5, 6] }]
    ),
    codeletPack(
      "float32-vector-literal",
      "ob ve float32 1.25 -0.5 be vector ya",
      [{ type: "vector", elementType: "float32", values: [1.25, -0.5] }]
    ),
    codeletPack(
      "float64-vector-literal",
      "ob ve float64 3.141592653589793 -0.5 -0 be vector ya",
      [{ type: "vector", elementType: "float64", values: [Math.PI, -0.5, -0] }]
    ),
    vectorPack(
      "uint16-vector-sixteen-lanes",
      `ob ve num ${Array.from({ length: 16 }, (_, index) => index).join(" ")} be vector ya`,
      [{ type: "vector", elementType: "unsigned-16", values: Array.from({ length: 16 }, (_, index) => index) }]
    ),
    vectorPack(
      "boolean-vector-sixteen-lanes",
      `ob ve bool ${Array.from({ length: 16 }, (_, index) => index % 2 ? "lie" : "truth").join(" ")} be vector ya`,
      [{ type: "vector", elementType: "boolean", values: Array.from({ length: 16 }, (_, index) => index % 2 === 0) }]
    ),
    vectorPack(
      "float32-vector-sixteen-lanes",
      `ob ve float32 ${Array.from({ length: 16 }, (_, index) => index + 0.25).join(" ")} be vector ya`,
      [{ type: "vector", elementType: "float32", values: Array.from({ length: 16 }, (_, index) => index + 0.25) }]
    ),
    vectorPack(
      "float64-vector-sixteen-lanes",
      `ob ve float64 ${Array.from({ length: 16 }, (_, index) => index + 0.125).join(" ")} be vector ya`,
      [{ type: "vector", elementType: "float64", values: Array.from({ length: 16 }, (_, index) => index + 0.125) }]
    ),
    vectorPack(
      "float32-vector-explicit-six-count",
      "ob ve float32 1 2 3 4 5 6 be vector ya",
      [{ type: "vector", elementType: "float32", values: [1, 2, 3, 4, 5, 6] }]
    ),
    codeletPack(
      "boolean-not-literal",
      "be not ob la ob bool truth be boolean ya ko do",
      [{ type: "boolean", value: false }]
    ),
    codeletPack(
      "boolean-and-literals",
      "be and ob la ob bool truth be boolean ya ko with la ob bool lie be boolean ya ko do",
      [{ type: "boolean", value: false }]
    ),
    codeletPack(
      "boolean-or-literals",
      "be or ob la ob bool lie be boolean ya ko with la ob bool truth be boolean ya ko do",
      [{ type: "boolean", value: true }]
    ),
    codeletPack(
      "nested-boolean-and-not",
      "be and ob la ob bool truth be boolean ya ko with la be not ob la ob bool truth be boolean ya ko do ko do",
      [{ type: "boolean", value: false }]
    ),
    codeletPack(
      "boolean-equal-literal-comparison",
      "su num 5 from num 5 be equally do",
      [{ type: "boolean", value: true }]
    ),
    codeletPack(
      "boolean-tiny-literal-comparison",
      "su num 4 from num 5 be tiny do",
      [{ type: "boolean", value: true }]
    ),
    codeletPack(
      "nested-boolean-not-equal-comparison",
      "be not ob la su num 5 from num 4 be equally do ko do",
      [{ type: "boolean", value: true }]
    ),
    programlet(
      "forwarded-typed-case-arguments",
      forwardedArguments,
      "ob num 5 to name num answer be count twice do",
      [{ type: "unsigned", value: 7 }]
    ),
    programlet(
      "boolean-argument-true-branch",
      booleanArgumentBranches,
      "ob bool truth from bool truth to name num answer be choose once do",
      [{ type: "unsigned", value: 1 }]
    ),
    programlet(
      "boolean-argument-false-branch",
      booleanArgumentBranches,
      "ob bool lie from bool truth to name num answer be choose once do",
      [{ type: "unsigned", value: 2 }]
    ),
    programlet(
      "loop-index-local",
      loopIndexLocal,
      "fromindex num 1 toindex num 4 to name num answer be count once do",
      [{ type: "unsigned", value: 1 }]
    ),
    programlet(
      "empty-loop-range",
      loopIndexLocal,
      "fromindex num 2 toindex num 2 to name num answer be count once do",
      [{ type: "unsigned", value: 0 }]
    ),
    programlet(
      "conditional-loop-cursor-return",
      earlyLoopExit,
      "to name num answer fromindex num 1 toindex num 5 be count once do",
      [{ type: "unsigned", value: 2 }]
    ),
    programlet(
      "maximum-call-depth",
      maximumCallDepth,
      "to name num answer be count one do",
      [{ type: "unsigned", value: 1 }]
    ),
    programlet(
      "maximum-codelet-count",
      maximumCodeletCount,
      "to name num answer be count once do",
      [{ type: "unsigned", value: 60 }]
    ),
    programlet(
      "giant-branch",
      giantBranch,
      "to name num answer be choose once do",
      [{ type: "unsigned", value: 1 }]
    ),
    programlet(
      "signed-local-comparison",
      signedLocalComparison,
      "to name num answer be choose once do",
      [{ type: "unsigned", value: 1 }]
    ),
    programlet(
      "boolean-and-local-comparison-leaves-true-branch",
      booleanLocalComparisonBranches,
      "ob num 5 to name num answer be choose once do",
      [{ type: "unsigned", value: 1 }]
    ),
    programlet(
      "boolean-and-local-comparison-leaves-false-branch",
      booleanLocalComparisonBranches,
      "ob num 2 to name num answer be choose once do",
      [{ type: "unsigned", value: 2 }]
    )
  ];
  const maximumPack = cases.find(({ name }) => name === "maximum-codelet-count").pack;
  assert.equal(decodePyacPack(maximumPack).codelets.length, 64);
  for (const testCase of cases) {
    try {
      testCase.referenceValues = await evaluateReference(testCase);
    } catch (error) {
      error.message = `${testCase.name}: ${error.message}`;
      throw error;
    }
    assert.deepEqual(testCase.referenceValues, testCase.expectedValues, testCase.name + ': JavaScript reference differs from the declared conformance result');
  }
  return cases;
}


export async function buildVliwGpuProgramletFailureCases() {
  const divideByZeroSource = [
    "su name count once to name num answer be ceremony def",
    "exists su name count ob num 1 as name variable be number ya",
    "from name count by num 0 to name num count be divide do",
    "su name count ret",
    "su name count once be ceremony prah"
  ].join("\n");
  const divideByZero = compilePyashProgramSource(divideByZeroSource, {
    invocation: "to name num answer be count once do"
  });
  const mutableConstantSource = [
    "su name count once to name num answer be ceremony def",
    "exists su name count ob num 5 as name variable be number ya",
    "ob num 1 to name num count be plus do",
    "su name count ret",
    "su name count once be ceremony prah"
  ].join("\n");
  const mutable = compilePyashProgramSource(mutableConstantSource, {
    invocation: "to name num answer be count once do"
  });
  const constantSentences = decodePyashProgramPack(mutable.pack);
  const declaration = constantSentences.find((sentence) => sentence.be === "number" && sentence.as);
  assert.ok(declaration, "constant-write fixture has a typed local declaration");
  declaration.as = { name: "permanently number" };
  const constantWritePack = encodePyacPack(lowerPyashProgram(constantSentences).vectors);

  const cases = [
    {
      name: "programlet-division-by-zero",
      pack: divideByZero.pack,
      expectedRuntimeCode: 2,
      referenceError: /divide: by cannot be zero/u
    },
    {
      name: "programlet-constant-write",
      pack: constantWritePack,
      expectedRuntimeCode: 7,
      referenceError: /constant quantity is read-only: count/u
    }
  ];
  for (const testCase of cases) {
    await assert.rejects(
      executePyashProgramPack(testCase.pack),
      testCase.referenceError,
      `${testCase.name}: JavaScript reference must reject the same runtime condition`
    );
  }
  return cases;
}

export function executeRustCpuReference(packs) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const framed = [];
  for (const pack of packs) {
    const bytes = Buffer.from(pack);
    const length = Buffer.alloc(4);
    length.writeUInt32LE(bytes.length);
    framed.push(length, bytes);
  }
  const result = spawnSync("cargo", [
    "run",
    "--quiet",
    "--manifest-path",
    "rust/pyac/Cargo.toml",
    "--example",
    "vliw_reference"
  ], {
    cwd: root,
    input: Buffer.concat(framed),
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024
  });
  if (result.error || result.status !== 0) {
    throw new Error(`Rust CPU VLIW reference failed: ${result.error?.message ?? result.stderr ?? result.status}`);
  }
  return String(result.stdout).trim().split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line).values);
}

export function executeRustCpuProgramletFailureReference(pack) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const bytes = Buffer.from(pack);
  const length = Buffer.alloc(4);
  length.writeUInt32LE(bytes.length);
  const result = spawnSync("cargo", [
    "run",
    "--quiet",
    "--manifest-path",
    "rust/pyac/Cargo.toml",
    "--example",
    "vliw_reference"
  ], {
    cwd: root,
    input: Buffer.concat([length, bytes]),
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024
  });
  if (result.error) throw result.error;
  assert.notEqual(result.status, 0, "Rust CPU unexpectedly accepted a runtime-error fixture");
  const match = String(result.stderr).match(/\[programlet error=(\d+),/u);
  assert.ok(match, `Rust CPU failure lacks a shared runtime error code: ${result.stderr}`);
  return Number(match[1]);
}

export async function runVliwGpuConformance({ executeCpuPacks, executePack, onProgress = () => {} }) {
  if (typeof executeCpuPacks !== "function") {
    throw new TypeError("VLIW conformance requires a Rust CPU pack executor");
  }
  if (typeof executePack !== "function") {
    throw new TypeError("VLIW GPU conformance requires a Housekeeper pack executor");
  }
  const cases = await buildVliwGpuConformanceCases();
  const cpuResults = await executeCpuPacks(cases.map((testCase) => testCase.pack));
  assert.equal(cpuResults?.length, cases.length, "Rust CPU returned a different number of conformance results");
  for (const [index, testCase] of cases.entries()) {
    assert.deepEqual(
      cpuResults[index],
      testCase.referenceValues,
      `${testCase.name}: Rust CPU result differs from JavaScript reference`
    );
    onProgress({ phase: "cpu-complete", name: testCase.name, values: cpuResults[index] });
  }

  const submissions = cases.map(async (testCase) => {
    onProgress({ phase: "start", name: testCase.name });
    try {
      const result = await executePack(testCase.pack);
      assert.equal(result?.ok, true, `${testCase.name}: Housekeeper worker did not report success`);
      assert.equal(result.backend, "rust-gpu-vulkan", `${testCase.name}: unexpected GPU backend`);
      assert.ok(String(result.device ?? "").trim(), `${testCase.name}: missing GPU device identity`);
      assert.deepEqual(result.values, testCase.referenceValues, `${testCase.name}: typed result differs from JavaScript reference`);
      const entry = { name: testCase.name, device: result.device, values: result.values };
      onProgress({ phase: "complete", ...entry });
      return entry;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      onProgress({ phase: "fail", name: testCase.name, error: detail });
      throw new Error(`${testCase.name}: ${detail}`, { cause: error });
    }
  });
  const settled = await Promise.allSettled(submissions);
  const failures = settled.flatMap((result) => result.status === "rejected" ? [result.reason] : []);
  if (failures.length) {
    throw new Error(
      `Rust GPU conformance failed for ${failures.length}/${cases.length} cases:\n${failures.map((error) => `- ${error.message}`).join("\n")}`
    );
  }
  return settled.map((result) => result.value);
}

export async function runVliwGpuProgramletFailureConformance({
  executeCpuError,
  executePack,
  onProgress = () => {}
}) {
  if (typeof executeCpuError !== "function") {
    throw new TypeError("VLIW failure conformance requires a Rust CPU error-code executor");
  }
  if (typeof executePack !== "function") {
    throw new TypeError("VLIW GPU failure conformance requires a Housekeeper pack executor");
  }
  const cases = await buildVliwGpuProgramletFailureCases();
  const completed = [];
  for (const testCase of cases) {
    const cpuCode = await executeCpuError(testCase.pack);
    assert.equal(
      cpuCode,
      testCase.expectedRuntimeCode,
      `${testCase.name}: Rust CPU returned a different shared runtime error`
    );
    onProgress({ phase: "cpu-error", name: testCase.name, errorCode: cpuCode });
    await assert.rejects(
      executePack(testCase.pack),
      new RegExp(`shared VLIW runtime error ${testCase.expectedRuntimeCode}\\b`, "u"),
      `${testCase.name}: Vulkan worker must return the same shared runtime error`
    );
    const entry = { name: testCase.name, errorCode: testCase.expectedRuntimeCode };
    completed.push(entry);
    onProgress({ phase: "gpu-error", ...entry });
  }
  return completed;
}

async function main() {
  const executePack = createHousekeeperVliwPackExecutor({
    worldRoot: path.resolve(process.env.PYA_WORLD_ROOT || "world"),
    agentName: "vliw-gpu-conformance",
    deviceId: process.env.PYA_VLIW_CONFORMANCE_DEVICE_ID || "gpu0",
    timeoutMs: Number(process.env.PYA_VLIW_CONFORMANCE_TIMEOUT_MS) || 5 * 60 * 1000
  });
  const completed = await runVliwGpuConformance({
    executeCpuPacks: executeRustCpuReference,
    executePack,
    onProgress(event) {
      if (event.phase === "start") console.log(`Queueing Rust GPU conformance case: ${event.name}`);
      if (event.phase === "cpu-complete") console.log(`PASS JavaScript/Rust CPU reference ${event.name}: ${JSON.stringify(event.values)}`);
      if (event.phase === "complete") {
        console.log(`PASS ${event.name} on ${event.device}: ${JSON.stringify(event.values)}`);
      }
    }
  });
  console.log(`Rust GPU Housekeeper conformance passed: ${completed.length} cases.`);
  const failures = await runVliwGpuProgramletFailureConformance({
    executeCpuError: executeRustCpuProgramletFailureReference,
    executePack,
    onProgress(event) {
      if (event.phase === "cpu-error") {
        console.log(`PASS JavaScript/Rust CPU shared runtime error ${event.name}: ${event.errorCode}`);
      }
      if (event.phase === "gpu-error") {
        console.log(`PASS ${event.name} on Vulkan worker: shared runtime error ${event.errorCode}`);
      }
    }
  });
  console.log(`Rust GPU Housekeeper error conformance passed: ${failures.length} cases.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error?.stack ?? error);
    process.exitCode = 1;
  });
}
