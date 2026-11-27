import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parse } from "../../program/understand/index.mjs";
import { lowerSentence } from "../../program/library/vliw/index.mjs";
import { encodePyacPack } from "../../program/library/vliw/database.mjs";

const sourcePath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../examples/pyash/iwsp-linear-scorer-v1.pya"
);

function scorerCase(name, source, weights, scores, score) {
  const codelets = source
    .split(/\n/u)
    .filter((line) => line.trim())
    .flatMap((line) => lowerSentence(parse(line)).map(({ words }) => words));
  const expected = [
    { type: "vector", elementType: "float32", values: [1, 2] },
    ...weights.map((values) => ({ type: "vector", elementType: "float32", values })),
    { type: "vector", elementType: "float32", values: [0, 0, 0] },
    ...scores.map((value) => ({ type: "float32", value })),
    { type: "vector", elementType: "float32", values: [5, 4, 3] },
    { type: "unsigned", value: score }
  ];

  return {
    name,
    kind: "codelets",
    pack: encodePyacPack(codelets),
    expectedValues: expected,
    referenceValues: expected
  };
}

export function buildIwspLinearScorerConformanceCases() {
  const source = fs.readFileSync(sourcePath, "utf8");
  const isolatedCandidate = source
    .replaceAll("candidate prediction", "second candidate prediction")
    .replaceAll("candidate answer", "second candidate answer")
    .replaceAll("weight one", "second weight one")
    .replaceAll("weight two", "second weight two")
    .replaceAll("weight three", "second weight three")
    .replaceAll("features", "second features");
  const changedWeights = isolatedCandidate.replace(
    "su name second weight three ob ve float32 3 0 be vector ya",
    "su name second weight three ob ve float32 2 0 be vector ya"
  );
  if (changedWeights === isolatedCandidate) {
    throw new Error("IWSP scorer fixture did not contain the expected third weight vector");
  }

  return [
    scorerCase(
      "iwsp-linear-scorer-named-vectors",
      source,
      [[1, 2], [2, 1], [3, 0]],
      [5, 4, 3],
      3
    ),
    scorerCase(
      "iwsp-linear-scorer-perturbed-candidate",
      changedWeights,
      [[1, 2], [2, 1], [2, 0]],
      [5, 4, 2],
      2
    )
  ];
}
