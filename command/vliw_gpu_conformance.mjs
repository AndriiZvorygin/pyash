import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";

import { parse } from "../program/understand/index.mjs";
import { lowerPyashProgram, lowerSentence } from "../program/library/vliw/index.mjs";
import { decodePyacPack, encodePyacPack } from "../program/library/vliw/database.mjs";
import {
  compilePyashProgramSource,
  decodePyashProgramPack
} from "../program/library/vliw/programlet.mjs";
import { createHousekeeperVliwPackExecutor, createPinnedVliwPackExecutor } from "../program/library/vliw/rust_gpu_pack.mjs";
import { verifyTypedDispatch } from "./vliw_gpu_conformance/typed_dispatch.mjs";
import {
  collectVliwConformanceEnvironment,
  writeVliwConformancePya
} from "./vliw_conformance_report.mjs";
import { buildPlukTlasConformanceCase } from "./vliw_gpu_conformance/pluk_tlas.mjs";
import { buildIwspLinearScorerConformanceCases } from "./vliw_gpu_conformance/iwsp_linear_scorer.mjs";
import { buildIwspVectorOpsConformanceCases } from "./vliw_gpu_conformance/iwsp_vector_ops.mjs";
import { buildIwspParameterizedAttentionCases } from "./vliw_gpu_conformance/iwsp_parameterized_attention.mjs";
import { buildIwspMatrixVectorStorageCase } from "./vliw_gpu_conformance/iwsp_matrix_vector.mjs";
import { buildIwspEmbeddingLookupCase } from "./vliw_gpu_conformance/iwsp_embedding_lookup.mjs";
import { buildIwspEmbeddingAttentionCases } from "./vliw_gpu_conformance/iwsp_embedding_attention.mjs";

function programlet(name, source, invocation, expectedValues) {
  const compiled = compilePyashProgramSource(source, { invocation });
  return { name, kind: "programlet", source, invocation, pack: compiled.pack, expectedValues };
}

async function programletExample(filename, name, expectedValues) {
  const sourceText = await readFile(new URL(`../examples/pyash/${filename}`, import.meta.url), "utf8");
  const lines = sourceText.trim().split(/\r?\n/u);
  const invocation = lines.pop();
  if (!invocation || !lines.length) throw new Error(`${filename} must contain definitions followed by one invocation`);
  return programlet(name, lines.join("\n"), invocation, expectedValues);
}

const SECTION_NAMES = [
  "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen",
  "nineteen", "twenty", "twenty one", "twenty two", "twenty three", "twenty four",
  "twenty five", "twenty six", "twenty seven", "twenty eight", "twenty nine", "zero", "first",
  "second", "hwas", "htis", "dlek"
];

export function buildVliwGpuConformanceBatches(cases) {
  const codeletCases = cases.filter(({ kind }) => kind === "codelets");
  const programletCases = cases.filter(({ kind }) => kind === "programlet");
  if (!codeletCases.length || !programletCases.length) {
    throw new Error("VLIW conformance batching requires codelet and programlet cases");
  }
  if (programletCases.length > SECTION_NAMES.length) {
    throw new Error(`VLIW conformance batch exceeds ${SECTION_NAMES.length} named programlet sections`);
  }

  const executableCodelets = codeletCases.flatMap(({ pack, executableCodelets: explicit }) =>
    explicit ?? decodePyacPack(pack).codelets
  );
  const storageCodelets = codeletCases.flatMap(({ storageCodelets: sections = [] }) => sections);
  const codeletPack = encodePyacPack([...executableCodelets, ...storageCodelets]);
  const sectionSource = programletCases.map(({ source, invocation }, index) => {
    const name = SECTION_NAMES[index];
    return [
      `su name ${name} be myocpfun def`,
      source,
      invocation,
      `su name ${name} be myocpfun prah`
    ].join("\n");
  }).join("\n");
  const sectioned = compilePyashProgramSource(sectionSource);
  const programletStorageCodelets = programletCases.flatMap(({ storageCodelets = [] }) => storageCodelets);
  const programletPack = programletStorageCodelets.length
    ? encodePyacPack([
      ...decodePyacPack(sectioned.pack).codelets,
      ...programletStorageCodelets
    ])
    : sectioned.pack;

  return [
    {
      kind: "codelets",
      name: `codelet batch (${codeletCases.length} cases)`,
      cases: codeletCases,
      pack: codeletPack,
      expectedValues: codeletCases.flatMap(({ expectedValues }) => expectedValues)
    },
    {
      kind: "programlets",
      name: `programlet sections (${programletCases.length} cases)`,
      cases: programletCases,
      pack: programletPack,
      sectionRanges: sectioned.sections,
      expectedSections: programletCases.map(({ expectedValues }) => expectedValues[0])
    }
  ];
}

