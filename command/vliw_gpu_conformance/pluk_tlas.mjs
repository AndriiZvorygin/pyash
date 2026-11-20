import { parse } from "../../program/understand/index.mjs";
import { lowerSentence } from "../../program/library/vliw/index.mjs";
import { encodePyacPack } from "../../program/library/vliw/database.mjs";

const SOURCES = [
  'exists su name prediction via state "vector float32" by num 3 be variable ya',
  "ob ve float32 1 2 by ve float32 1 2 to name prediction at num 0 be kl6m psas do",
  "ob ve float32 2 1 by ve float32 1 2 to name prediction at num 1 be kl6m psas do",
  "ob ve float32 3 0 by ve float32 1 2 to name prediction at num 2 be kl6m psas do",
  "su name answer ob ve float32 5 4 3 be vector ya",
  "ob name prediction by name answer to name num count be pluk tlas do"
];

export function buildPlukTlasConformanceCase() {
  const codelets = SOURCES.flatMap((source) =>
    lowerSentence(parse(source)).map(({ words }) => words)
  );
  const expected = [
    { type: "vector", elementType: "float32", values: [0, 0, 0] },
    { type: "float32", value: 5 },
    { type: "float32", value: 4 },
    { type: "float32", value: 3 },
    { type: "vector", elementType: "float32", values: [5, 4, 3] },
    { type: "unsigned", value: 3 }
  ];

  return {
    name: "pluk-tlas-collects-dot-products-into-prediction-vector",
    kind: "codelets",
    pack: encodePyacPack(codelets),
    expectedValues: expected,
    referenceValues: expected
  };
}
