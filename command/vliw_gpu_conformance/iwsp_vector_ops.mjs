import { parse } from "../../program/understand/index.mjs";
import { lowerSentence } from "../../program/library/vliw/index.mjs";
import { encodePyacPack } from "../../program/library/vliw/database.mjs";

function operationCase(name, sources, expectedValues) {
  const codelets = sources.flatMap((source) =>
    lowerSentence(parse(source)).map(({ words }) => words)
  );
  return {
    name,
    kind: "codelets",
    pack: encodePyacPack(codelets),
    expectedValues,
    referenceValues: expectedValues
  };
}

export function buildIwspVectorOpsConformanceCases() {
  return [
    operationCase(
      "iwsp-float32-vector-scale",
      ["ob ve float32 1.5 -2 0.25 to num 0.5 be multiply do"],
      [{ type: "vector", elementType: "float32", values: [0.75, -1, 0.125] }]
    ),
    operationCase(
      "iwsp-float32-vector-add",
      ["ob ve float32 1 2 3 to ve float32 4 5 6 be plus do"],
      [{ type: "vector", elementType: "float32", values: [5, 7, 9] }]
    ),
    operationCase(
      "iwsp-float32-vector-sum",
      ["ob ve float32 1 2 3 be tfo2t do"],
      [{ type: "float32", value: 6 }]
    ),
    operationCase(
      "iwsp-named-float32-vector-scale",
      [
        "su name features second ob ve float32 1 2 3 be vector ya",
        "ob name features second to num 0.5 be multiply do"
      ],
      [
        { type: "vector", elementType: "float32", values: [1, 2, 3] },
        { type: "vector", elementType: "float32", values: [0.5, 1, 1.5] }
      ]
    ),
    operationCase(
      "iwsp-float64-vector-scale-add-sum",
      [
        "ob ve float64 1.5 -2 0.25 to num 0.5 be multiply do",
        "ob ve float64 1 2 to ve float64 3 4 be plus do",
        "ob ve float64 1.25 2.75 be tfo2t do"
      ],
      [
        { type: "vector", elementType: "float64", values: [0.75, -1, 0.125] },
        { type: "vector", elementType: "float64", values: [4, 6] },
        { type: "float64", value: 4 }
      ]
    )
  ];
}
