import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";

test("plain say module returns payload into to-name", async () => {
  await interpret(parse("from name ./examples/pyash/modules/plain_say.pya ob name say to name plain say be import do"));
  await interpret(parse("ob text \"hello\" to name text output be plain say do"));
  const result = await interpret(parse("ob name output be read do"));
  assert.equal(result?.ob?.text, "hello");
});
