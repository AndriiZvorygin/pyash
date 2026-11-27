import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parse } from "../../program/understand/index.mjs";
import { compilePyashProgramSource } from "../../program/library/vliw/programlet.mjs";
import { decodePyacPack, encodePyacPack } from "../../program/library/vliw/database.mjs";

const EXAMPLE = "../../examples/vliw/iwsp-embedding-attention.pya";

function attentionCase(name, source, invocation, storageDeclarations, expected, assetRoot) {
  const compiled = compilePyashProgramSource(source, { invocation });
  const storagePack = compilePyashProgramSource(storageDeclarations.join("\n"), { assetRoot }).pack;
  const storageCodelets = decodePyacPack(storagePack).codelets;
  return {
    name,
    kind: "programlet",
    source,
    invocation,
    pack: encodePyacPack([
      ...decodePyacPack(compiled.pack).codelets,
      ...storageCodelets
    ]),
    storageCodelets,
    expectedValues: [{ type: "vector", elementType: "float32", values: expected }]
  };
}

export async function buildIwspEmbeddingAttentionCases() {
  const exampleUrl = new URL(EXAMPLE, import.meta.url);
  const lines = (await readFile(exampleUrl, "utf8"))
    .trim()
    .split(/\r?\n/u)
    .filter((line) => line.trim());
  const declarations = [];
  const programLines = [];
  for (const line of lines) {
    if (parse(line)?.from?.filename !== undefined) declarations.push(line);
    else programLines.push(line);
  }
  const invocation = programLines.pop();
  if (declarations.length !== 2 || !invocation || !programLines.length) {
    throw new Error("embedding-attention example needs a table, token IDs, and a programlet invocation");
  }

  const source = programLines.join("\n");
  const perturbedSource = source
    .replaceAll("pset gjat", "pset gjat second")
    .replaceAll("lwat txik", "lwat txik second");
  const perturbedDeclarations = declarations.map((line) => line
    .replaceAll("pset gjat", "pset gjat second")
    .replaceAll("lwat txik", "lwat txik second")
    .replace("iwsp-attention-embedding-table.bin", "iwsp-attention-embedding-table-perturbed.bin"));
  if (perturbedSource === source || perturbedDeclarations.some((line) => !line.includes("second"))) {
    throw new Error("embedding-attention source no longer supports the changed-table case");
  }

  const assetRoot = path.dirname(fileURLToPath(exampleUrl));
  return [
    attentionCase(
      "iwsp-file-backed-embedding-attention",
      source,
      invocation,
      declarations,
      [0.5, 0.5],
      assetRoot
    ),
    attentionCase(
      "iwsp-file-backed-embedding-attention-perturbed-values",
      perturbedSource,
      invocation,
      perturbedDeclarations,
      [0.5, 1.5],
      assetRoot
    )
  ];
}
