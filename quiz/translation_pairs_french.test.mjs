import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";

test("translation pairs provide french glosses", async () => {
  forget();
  const sentence = parse(
    "from text quoted.pyash.su name collector ob num 10 be number ya.pyash.quoted from state pyash to state french to name output be translation do"
  );
  const result = await interpret(sentence);
  assert.equal(result?.value?.text?.trim(), "collector est le nombre 10.");
});
