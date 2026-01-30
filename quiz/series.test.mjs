import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, remember } from "../program/remember/index.mjs";

async function run(line) {
  return interpret(parse(line));
}

test("series def stores ordered sentences", async () => {
  forget();

  await run("su name session be series def");
  await run("su name user ob text \"hi\" be text ya");
  await run("su name assistant ob text \"hello\" be text ya");
  await run("prah");

  const session = remember("session");
  assert.ok(session);
  assert.equal(session.be, "series");
  assert.ok(Array.isArray(session.ob?.series));
  assert.equal(session.ob.series.length, 2);
  assert.equal(session.ob.series[0]?.su?.name, "user");
  assert.equal(session.ob.series[1]?.su?.name, "assistant");
});
