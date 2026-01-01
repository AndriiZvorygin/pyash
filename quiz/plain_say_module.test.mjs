import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { remember, forget } from "../program/remember/index.mjs";

test("plain say module returns payload into to-name", async () => {
  forget();
  await interpret(parse("from name ./examples/pyash/modules/plain_say.pya ob name say to name plain say be import do"));
  await interpret(parse("ob text \"hello world\" to name text output be plain say do"));
  const fact = remember("output");
  assert.equal(fact?.ob?.text, "hello world");
});
