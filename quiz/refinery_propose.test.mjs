import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, remember } from "../program/remember/index.mjs";

async function run(line) {
  return interpret(parse(line));
}

test("refinery halts on propose and emits propose result", async () => {
  forget();
  await run("su name flow be refinery def");
  await run("su name gate ob text \"Approve?\" be command propose");
  await run("su name after ob num 1 be number ya");
  await run("prah");

  await run("from name flow be refinery do");

  const result = remember("result");
  assert.equal(result?.be, "propose");
  assert.equal(result?.ob?.text, "Approve?");
  const after = remember("after");
  assert.equal(after, undefined);
});
