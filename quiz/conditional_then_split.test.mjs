import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, remember } from "../program/remember/index.mjs";
import { splitSentences } from "../program/library/sentenceSplitter.mjs";

async function runProgram(text) {
  const sentences = splitSentences(text, { includeThen: true });
  for (const line of sentences) {
    await interpret(parse(line));
  }
}

test("then-delimited sentences run conditionally without newlines", async () => {
  forget();
  await interpret(parse("exists su name counter ob num 0 be number ya"));

  await runProgram("ob num 1 be equally from num 2 then ob num 1 to name counter be plus do");
  assert.equal(remember("counter").ob.num, 0);

  await runProgram("ob num 1 be equally from num 1 then ob num 1 to name counter be plus do");
  assert.equal(remember("counter").ob.num, 1);
});
