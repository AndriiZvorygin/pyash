import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { parse } from "../program/understand/index.mjs";
import { executeCodelets, lowerPyashProgram, lowerSentence } from "../program/library/vliw/index.mjs";
import { decodePyacPack, encodePyacPack } from "../program/library/vliw/database.mjs";
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

function normalizeReferenceValue(value) {
  if (typeof value?.boolean === "boolean") return { type: "boolean", value: value.boolean };
  if (Number.isInteger(value?.num)) {
    return { type: value.num < 0 ? "signed" : "unsigned", value: value.num };
  }
  const vector = value?.ve;
  if (Array.isArray(vector?.values)) {
    const elementType = vector.values.some((entry) => entry < 0)
      ? "signed-16"
      : vector.values.some((entry) => entry > 0xffff) ? "unsigned-32" : "unsigned-16";
    return {
      type: "vector",
      elementType,
      values: vector.values
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
  const facts = await executeCodelets(decoded.codelets);
  return facts.map((fact) => normalizeReferenceValue(fact?.ob));
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
    "su name count once fromindex num 0 to name num answer be ceremony def",
    "ob num 1 to name num answer be plus do",
    "su name answer ret",
    "su name count once be ceremony prah",
    "su name count twice fromindex num 0 to name num answer be ceremony def",
    "fromindex num 1 toindex num 4 to name num count once be count once do",
    "ob name count once to name num answer be plus do",
    "su name answer ret",
    "su name count twice be ceremony prah"
  ].join("\n");
  const conditionalCall = [
    "su name count once to name num answer be ceremony def",
    "ob num 1 to name num answer be plus do",
    "ob num 2 to name num answer be plus do",
    "su name answer ret",
    "su name count once be ceremony prah",
    "su name count twice to name num answer be ceremony def",
    "ob num 1 be equally from num 1 then to name num answer be count once do else ob num 0 to name num answer be plus do",
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
      "nested-bounded-loops-through-calls",
      nestedLoops,
      "fromindex num 1 toindex num 4 to name num answer be count twice do",
      [{ type: "unsigned", value: 9 }]
    ),
    programlet(
      "conditional-call-composes-multi-action-arm",
      conditionalCall,
      "to name num answer be count twice do",
      [{ type: "unsigned", value: 3 }]
    ),
    programlet(
      "typed-boolean-local",
      booleanLocal,
      "ob bool truth to name bool answer be count once do",
      [{ type: "boolean", value: false }]
    ),
    codeletPack(
      "scalar-and-vector-operators",
      [
        "ob num 65535 to num 1 be plus do",
        "ob num 9 from num 4 be subtract do",
        "ob num 65535 with num 65535 be multiply do",
        "ob num 8 with num 2 be divide do",
        "ob num 7 to num 3 be xor do",
        "ob num 2 from num 10 be exponential do",
        "ob num 9 from num 4 be remains do",
        "ob num 5 be invert do",
        "ob ve num 1 2 3 4 to num 2 be plus do",
        "ob ve num 300 400 with ve num 300 400 be multiply do"
      ],
      [
        { type: "unsigned", value: 0xffff },
        { type: "unsigned", value: 5 },
        { type: "unsigned", value: 4_294_836_225 },
        { type: "unsigned", value: 4 },
        { type: "unsigned", value: 4 },
        { type: "unsigned", value: 1024 },
        { type: "unsigned", value: 1 },
        { type: "signed", value: -5 },
        { type: "vector", elementType: "unsigned-16", values: [3, 4, 5, 6] },
        { type: "vector", elementType: "unsigned-32", values: [90_000, 160_000] }
      ]
    )
  ];

  for (const testCase of cases) {
    testCase.referenceValues = await evaluateReference(testCase);
    assert.deepEqual(
      testCase.referenceValues,
      testCase.expectedValues,
      `${testCase.name}: JavaScript reference differs from the declared conformance result`
    );
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

  const completed = [];
  for (const testCase of cases) {
    onProgress({ phase: "start", name: testCase.name });
    const result = await executePack(testCase.pack);
    assert.equal(result?.ok, true, `${testCase.name}: Housekeeper worker did not report success`);
    assert.equal(result.backend, "rust-gpu-vulkan", `${testCase.name}: unexpected GPU backend`);
    assert.ok(String(result.device ?? "").trim(), `${testCase.name}: missing GPU device identity`);
    assert.deepEqual(result.values, testCase.referenceValues, `${testCase.name}: typed result differs from JavaScript reference`);
    const entry = { name: testCase.name, device: result.device, values: result.values };
    completed.push(entry);
    onProgress({ phase: "complete", ...entry });
  }
  return completed;
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
