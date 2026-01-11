import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";

test("exists is rejected on do sentences", async () => {
  forget();

  const sentence = parse("exists su name alpha ob num 1 be plus do");
  let err;
  try {
    await interpret(sentence);
  } catch (e) {
    err = e;
  }
  assert.ok(err, "expected error for exists on do");
  assert.equal(err?.sentence?.be, "error");
  assert.match(err?.sentence?.ob?.text ?? "", /exists/i);
});
