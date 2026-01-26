import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";

test("translation templates cover vector and remains", async () => {
  forget();
  const vectorSentence = parse(
    "from text quoted.pyash.su name flags ob ve bool truth lie be vector ya.pyash.quoted from state pyash to state english to name output be translation do"
  );
  const vectorResult = await interpret(vectorSentence);
  assert.equal(vectorResult?.value?.text?.trim(), "flags is vector.");

  const remainsSentence = parse(
    "from text quoted.pyash.ob num 10 from num 3 to name rem be remains do.pyash.quoted from state pyash to state english to name output be translation do"
  );
  const remainsResult = await interpret(remainsSentence);
  assert.equal(remainsResult?.value?.text?.trim(), "remainder of 10 by 3 to rem.");
});
