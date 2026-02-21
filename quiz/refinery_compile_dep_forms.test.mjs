import test from "node:test";
import assert from "node:assert/strict";

import { buildProgram } from "../program/program.mjs";
import { transpileProgram } from "../program/verbs/exchange/compile.mjs";

test("compile accepts refinery deps with from name and repeated-name from ve form", async () => {
  const program = [
    "su name build be refinery def",
    "su name one ob text \"1\" be write do",
    "su name two from name one ob text \"2\" be write do",
    "su name three from ve name one name two ob text \"3\" be write do",
    "prah",
    "from name build be refinery do"
  ].join("\n");

  assert.doesNotThrow(() => transpileProgram(buildProgram(program).sentences, { lang: "javascript" }));
});
