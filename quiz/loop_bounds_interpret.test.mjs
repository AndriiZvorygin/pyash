import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, remember } from "../program/remember/index.mjs";

async function run(line) {
  return interpret(parse(line));
}

test("loop stops when ascending fromindex reaches toindex", async () => {
  forget();

  await run("exists su name counter ob num 0 be number ya");
  await run("su name inc fromindex num 0 be ceremony def");
  await run("ob num 1 to name counter be plus do");
  await run("su name inc be ceremony prah");

  await run("fromindex num 1 toindex num 4 be inc do");

  const counter = remember("counter");
  assert.equal(counter.ob.num, 3);
});

test("loop stops when descending fromindex reaches toindex", async () => {
  forget();

  await run("exists su name counter ob num 0 be number ya");
  await run("su name inc fromindex num 0 be ceremony def");
  await run("ob num 1 to name counter be plus do");
  await run("su name inc be ceremony prah");

  await run("fromindex num 4 toindex num 1 be inc do");

  const counter = remember("counter");
  assert.equal(counter.ob.num, 3);
});
