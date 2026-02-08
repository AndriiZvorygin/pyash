import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, remember } from "../program/remember/index.mjs";

async function run(line) {
  return interpret(parse(line));
}

test("write for refinery target runs refinery and stores output", async () => {
  forget();

  await run("su name unit gen be refinery def");
  await run('su name draft ob text "direct refinery output" be text do');
  await run("prah");
  await run('exists su name unit ref be refinery as name "unit gen" ya');

  await run('ob text "task" for name unit ref to name text output be write do');

  assert.equal(remember("output")?.ob?.text, "direct refinery output");
});

test("review loop can use refinery alias fact as generator", async () => {
  forget();

  await run("su name unit gen be refinery def");
  await run('su name draft ob text "alias refinery output" be text do');
  await run("prah");
  await run('exists su name review gen be refinery as name "unit gen" ya');

  await run('su name reviewer fixed ob text input to name text output be ceremony def');
  await run('ob text "ok\\nPASS" to name text output be plus do');
  await run("su name output ret");
  await run("prah");

  await run('ob text "Task." for name review gen by name reviewer fixed to name text result be review loop do');

  assert.equal(remember("result")?.ob?.text, "alias refinery output");
});
