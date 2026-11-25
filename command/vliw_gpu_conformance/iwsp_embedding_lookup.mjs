import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parse } from "../../program/understand/index.mjs";
import { lowerSentence } from "../../program/library/vliw/index.mjs";
import { compilePyashProgramSource } from "../../program/library/vliw/programlet.mjs";
import { decodePyacPack, encodePyacPack } from "../../program/library/vliw/database.mjs";

const EXAMPLE = "../../examples/vliw/iwsp-embedding-row-lookup.pya";

export async function buildIwspEmbeddingLookupCase() {
  const exampleUrl = new URL(EXAMPLE, import.meta.url);
  const lines = (await readFile(exampleUrl, "utf8"))
    .trim()
    .split(/\r?\n/u)
    .filter((line) => line.trim());
  const declarations = [];
  const operations = [];
  for (const line of lines) {
    const sentence = parse(line);
    if (sentence?.from?.filename !== undefined) declarations.push(line);
    else operations.push(line);
  }
  if (declarations.length !== 2 || operations.length !== 6) {
    throw new Error("embedding lookup example requires two payload sections and three lookup/dot pairs");
  }

  const storagePack = compilePyashProgramSource(declarations.join("\n"), {
    assetRoot: path.dirname(fileURLToPath(exampleUrl))
  }).pack;
  const storageCodelets = decodePyacPack(storagePack).codelets;
  const executableCodelets = operations.flatMap((line) =>
    lowerSentence(parse(line)).map(({ words }) => words)
  );
  const expectedValues = [20, 40, 60].map((value) => ({ type: "float32", value }));
  return {
    name: "iwsp-float32-embedding-row-lookup-3x20",
    kind: "codelets",
    executableCodelets,
    storageCodelets,
    pack: encodePyacPack([...executableCodelets, ...storageCodelets]),
    expectedValues,
    referenceValues: expectedValues
  };
}
