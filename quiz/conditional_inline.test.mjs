import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { remember, forget } from "../program/remember/index.mjs";

async function run(lines) {
  for (const line of lines) {
    const sentence = parse(line);
    if (sentence) await interpret(sentence);
  }
}

test("inline then consequence executes without gating the next line", async () => {
  forget();

  await run([
    "exists subj name counter obj num 0 be number ya",
    "obj num 1 be tiny from num 2 then obj num 1 to name counter be add do",
    "obj num 2 to name counter be add do"
  ]);

  const counter = remember("counter");
  assert.equal(counter?.obj?.num, 3);
});
