import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";

test("genitives attach to all cases with multiword nodes", () => {
  const sentence = parse("su name view from text of to of seed stdout to text of to of result stash be say do");
  assert.deepEqual(sentence.su?.name, "view");
  assert.deepEqual(sentence.from?.genitive?.chain, ["seed stdout", "to", "text"]);
  assert.deepEqual(sentence.to?.genitive?.chain, ["result stash", "to", "text"]);
});
