import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, remember } from "../program/remember/index.mjs";

async function run(line) {
  return interpret(parse(line));
}

test("evoke clause mode executes explicit ob la clause", async () => {
  forget();
  await run('ob la ob text "clause ok" be text do ko to name text out be evoke do');
  assert.equal(remember("out")?.ob?.text, "clause ok");
});

test("evoke clause mode to override wins over embedded to", async () => {
  forget();
  await run('ob la ob text "clause ok" to name text inner be text do ko to name text out be evoke do');
  assert.equal(remember("out")?.ob?.text, "clause ok");
  assert.equal(remember("inner"), undefined);
});

test("evoke clause mode falls back to caller from la", async () => {
  forget();
  await run('su name call clause from la ob text "sample" be text do ko to name text output be ceremony def');
  await run("to name text output be evoke do");
  await run("su name output ret");
  await run("prah");

  await run('su name res from la ob text "fallback ok" be text do ko to name text out be call clause do');
  assert.equal(remember("out")?.ob?.text, "fallback ok");
});

test("evoke clause mode fails without explicit or caller clause", async () => {
  forget();
  await assert.rejects(
    () => run("to name text out be evoke do"),
    /evoke clause defective/
  );
});

test("evoke target mode still dispatches to ceremony by for name", async () => {
  forget();
  await run("su name say hi ob text input to name text output be ceremony def");
  await run('ob text "ceremony ok" to name text output be text do');
  await run("su name output ret");
  await run("prah");
  await run('ob text "task" for name say hi to name text out be evoke do');
  assert.equal(remember("out")?.ob?.text, "ceremony ok");
});
