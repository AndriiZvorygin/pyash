import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, remember } from "../program/remember/index.mjs";

test("genitives attach to all cases with multiword nodes", () => {
  const sentence = parse("su name view from text of to of seed stdout to text of to of result stash be say do");
  assert.deepEqual(sentence.su?.name, "view");
  assert.deepEqual(sentence.from?.genitive?.chain, ["seed stdout", "to", "text"]);
  assert.deepEqual(sentence.to?.genitive?.chain, ["result stash", "to", "text"]);
});

test("genitive math inputs resolve in refinery", async () => {
  forget();
  const lines = [
    "su name calc be refinery def",
    "exists su name a ob num 10 be number ya",
    "exists su name b ob num 5 be number ya",
    "su name product ob num of a by num of b be multiply do",
    "su name doubled ob num of product by num 2 be multiply do",
    "prah",
    "from name calc be refinery do"
  ];
  for (const line of lines) {
    await interpret(parse(line));
  }
  const fact = remember("doubled");
  assert.equal(fact?.ob?.num, 100);
});
