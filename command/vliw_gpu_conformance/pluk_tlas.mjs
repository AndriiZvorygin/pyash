import { parse } from "../../program/understand/index.mjs";
import { lowerSentence } from "../../program/library/vliw/index.mjs";
import { encodePyacPack } from "../../program/library/vliw/database.mjs";

const SOURCES = [
  "su name prediction ob ve float32 1 2 3 be vector ya",
  "su name answer ob ve float32 1 2 4 be vector ya",
  "ob name prediction by name answer to name num count be pluk tlas do"
];

export function buildPlukTlasConformanceCase() {
  const codelets = SOURCES.flatMap((source) =>
    lowerSentence(parse(source)).map(({ words }) => words)
  );
  const expected = [
    { type: "vector", elementType: "float32", values: [1, 2, 3] },
    { type: "vector", elementType: "float32", values: [1, 2, 4] },
    { type: "unsigned", value: 2 }
  ];

  return {
    name: "pluk-tlas-exact-match-count",
    kind: "codelets",
    pack: encodePyacPack(codelets),
    expectedValues: expected,
    referenceValues: expected
  };
}
