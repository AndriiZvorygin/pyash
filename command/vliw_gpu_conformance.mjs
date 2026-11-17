import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { parse } from "../program/understand/index.mjs";
import { lowerSentence } from "../program/library/vliw/index.mjs";
import { encodePyacPack } from "../program/library/vliw/database.mjs";
import { compilePyashProgramSource } from "../program/library/vliw/programlet.mjs";
import { createHousekeeperVliwPackExecutor } from "../program/library/vliw/rust_gpu_pack.mjs";

function programlet(name, source, invocation, expectedValues) {
  const compiled = compilePyashProgramSource(source, { invocation });
  return { name, pack: compiled.pack, expectedValues };
}

function codeletPack(name, sentence, expectedValues) {
  const codelets = lowerSentence(parse(sentence)).map((codelet) => codelet.words);
  return { name, pack: encodePyacPack(codelets), expectedValues };
}

export function buildVliwGpuConformanceCases() {
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
  const booleanLocal = [
    "su name count once ob bool lie to name bool answer be ceremony def",
    "exists su name count ob bool truth as name variable be boolean ya",
    "ob bool lie to name bool count be boolean do",
    "this ob name count ret",
    "su name count once be ceremony prah"
  ].join("\n");

  return [
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
      "vector-arithmetic",
      "ob ve num 1 2 3 4 to num 2 be plus do",
      [{ type: "vector", elementType: "unsigned-16", values: [3, 4, 5, 6] }]
    )
  ];
}

export async function runVliwGpuConformance({ executePack, onProgress = () => {} }) {
  if (typeof executePack !== "function") {
    throw new TypeError("VLIW GPU conformance requires a Housekeeper pack executor");
  }
  const completed = [];
  for (const testCase of buildVliwGpuConformanceCases()) {
    onProgress({ phase: "start", name: testCase.name });
    const result = await executePack(testCase.pack);
    assert.equal(result?.ok, true, `${testCase.name}: Housekeeper worker did not report success`);
    assert.equal(result.backend, "rust-gpu-vulkan", `${testCase.name}: unexpected GPU backend`);
    assert.ok(String(result.device ?? "").trim(), `${testCase.name}: missing GPU device identity`);
    assert.deepEqual(result.values, testCase.expectedValues, `${testCase.name}: typed result mismatch`);
    const entry = { name: testCase.name, device: result.device, values: result.values };
    completed.push(entry);
    onProgress({ phase: "complete", ...entry });
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
    executePack,
    onProgress(event) {
      if (event.phase === "start") console.log(`Queueing Rust GPU conformance case: ${event.name}`);
      if (event.phase === "complete") {
        console.log(`PASS ${event.name} on ${event.device}: ${JSON.stringify(event.values)}`);
      }
    }
  });
  console.log(`Rust GPU Housekeeper conformance passed: ${completed.length} cases.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error?.stack ?? error);
    process.exitCode = 1;
  });
}
