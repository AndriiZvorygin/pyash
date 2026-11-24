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
  const changedInputs = invocation.replace("ob ve float32 1 0", "ob ve float32 2 0");
  const changedQueryWeights = source.replace(
    "ob name first by ve float32 1 0 to name hwas at num 0",
    "ob name first by ve float32 2 0 to name hwas at num 0"
  );
  const changedKeyWeights = source.replace(
    "ob name second by ve float32 0 0.6931472 to name htis hsek at num 0",
    "ob name second by ve float32 0 1.3862944 to name htis hsek at num 0"
  );
  const changedValueWeights = source
    .replace(
      "ob name second by ve float32 0 15 to name hnuc gjat second at num 0",
      "ob name second by ve float32 0 30 to name hnuc gjat second at num 0"
    )
    .replace(
      "ob name second by ve float32 0 30 to name hnuc gjat second at num 1",
      "ob name second by ve float32 0 45 to name hnuc gjat second at num 1"
    );
  if (
    changedInputs === invocation ||
    changedQueryWeights === source ||
    changedKeyWeights === source ||
    changedValueWeights === source
  ) {
    throw new Error("parameterized attention source no longer matches its conformance variants");
  }

  return [
    attentionCase("iwsp-parameterized-two-token-attention", source, invocation, [10, 20]),
    attentionCase("iwsp-parameterized-attention-changed-inputs", source, changedInputs, [12, 24]),
    attentionCase("iwsp-parameterized-attention-changed-query-weights", changedQueryWeights, invocation, [12, 24]),
    attentionCase("iwsp-parameterized-attention-changed-key-weights", changedKeyWeights, invocation, [12, 24]),
    attentionCase("iwsp-parameterized-attention-changed-value-weights", changedValueWeights, invocation, [20, 30])
  ];
}
