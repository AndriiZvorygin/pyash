import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";

async function run(line) {
  const s = parse(line);
  return interpret(s);
}

test("equally conditional controls next statement with inline values", async () => {
  forget();

  await run("su name collector ob num 1 be number ya");
  await run("ob num 5 be equally from num 5 then");
  await run("ob num 2 to name collector be plus do"); // should run (5 === 5)

  const res = await run("su name collector ob what que");
  assert.equal(res, "su name collector ob num 3 be number ya");

  forget();
  await run("su name collector ob num 1 be number ya");
  await run("ob num 4 be equally from num 5 then"); // false
  await run("ob num 2 to name collector be plus do"); // should be skipped

  const res2 = await run("su name collector ob what que");
  assert.equal(res2, "su name collector ob num 1 be number ya");
});

test("equally compares su against literal", async () => {
  forget();

  await run("su name collector ob num 4 be number ya");
  await run("su name collector be equally from num 4 then");
  await run("ob num 1 to name collector be plus do"); // should run (collector.num === 4)

  const res = await run("su name collector ob what que");
  assert.equal(res, "su name collector ob num 5 be number ya");
});

test("equally compares su against another su value", async () => {
  forget();

  await run("su name lhs ob num 5 be number ya");
  await run("su name rhs ob num 5 be number ya");
  await run("su name lhs be equally from name rhs then");
  await run("ob num 1 to name lhs be plus do"); // should run (5 === 5)

  const res = await run("su name lhs ob what que");
  assert.equal(res, "su name lhs ob num 6 be number ya");

  await run("su name lhs ob num 6 be number ya");
  await run("su name lhs be equally from name rhs then"); // 6 === 5 false
  await run("ob num 1 to name lhs be plus do"); // should skip

  const res2 = await run("su name lhs ob what que");
  assert.equal(res2, "su name lhs ob num 6 be number ya");
});
