import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";

test("interlingua adapter parses basic imperative lines", async () => {
  forget();
  const sentence = parse(
    "from text quoted.pyash.adde 2 a collector..pyash.quoted from state interlingua to state pyash to name output be translation do"
  );
  const result = await interpret(sentence);
  assert.equal(result?.value?.text?.trim(), "ob num 2 to name collector be plus do");
});