function codeletPack(name, sources, expectedValues) {
  const sentences = Array.isArray(sources) ? sources : [sources];
  const codelets = sentences.flatMap((source) => lowerSentence(parse(source))).map((codelet) => codelet.words);
  return {
    name,
    kind: "codelets",
    pack: encodePyacPack(codelets),
    expectedValues
  };
}

function vectorPack(name, source, expectedValues) {
  const vectors = lowerPyashProgram([parse(source)]).vectors;
  return { name, kind: "codelets", pack: encodePyacPack(vectors), expectedValues };
}

async function storageBackedDotProductCase({
  name,
  lanes,
  width,
  rightValue,
  leftName = "dlek",
  rightName = "pset"
}) {
  const assetRoot = await mkdtemp(path.join(os.tmpdir(), "pyac-vliw-storage-"));
  try {
    const byteLength = lanes * width;
    const left = Buffer.alloc(byteLength);
    const right = Buffer.alloc(byteLength);
    let expected = 0;
    for (let lane = 0; lane < lanes; lane += 1) {
      const leftValue = lane + 1;
      const offset = lane * width;
      const write = width === 4 ? Buffer.prototype.writeFloatLE : Buffer.prototype.writeDoubleLE;
      write.call(left, leftValue, offset);
      write.call(right, rightValue, offset);
      expected += leftValue * rightValue;
    }
    await writeFile(path.join(assetRoot, "left.bin"), left);
    await writeFile(path.join(assetRoot, "right.bin"), right);
    const byteLengthWords = [byteLength % 0x1_0000, Math.floor(byteLength / 0x1_0000)];
    const storageSource = [
      `exists su name ${leftName} from filename "left.bin" by ve num ${byteLengthWords.join(" ")} as name float with ve num ${lanes} be pfun myoc ya`,
      `exists su name ${rightName} from filename "right.bin" by ve num ${byteLengthWords.join(" ")} as name float with ve num ${lanes} be pfun myoc ya`
    ].join("\n");
    const storagePack = compilePyashProgramSource(storageSource, { assetRoot }).pack;
    const storageCodelets = decodePyacPack(storagePack).codelets;
    const dotCodelets = lowerSentence(parse(`ob ${leftName} by ${rightName} be kl6m psas do`))
      .map(({ words }) => words);
    return {
      name,
      kind: "codelets",
      executableCodelets: dotCodelets,
      storageCodelets,
      pack: encodePyacPack([...dotCodelets, ...storageCodelets]),
      expectedValues: [{ type: width === 4 ? "float32" : "float64", value: expected }]
    };
  } finally {
    await rm(assetRoot, { recursive: true, force: true });
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
  const programletOver64Codelets = [
    "su name count once to name num answer be ceremony def",
    ...Array.from({ length: 80 }, () => "ob num 1 to name num answer be plus do"),
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
  const softmax = await programletExample("iwsp-stable-softmax.pya", "iwsp-stable-softmax-float32", [
    { type: "vector", elementType: "float32", values: [0.5, 0.5] }
  ]);
  const softmaxF64 = await programletExample("iwsp-stable-softmax-float64.pya", "iwsp-stable-softmax-float64", [
    { type: "vector", elementType: "float64", values: [0.5, 0.5] }
  ]);
  const attention = await programletExample("iwsp-two-key-one-query-attention.pya", "iwsp-two-key-one-query-attention", [
    { type: "vector", elementType: "float32", values: [3, 5] }
  ]);
  const projectedAttention = await programletExample(
    "iwsp-pyash-projected-attention.pya",
    "iwsp-pyash-projected-attention",
    [{ type: "vector", elementType: "float32", values: [3, 5] }]
  );
  const minimalTransformerBlock = await programletExample(
    "iwsp-minimal-role-projected-block.pya",
    "iwsp-minimal-role-projected-block",
    [{ type: "vector", elementType: "float32", values: [-1, 1] }]
  );
  const minimalBlockLines = (await readFile(
    new URL("../examples/pyash/iwsp-minimal-role-projected-block.pya", import.meta.url),
    "utf8"
  )).trim().split(/\r?\n/u);
  const minimalBlockInvocation = minimalBlockLines.pop();
  const zeroVarianceInvocation = minimalBlockInvocation.replace(
    "ob ve float32 1 0 from ve float32 1 0 by ve float32 0 1",
    "ob ve float32 0 0 from ve float32 0 0 by ve float32 0 0"
  );
  if (zeroVarianceInvocation === minimalBlockInvocation) {
    throw new Error("minimal transformer block invocation changed unexpectedly");
  }
  const minimalTransformerBlockZeroVariance = programlet(
    "iwsp-minimal-role-projected-block-zero-variance",
    minimalBlockLines.join("\n"),
    zeroVarianceInvocation,
    [{ type: "vector", elementType: "float32", values: [0, 0] }]
  );
  const float64StandardDeviation = programlet(
    "iwsp-float64-standard-deviation",
    [
      "su name candidate prediction to name float answer be ceremony def",
      "ob ve float64 3 4 by ve float64 3 4 to name float count be kl6m psas do",
      "from name float count to name float answer be dwic kwap do",
      "su name answer ret",
      "su name candidate prediction be ceremony prah"
    ].join("\n"),
    "to name float answer be candidate prediction do",
    [{ type: "float64", value: 5 }]
  );
  const qkvProjectionText = await readFile(
    new URL("../examples/pyash/iwsp-qkv-projection.pya", import.meta.url),
    "utf8"
  );
  const qkvProjection = codeletPack(
    "iwsp-qkv-row-projections",
    qkvProjectionText.trim().split(/\r?\n/u),
    [
      { type: "vector", elementType: "float32", values: [1, 2] },
      { type: "vector", elementType: "float32", values: [0, 0, 0] },
      { type: "float32", value: 1 },
      { type: "float32", value: 5 },
      { type: "float32", value: 4 },
      { type: "vector", elementType: "float32", values: [1, 5, 4] },
      { type: "unsigned", value: 3 }
    ]
  );
  const maximumIndexText = await readFile(
    new URL("../examples/pyash/iwsp-maximum-index.pya", import.meta.url),
    "utf8"
  );
  const maximumIndexLines = maximumIndexText.trim().split(/\r?\n/u);
  const maximumIndexInvocation = maximumIndexLines.pop();
  const maximumIndexSource = maximumIndexLines.join("\n");
  const maximumIndex = programlet(
    "iwsp-maximum-index-float32",
    maximumIndexSource,
    maximumIndexInvocation,
    [{ type: "unsigned", value: 1 }]
  );
  const maximumIndexF64 = programlet(
    "iwsp-maximum-index-float64",
    maximumIndexSource,
    "from ve float64 4 9 9 -2 to name num answer be answer do",
    [{ type: "unsigned", value: 1 }]
  );
  const bankSenseSource = await readFile(
    new URL("../examples/pyash/iwsp-wsd-bank-sense-selection.pya", import.meta.url),
    "utf8"
  );
  const bankSenseCases = [
    ["iwsp-wsd-bank-financial-context", [1, 0.25], 0, ["pcan psas", "hwas tlat", "tlat psas", "hwas psas"]],
    ["iwsp-wsd-bank-river-context", [0.25, 1], 1, ["hyun kl6m", "htis pcun", "hwas hyun", "kl6m hmi7n"]],
    ["iwsp-wsd-bank-tied-context", [1, 1], 0, ["dlek tfo2t", "hdi7s hmi7n", "tfo2t pcan", "hmi7n hyun"]]
  ].map(([name, context, expectedIndex, names]) => {
    const [featureName, predictionName, firstWeightName, secondWeightName] = names;
    const source = bankSenseSource
      .replaceAll("candidate prediction", predictionName)
      .replaceAll("weight money", firstWeightName)
      .replaceAll("weight river", secondWeightName)
      .replaceAll("features", featureName)
      .replace(
        `su name ${featureName} ob ve float32 1 0.25`,
        `su name ${featureName} ob ve float32 ${context.join(" ")}`
      );
    return codeletPack(name, source.trim().split(/\r?\n/u), [
      { type: "vector", elementType: "float32", values: context },
      { type: "vector", elementType: "float32", values: [1, 0] },
      { type: "vector", elementType: "float32", values: [0, 1] },
      { type: "vector", elementType: "float32", values: [0, 0] },
      { type: "float32", value: context[0] },
      { type: "float32", value: context[1] },
      { type: "unsigned", value: expectedIndex }
    ]);
  });

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
    codeletPack(
      "float32-dot-product",
      "ob ve float32 1 2 3 by ve float32 4 5 6 be kl6m psas do",
      [{ type: "float32", value: 32 }]
    ),
    buildPlukTlasConformanceCase(),
    ...buildIwspLinearScorerConformanceCases(),
    ...buildIwspVectorOpsConformanceCases(),
    softmax,
    softmaxF64,
    attention,
    ...await buildIwspParameterizedAttentionCases(),
    ...await buildIwspEmbeddingAttentionCases(),
    projectedAttention,
    minimalTransformerBlock,
    minimalTransformerBlockZeroVariance,
    float64StandardDeviation,
    qkvProjection,
    maximumIndex,
    maximumIndexF64,
    ...bankSenseCases,
    codeletPack(
      "float64-dot-product",
      "ob ve float64 0.1 2 -3 by ve float64 0.2 4 -5 be kl6m psas do",
      [{ type: "float64", value: 23.02 }]
    ),
    await storageBackedDotProductCase({
      name: "float32-storage-backed-dot-product-32-lanes",
      lanes: 32,
      width: 4,
      rightValue: 2
    }),
    await storageBackedDotProductCase({
      name: "float64-storage-backed-dot-product-17-lanes",
      lanes: 17,
      width: 8,
      rightValue: 0.25,
      leftName: "gjat",
      rightName: "hdi7s"
    }),
    await buildIwspMatrixVectorStorageCase(),
    await buildIwspEmbeddingLookupCase(),
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
      "programlet-over-64-codelets",
      programletOver64Codelets,
      "to name num answer be count once do",
      [{ type: "unsigned", value: 80 }]
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
  const longPack = cases.find(({ name }) => name === "programlet-over-64-codelets").pack;
  assert.ok(decodePyacPack(longPack).codelets.length > 64);
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
  const negativeStandardDeviationSource = [
    "su name candidate prediction to name float answer be ceremony def",
    "ob ve float32 -1 0 by ve float32 1 0 to name float count be kl6m psas do",
    "from name float count to name float answer be dwic kwap do",
    "su name answer ret",
    "su name candidate prediction be ceremony prah"
  ].join("\n");
  const negativeStandardDeviation = compilePyashProgramSource(
    negativeStandardDeviationSource,
    { invocation: "to name float answer be candidate prediction do" }
  );
  const negativeVarianceWithEpsilonSource = [
    "su name candidate prediction to name float answer be ceremony def",
    "ob ve float32 -1 0 by ve float32 1 0 to name float count be kl6m psas do",
    "from name float count with num 1.5 to name float answer be dwic kwap do",
    "su name answer ret",
    "su name candidate prediction be ceremony prah"
  ].join("\n");
  const negativeVarianceWithEpsilon = compilePyashProgramSource(
    negativeVarianceWithEpsilonSource,
    { invocation: "to name float answer be candidate prediction do" }
  );
  const negativeEpsilonSource = [
    "su name candidate prediction to name float answer be ceremony def",
    "ob ve float32 1 0 by ve float32 1 0 to name float count be kl6m psas do",
    "from name float count with num -0.1 to name float answer be dwic kwap do",
    "su name answer ret",
    "su name candidate prediction be ceremony prah"
  ].join("\n");
  const negativeEpsilon = compilePyashProgramSource(
    negativeEpsilonSource,
    { invocation: "to name float answer be candidate prediction do" }
  );
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
      expectedRuntimeCode: 2
    },
    {
      name: "programlet-constant-write",
      pack: constantWritePack,
      expectedRuntimeCode: 7
    },
    {
      name: "programlet-negative-standard-deviation",
      pack: negativeStandardDeviation.pack,
      expectedRuntimeCode: 11
    },
    {
      name: "programlet-negative-variance-with-positive-epsilon",
      pack: negativeVarianceWithEpsilon.pack,
      expectedRuntimeCode: 11
    },
    {
      name: "programlet-negative-normalization-epsilon",
      pack: negativeEpsilon.pack,
      expectedRuntimeCode: 11
    }
  ];
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

export async function runVliwGpuConformance({
  executeCpuPacks,
  executePack,
  backend = "rust-gpu-vulkan",
  onProgress = () => {},
  onTiming = () => {}
}) {
  if (typeof executeCpuPacks !== "function") {
    throw new TypeError("VLIW conformance requires a Rust CPU pack executor");
  }
  if (typeof executePack !== "function") {
    throw new TypeError("VLIW GPU conformance requires a Housekeeper pack executor");
  }
  const cases = await buildVliwGpuConformanceCases();
  const batches = buildVliwGpuConformanceBatches(cases);
  const cpuBatchResults = [];
  for (const batch of batches) {
    const startedMs = performance.now();
    const results = await executeCpuPacks([batch.pack]);
    const elapsedMs = Number((performance.now() - startedMs).toFixed(3));
    assert.equal(results?.length, 1, `${batch.name}: Rust CPU returned a different number of results`);
    cpuBatchResults.push(results[0]);
    onTiming({
      phase: "cpu-request",
      name: batch.name,
      elapsedMs,
      packBytes: Buffer.byteLength(batch.pack),
      caseCount: batch.cases.length
    });
  }
  for (const [index, batch] of batches.entries()) {
    const expectedValues = batch.kind === "codelets"
      ? batch.expectedValues
      : batch.expectedSections;
    assert.deepEqual(
      cpuBatchResults[index],
      expectedValues,
      `${batch.name}: Rust CPU batch differs from declared expected values`
    );
    if (batch.kind === "codelets") {
      let valueIndex = 0;
      for (const testCase of batch.cases) {
        const values = cpuBatchResults[index].slice(valueIndex, valueIndex + testCase.expectedValues.length);
        valueIndex += testCase.expectedValues.length;
        onProgress({ phase: "cpu-complete", name: testCase.name, values });
      }
    } else {
      batch.cases.forEach((testCase, sectionIndex) => {
        onProgress({ phase: "cpu-complete", name: testCase.name, values: [cpuBatchResults[index][sectionIndex]] });
      });
    }
  }

  const completedByName = new Map();
  for (const batch of batches) {
    onProgress({ phase: "start", name: batch.name, caseCount: batch.cases.length });
    const startedMs = performance.now();
    let housekeeperTiming = null;
    try {
      const result = await executePack(batch.pack);
      housekeeperTiming = result?.housekeeperTiming ?? null;
      onTiming({
        phase: "gpu-request",
        name: batch.name,
        elapsedMs: Number((performance.now() - startedMs).toFixed(3)),
        packBytes: Buffer.byteLength(batch.pack),
        caseCount: batch.cases.length,
        housekeeper: housekeeperTiming
      });
      assert.equal(result?.ok, true, `${batch.name}: Housekeeper worker did not report success`);
      assert.equal(result.backend, backend, `${batch.name}: unexpected GPU backend`);
      assert.ok(String(result.device ?? "").trim(), `${batch.name}: missing GPU device identity`);
      if (batch.kind === "codelets") {
        assert.deepEqual(result.values, batch.expectedValues, `${batch.name}: typed results differ from declared expected values`);
        let valueIndex = 0;
        for (const testCase of batch.cases) {
          const values = result.values.slice(valueIndex, valueIndex + testCase.expectedValues.length);
          valueIndex += testCase.expectedValues.length;
          const entry = { name: testCase.name, device: result.device, values };
          completedByName.set(testCase.name, entry);
          onProgress({ phase: "complete", ...entry });
        }
      } else {
        assert.equal(result.sections?.length, batch.cases.length, `${batch.name}: missing section results`);
        const seen = new Set();
        for (const section of result.sections) {
          const index = Number(section.sectionIndex);
          assert.ok(Number.isInteger(index) && index >= 0 && index < batch.cases.length, `${batch.name}: invalid section index`);
          assert.ok(!seen.has(index), `${batch.name}: duplicate section result ${index}`);
          seen.add(index);
          const testCase = batch.cases[index];
          const values = [section.value];
          assert.deepEqual(values, testCase.expectedValues, `${testCase.name}: typed result differs from declared expected values`);
          const entry = { name: testCase.name, device: result.device, values, completionOrder: section.completionOrder };
          completedByName.set(testCase.name, entry);
          onProgress({ phase: "complete", ...entry });
        }
        assert.equal(seen.size, batch.cases.length, `${batch.name}: one or more section results are missing`);
      }
    } catch (error) {
      housekeeperTiming ??= error?.housekeeperTiming ?? null;
      onTiming({
        phase: "gpu-request-failed",
        name: batch.name,
        elapsedMs: Number((performance.now() - startedMs).toFixed(3)),
        packBytes: Buffer.byteLength(batch.pack),
        caseCount: batch.cases.length,
        housekeeper: housekeeperTiming
      });
      const detail = error instanceof Error ? error.message : String(error);
      onProgress({ phase: "fail", name: batch.name, error: detail });
      throw new Error(`${batch.name}: ${detail}`, { cause: error });
    }
  }
  return cases.map(({ name }) => completedByName.get(name));
}

export async function runVliwGpuProgramletFailureConformance({
  executeCpuError,
  executePack,
  onProgress = () => {},
  onTiming = () => {}
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
    const cpuStartedMs = performance.now();
    const cpuCode = await executeCpuError(testCase.pack);
    onTiming({
      phase: "cpu-error-request",
      name: testCase.name,
      elapsedMs: Number((performance.now() - cpuStartedMs).toFixed(3)),
      packBytes: Buffer.byteLength(testCase.pack)
    });
    assert.equal(
      cpuCode,
      testCase.expectedRuntimeCode,
      `${testCase.name}: Rust CPU returned a different shared runtime error`
    );
    onProgress({ phase: "cpu-error", name: testCase.name, errorCode: cpuCode });
    const gpuStartedMs = performance.now();
    let housekeeperTiming = null;
    try {
      await assert.rejects(
        async () => {
          try {
            await executePack(testCase.pack);
          } catch (error) {
            housekeeperTiming = error?.housekeeperTiming ?? null;
            throw error;
          }
        },
        new RegExp(`shared VLIW runtime error ${testCase.expectedRuntimeCode}\\b`, "u"),
        `${testCase.name}: Vulkan worker must return the same shared runtime error`
      );
    } finally {
      onTiming({
        phase: "gpu-error-request",
        name: testCase.name,
        elapsedMs: Number((performance.now() - gpuStartedMs).toFixed(3)),
        packBytes: Buffer.byteLength(testCase.pack),
        housekeeper: housekeeperTiming
      });
    }
    const entry = { name: testCase.name, errorCode: testCase.expectedRuntimeCode };
    completed.push(entry);
    onProgress({ phase: "gpu-error", ...entry });
  }
  return completed;
}

async function main() {
  const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const startedAt = new Date().toISOString();
  const startedMs = performance.now();
  const report = {
    startedAt,
    status: "running",
    cpuRequests: [],
    gpuRequests: [],
    passedCases: [],
    expectedErrors: []
  };
  const backend = process.env.PYA_VLIW_CONFORMANCE_BACKEND || "rust-gpu-vulkan";
  const targetHostId = process.env.PYA_VLIW_CONFORMANCE_HOST;
  if (backend === "rust-cuda-cubin" && !targetHostId) {
    throw new Error("CUDA conformance requires PYA_VLIW_CONFORMANCE_HOST");
  }
  const timeoutMs = Number(process.env.PYA_VLIW_CONFORMANCE_TIMEOUT_MS) || 5 * 60 * 1000;
  const executePack = targetHostId
    ? createPinnedVliwPackExecutor({ targetHostId, timeoutMs })
    : createHousekeeperVliwPackExecutor({
    worldRoot: path.resolve(process.env.PYA_WORLD_ROOT || "world"),
    agentName: "vliw-gpu-conformance",
    deviceId: process.env.PYA_VLIW_CONFORMANCE_DEVICE_ID || "gpu0",
    timeoutMs
  });
  let failure = null;
  try {
    if (backend === "rust-cuda-cubin") {
      await verifyTypedDispatch({
        executePack,
        executeCpuPacks: executeRustCpuReference,
        executeCpuError: executeRustCpuProgramletFailureReference,
        backend,
        report(name, housekeeper, device, expected) {
          report.gpuRequests.push({ name, housekeeper });
          if (device) report.passedCases.push(name);
          else report.expectedErrors.push({ name, errorCode: expected });
          console.log(`PASS CUDA ${name}: ${JSON.stringify(expected)}; ${JSON.stringify(housekeeper)}`);
        }
      });
    }
    const completed = await runVliwGpuConformance({
      executeCpuPacks: executeRustCpuReference,
      executePack,
      backend,
      onTiming(event) {
        const target = event.phase.startsWith("cpu") ? report.cpuRequests : report.gpuRequests;
        target.push(event);
        const housekeeper = event.housekeeper;
        const runtime = housekeeper?.runtimeTimingMs;
        const timing = housekeeper
          ? `client ${housekeeper.clientRoundTripMs}ms; local queue ${housekeeper.localQueueWaitMs ?? "n/a"}ms; Housekeeper queue ${housekeeper.housekeeperQueueWaitMs ?? "n/a"}ms; Housekeeper active ${housekeeper.housekeeperActiveMs ?? "n/a"}ms; kernel ${runtime?.kernelGpuMs ?? "n/a"}ms; submit/wait ${runtime?.submitWaitReadbackMs ?? "n/a"}ms`
          : `wall ${event.elapsedMs}ms`;
        console.log(`[timing] ${event.phase} ${event.name}: ${timing}`);
      },
      onProgress(event) {
        if (event.phase === "start") console.log(`Queueing Rust GPU conformance batch: ${event.name}`);
        if (event.phase === "cpu-complete") console.log(`PASS Rust CPU ${event.name}: ${JSON.stringify(event.values)}`);
        if (event.phase === "complete") {
          report.passedCases.push(event.name);
          console.log(`PASS ${event.name} on ${event.device}: ${JSON.stringify(event.values)}`);
        }
      }
    });
    console.log(`Rust GPU Housekeeper conformance passed: ${completed.length} cases.`);
    const failures = await runVliwGpuProgramletFailureConformance({
      executeCpuError: executeRustCpuProgramletFailureReference,
      executePack,
      onTiming(event) {
        const target = event.phase.startsWith("cpu") ? report.cpuRequests : report.gpuRequests;
        target.push(event);
        const housekeeper = event.housekeeper;
        const runtime = housekeeper?.runtimeTimingMs;
        const timing = housekeeper
          ? `client ${housekeeper.clientRoundTripMs}ms; local queue ${housekeeper.localQueueWaitMs ?? "n/a"}ms; Housekeeper queue ${housekeeper.housekeeperQueueWaitMs ?? "n/a"}ms; Housekeeper active ${housekeeper.housekeeperActiveMs ?? "n/a"}ms; kernel ${runtime?.kernelGpuMs ?? "n/a"}ms; submit/wait ${runtime?.submitWaitReadbackMs ?? "n/a"}ms`
          : `wall ${event.elapsedMs}ms`;
        console.log(`[timing] ${event.phase} ${event.name}: ${timing}`);
      },
      onProgress(event) {
        if (event.phase === "cpu-error") {
          console.log(`PASS Rust CPU shared runtime error ${event.name}: ${event.errorCode}`);
        }
        if (event.phase === "gpu-error") {
          report.expectedErrors.push({ name: event.name, errorCode: event.errorCode });
          console.log(`PASS ${event.name} on ${backend}: shared runtime error ${event.errorCode}`);
        }
      }
    });
    console.log(`Rust GPU Housekeeper error conformance passed: ${failures.length} cases.`);
    report.status = "passed";
  } catch (error) {
    failure = error;
    report.status = "failed";
    report.failure = error instanceof Error ? error.message : String(error);
  }
  report.finishedAt = new Date().toISOString();
  report.totalWallMs = Number((performance.now() - startedMs).toFixed(3));
  try {
    report.environment = await collectVliwConformanceEnvironment(repositoryRoot, {
      cudaHost: backend === "rust-cuda-cubin" ? targetHostId : undefined
    });
  } catch (error) {
    report.environmentError = error instanceof Error ? error.message : String(error);
  }
  const reportPath = await writeVliwConformancePya(repositoryRoot, report);
  console.log(`VLIW conformance metrics: ${path.relative(repositoryRoot, reportPath)}`);
  if (failure) throw failure;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error?.stack ?? error);
    process.exitCode = 1;
  });
}
