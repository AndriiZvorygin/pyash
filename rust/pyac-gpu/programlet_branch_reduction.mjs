import { rustBlockBoundsFrom } from "./rust_function_source.mjs";

const BRANCHES = [
  ["local-declaration", "frame.state == 1\n            && sentence.mood == REALIS"],
  ["vector-action", "frame.state == 1\n            && sentence.mood == DEONTIC\n            && is_programlet_vector_action"],
  ["number-action", "frame.state == 1\n            && sentence.mood == DEONTIC\n            && sentence.verb_length == 1\n            && matches!"],
  ["boolean-action", "== BOOLEAN_VERB"],
  ["call", "frame.state == 1 && sentence.mood == DEONTIC"],
  ["return", "frame.state == 1 && sentence.mood == MOOD_RETURN"],
  ["paragraph-close", "frame.state == 2 && sentence.mood == MOOD_PARAGRAPH"],
];

export function listProgramletBranches() {
  return BRANCHES.map(([name]) => name);
}

export function replaceProgramletBranch(source, name, mode = "error") {
  const entry = BRANCHES.find(([branch]) => branch === name);
  if (!entry) throw new Error(`unknown programlet branch: ${name}`);
  if (!new Set(["error", "noop"]).has(mode)) throw new Error(`unknown programlet branch replacement mode: ${mode}`);
  const matches = [...source.matchAll(new RegExp(entry[1], "gu"))];
  if (matches.length !== 1) throw new Error(`expected one ${name} branch; found ${matches.length}`);
  const conditionStart = matches[0].index;
  const branchStart = source.lastIndexOf("if ", conditionStart);
  const { bodyStart, bodyEnd } = rustBlockBoundsFrom(source, branchStart);
  const originalBody = source.slice(bodyStart, bodyEnd);
  const replacementBody = mode === "noop" ? "{}" : "{ return CoreResult::failure(ERROR_UNSUPPORTED, steps); }";
  return {
    source: `${source.slice(0, bodyStart)}${replacementBody}${source.slice(bodyEnd)}`,
    originalBody,
    replacementBody,
  };
}
