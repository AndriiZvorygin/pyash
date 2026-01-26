import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";

test("parser falls back to translation pairs", () => {
  const sentence = parse("collector is number 5.");
  assert.equal(sentence?.be, "number");
  assert.equal(sentence?.su?.name, "collector");
  assert.equal(sentence?.ob?.num, 5);
});
