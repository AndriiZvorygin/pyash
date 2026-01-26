import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";

test("translation templates cover conditionals", async () => {
  forget();
  const sentence = parse(
    "from text quoted.pyash.ob num 3 be tiny from num 5 then ob num 1 to name total be plus do.pyash.quoted from state pyash to state english to name output be translation do"
  );
  const result = await interpret(sentence);
  assert.equal(result?.value?.text?.trim(), "if 3 is tiny from 5 then do plus 1 to total.");
});
