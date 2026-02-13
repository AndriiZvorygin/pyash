import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";

test("parse captures vyah modifiers as vector", () => {
  const sentence = parse("ob num 1 vyah cancel success be plus do");
  assert.deepEqual(sentence?.vyah?.ve?.values, ["cancel", "success"]);
  assert.equal(sentence?.be, "plus");
  assert.equal(sentence?.mood, "do");
});
