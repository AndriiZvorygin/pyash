import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";

test("translation uses ISV dictionary for russian names", async () => {
  forget();
  const sentence = parse(
    "from text quoted.pyash.su name atlas ob num 1 be number ya.pyash.quoted fromstate name pyash become name russian to name output be translation do"
  );
  const result = await interpret(sentence);
  const text = result?.ob?.text ?? result?.value?.text ?? "";
  assert.ok(text.includes("атлас"), "expected atlas to translate via ISV dictionary");
});
