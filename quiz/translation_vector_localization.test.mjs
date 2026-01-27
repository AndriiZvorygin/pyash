import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";

test("translation uses localized vector tokens in russian output", async () => {
  forget();
  const sentence = parse(
    "from text quoted.pyash.su name nums ob ve num 1 2 3 be vector ya.pyash.quoted fromstate name pyash become name russian to name output be translation do"
  );
  const result = await interpret(sentence);
  const text = result?.ob?.text ?? result?.value?.text ?? "";
  assert.ok(text.includes("ве число 1 2 3"), "expected localized vector payload");
});
