import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { parse } from "../program/understand/index.mjs";
import { lowerSentence } from "../program/library/vliw/index.mjs";
import { decodePyacPack, encodePyacPack } from "../program/library/vliw/database.mjs";
import { compilePyashProgramSource } from "../program/library/vliw/programlet.mjs";
import { createHousekeeperVliwPackExecutor } from "../program/library/vliw/rust_gpu_pack.mjs";

function programlet(name, source, invocation, expectedValues) {
  const compiled = compilePyashProgramSource(source, { invocation });
  return { name, kind: "programlet", pack: compiled.pack, expectedValues };
}

function codeletPack(name, sentence, expectedValues) {
  const codelets = lowerSentence(parse(sentence)).map((codelet) => codelet.words);
  return { name, kind: "codelet-pack", pack: encodePyacPack(codelets), expectedValues };
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
      "vector-arithmetic",
      "ob ve num 1 2 3 4 to num 2 be plus do",
      [{ type: "vector", elementType: "unsigned-16", values: [3, 4, 5, 6] }]
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
  return cases;
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
