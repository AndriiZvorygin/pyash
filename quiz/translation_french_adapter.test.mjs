import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";

test("french adapter parses basic imperative lines", async () => {
  forget();
  const sentence = parse(
    "from text quoted.pyash.ajoute 2 a collector..pyash.quoted from state french to state pyash to name output be translation do"
  );
  const result = await interpret(sentence);
  assert.equal(result?.value?.text?.trim(), "ob num 2 to name collector be plus do");
});

test("french adapter formats unmapped pyash sentences", async () => {
  forget();
  const sentence = parse(
    "from text quoted.pyash.su name alpha ob num 2 be cost ya.pyash.quoted fromstate name pyash become name french to name output be translation do"
  );
  const result = await interpret(sentence);
  assert.equal(result?.value?.text?.trim(), "alpha est cost 2.");
});
