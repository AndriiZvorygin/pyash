import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, remember } from "../program/remember/index.mjs";

test("inline refinery call stores final result to target", async () => {
  forget();

  await interpret(parse("su name demo be refinery def"));
  await interpret(parse('su name step ob text "ok" be write do'));
  await interpret(parse("prah"));

  await interpret(parse('ob text "task" from name demo to name text output be refinery do'));

  const output = remember("output");
  assert.ok(output);
  assert.equal(output.ob?.text, "ok");
});

test("inline refinery call works with from name only", async () => {
  forget();

  await interpret(parse("su name demo be refinery def"));
  await interpret(parse('su name step ob text "ok" be write do'));
  await interpret(parse("prah"));

  await interpret(parse("from name demo be refinery do"));
  const result = remember("result");
  assert.equal(result?.ob?.text, "ok");
});
