import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, remember } from "../program/remember/index.mjs";

async function run(line) {
  return interpret(parse(line));
}

test("evoke dispatches to ceremony target", async () => {
  forget();
  await run("su name say hi ob text input to name text output be ceremony def");
  await run('ob text "ceremony ok" to name text output be text do');
  await run("su name output ret");
  await run("prah");
  await run('ob text "task" for name say hi to name text out be evoke do');
  assert.equal(remember("out")?.ob?.text, "ceremony ok");
});

test("evoke dispatches to refinery alias target", async () => {
  forget();
  await run("su name unit refinery be refinery def");
  await run('su name stage ob text "refinery ok" be text do');
  await run("prah");
  await run('exists su name helper refinery be refinery as name "unit refinery" ya');
  await run('ob text "task" for name helper refinery to name text out be evoke do');
  assert.equal(remember("out")?.ob?.text, "refinery ok");
});

test("evoke dispatches to mind target", async () => {
  forget();
  await run('exists su name mind response ob text "mind ok" be text ya');
  await run('exists su name helper mind be mind as name "qwen3-vl:8b-instruct" ya');
  await run('ob text "task" for name helper mind to name text out be evoke do');
  assert.equal(remember("out")?.ob?.text, "mind ok");
});
