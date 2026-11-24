import { readFile } from "node:fs/promises";
import { compilePyashProgramSource } from "../../program/library/vliw/programlet.mjs";

const ATTENTION_EXAMPLE = "../../examples/vliw/iwsp-parameterized-two-token-attention.pya";

function attentionCase(name, source, invocation, values) {
  const compiled = compilePyashProgramSource(source, { invocation });
  return {
    name,
    kind: "programlet",
    source,
    invocation,
    pack: compiled.pack,
    expectedValues: [{ type: "vector", elementType: "float32", values }]
  };
}

export async function buildIwspParameterizedAttentionCases() {
  const text = await readFile(new URL(ATTENTION_EXAMPLE, import.meta.url), "utf8");
  const lines = text.trim().split(/\r?\n/u);
  const invocation = lines.pop();
  if (!invocation || lines.length === 0) {
    throw new Error("parameterized attention example needs definitions and one invocation");
  }
  const source = lines.join("\n");
  const changedInputs = invocation
    .replace("ob ve float32 1 0", "ob ve float32 2 0")
    .replace("from ve float32 0 1", "from ve float32 0 3");
  const changedWeights = source
    .replaceAll("by ve float32 1 5", "by ve float32 2 6")
    .replaceAll("by ve float32 3 7", "by ve float32 4 8");
  if (changedInputs === invocation || changedWeights === source) {
    throw new Error("parameterized attention invocation no longer matches its conformance variants");
  }

  return [
    attentionCase("iwsp-parameterized-two-token-attention", source, invocation, [3, 5]),
    attentionCase("iwsp-parameterized-attention-changed-inputs", source, changedInputs, [8.5, 13.5]),
    attentionCase("iwsp-parameterized-attention-changed-value-weights", changedWeights, invocation, [4, 6])
  ];
}
