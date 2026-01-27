import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";

test("translation normalizes anchor word forms", async () => {
  forget();
  const sentence = parse(
    "from text quoted.pyash.active is number 1..pyash.quoted from state english to state pyash to name output be translation do"
  );
  const result = await interpret(sentence);
  assert.equal(result?.value?.text?.trim(), "su name actively ob num 1 be number ya");
});
