import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";

async function compileC(pyash) {
  forget();
  const sentence = parse(`from text quoted.pyash.${pyash}.pyash.quoted to state c to text output be compile do`);
  const result = await interpret(sentence);
  const text = String(result?.ob?.text ?? result?.value?.text ?? "");
  return text
    .replace(/^\s*quoted\.c\.\s*/u, "")
    .replace(/\s*\.c\.quoted\s*$/u, "");
}

test("generated C declares string.h when it compares text with strcmp", async () => {
  const c = await compileC([
    "exists su name counter ob num 0 be number ya",
    "ob text truth be equally from text truth then ob num 1 to name counter be plus do",
    "ob name counter be write do",
  ].join("\n"));

  assert.match(c, /strcmp\(/u);
  assert.match(c, /#include <string\.h>/u);
});

test("generated C declares math.h when it uses fmod", async () => {
  const c = await compileC([
    "exists su name x ob num 10 be number ya",
    "ob num 3 to name x be remains do",
    "ob name x be write do",
  ].join("\n"));

  assert.match(c, /fmod\(/u);
  assert.match(c, /#include <math\.h>/u);
});
