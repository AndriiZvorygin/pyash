import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { remember, forget } from "../program/remember/index.mjs";

test("map def allows su text keys", async () => {
  forget();
  await interpret(parse("su name pairs be map def"));
  await interpret(parse("su text \"alpha\" ob text \"one\" ya"));
  await interpret(parse("prah"));

  const stored = remember("pairs");
  assert.equal(stored?.be, "map");
  assert.equal(stored?.ob?.map?.alpha?.ob?.text, "one");
});
