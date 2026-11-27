import { rustBlockBoundsFrom } from "./rust_function_source.mjs";

const BRANCHES = [
  ["local-declaration", String.raw`\(1, MoodClass::Static\)\s*=>`],
  ["vector-action", String.raw`\}\s*else if is_programlet_vector_action\(`],
  ["number-action", String.raw`\}\s*else if sentence\.verb_length == 1\s*&& matches!\(\s*sentence_at!\(sentence_view, sentence\.verb_start\),\s*PLUS\s*\|`],
  ["boolean-action", String.raw`\}\s*else if sentence\.verb_length == 1\s*&& sentence_at!\(sentence_view, sentence\.verb_start\) == BOOLEAN_VERB`],
  ["call", String.raw`\}\s*else\s*\{\s*array_put!\(&mut frames\.controls, frame_index, frame\);\s*if let Err\(error\) = execute_programlet_call\(`],
  ["return", String.raw`\(1, MoodClass::Return\)\s*=>`],
  ["paragraph-close", String.raw`\(2, MoodClass::Close\)\s*=>`],
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
  const branchStart = matches[0].index;
  const { bodyStart, bodyEnd } = rustBlockBoundsFrom(source, branchStart);
  const originalBody = source.slice(bodyStart, bodyEnd);
  const replacementBody = mode === "noop" ? "{}" : "{ return CoreResult::failure(ERROR_UNSUPPORTED, steps); }";
  return {
    source: `${source.slice(0, bodyStart)}${replacementBody}${source.slice(bodyEnd)}`,
    originalBody,
    replacementBody,
  };
}
