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

  await run("exists subj name counter obj num 0 be number ya");
  await run("subj name inc fromindex num 0 be ceremony def");
  await run("obj num 1 to name counter be add do");
  await run("subj name inc be ceremony prah");

  await run("fromindex num 1 toindex num 4 be inc do");

  const counter = remember("counter");
  assert.equal(counter.obj.num, 3);
});

test("loop stops when descending fromindex reaches toindex", async () => {
  forget();

  await run("exists subj name counter obj num 0 be number ya");
  await run("subj name inc fromindex num 0 be ceremony def");
  await run("obj num 1 to name counter be add do");
  await run("subj name inc be ceremony prah");

  await run("fromindex num 4 toindex num 1 be inc do");

  const counter = remember("counter");
  assert.equal(counter.obj.num, 3);
});
