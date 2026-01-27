import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";

test("hindi adapter parses basic imperative lines", async () => {
  forget();
  const sentence = parse(
    "from text quoted.pyash.collector में 2 जोड़ो..pyash.quoted from state hindi to state pyash to name output be translation do"
  );
  const result = await interpret(sentence);
  assert.equal(result?.value?.text?.trim(), "ob num 2 to name collector be plus do");
});
