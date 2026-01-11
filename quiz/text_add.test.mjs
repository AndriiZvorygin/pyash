import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, remember } from "../program/remember/index.mjs";

test("plus concatenates text into a named text target", async () => {
  forget();
  await interpret(parse("exists su name greeting ob text hello be text ya"));
  await interpret(parse("ob text world to name greeting be plus do"));
  assert.equal(remember("greeting")?.ob?.text, "helloworld");
});

