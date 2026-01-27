import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, remember } from "../program/remember/index.mjs";

async function run(line) {
  return interpret(parse(line));
}

test("loop exits early when ceremony returns fromindex == toindex", async () => {
  forget();

  await run("exists su name counter ob num 0 be number ya");
  await run("su name stop early fromindex num 0 toindex num 0 be ceremony def");
  await run("ob num 1 to name counter be plus do");
  await run("exists su name index ob num 0 be number ya");
  await run("ob num of fromindex of this to name index be plus do");
  await run("su name index be equally from num 2 then this fromindex num of toindex of this ret");
  await run("su name stop early be ceremony prah");

  await run("fromindex num 1 toindex num 5 be stop early do");

  const counter = remember("counter");
  assert.equal(counter.ob.num, 2);
});
