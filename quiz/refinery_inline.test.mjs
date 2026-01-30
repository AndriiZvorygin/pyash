import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, remember } from "../program/remember/index.mjs";

test("inline refinery call stores final result to target", async () => {
  forget();

  await interpret(parse("su name demo refinery be refinery def"));
  await interpret(parse('exists su name step ob la ob text "ok" be write do ko be platform ya'));
  await interpret(parse("prah"));

  await interpret(parse('ob text "task" from name demo refinery to name text output be refinery do'));

  const output = remember("output");
  assert.ok(output);
  assert.equal(output.ob?.text, "ok");
});
