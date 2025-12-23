import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, remember } from "../program/remember/index.mjs";

async function run(line) {
  const s = parse(line);
  return interpret(s);
}

test("subtract number from named target", async () => {
  forget();

  await run("su name collector ob num 10 be number ya");
  await run("ob num 3 from name collector be subtract do");

  const res = remember("collector");
  assert.equal(res.ob.num, 7);

  const resultFact = remember("result");
  assert.equal(resultFact.ob.num, 7);
});

test("subtract using named subtrahend and target via from", async () => {
  forget();

  await run("su name lhs ob num 8 be number ya");
  await run("su name rhs ob num 5 be number ya");
  await run("ob name rhs from name lhs be subtract do");

  const lhs = remember("lhs");
  assert.equal(lhs.ob.num, 3);
  assert.equal(remember("result").ob.num, 3);
});

test("subtract throws when target name is missing", async () => {
  forget();

  await assert.rejects(() => run("ob num 1 be subtract do"), /target name required/);
});
