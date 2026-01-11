import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";

test("parse captures vyah modifiers as vector", () => {
  const sentence = parse("ob num 1 vyah cancel sloh be plus do");
  assert.deepEqual(sentence?.vyah?.ve?.values, ["cancel", "sloh"]);
  assert.equal(sentence?.be, "add");
  assert.equal(sentence?.mood, "do");
});
