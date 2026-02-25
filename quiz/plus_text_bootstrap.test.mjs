import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, remember } from "../program/remember/index.mjs";

test("plus keeps text intent and avoids numeric bootstrap for typed text targets", async () => {
  forget();
  await interpret(parse("exists su name section root ob text artifacts/run/sections/paragraph-1 be text ya"));
  await interpret(parse("su name section audio path stage ob name text section root to name text section audio path be plus do"));
  assert.equal(remember("section audio path")?.ob?.text, "artifacts/run/sections/paragraph-1");
});

test("plus still bootstraps numeric targets for numeric additions", async () => {
  forget();
  await interpret(parse("ob num 2 to name counter be plus do"));
  assert.equal(remember("counter")?.ob?.num, 2);
});
