import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";

async function run(line) {
  const s = parse(line);
  return interpret(s);
}

test("tiny conditional controls next statement (less-than)", async () => {
  forget();

  await run("exists su name collector ob num 3 be number ya");
  await run("ob num 3 be tiny from num 5 then");
  await run("ob num 2 to name collector be plus do"); // should run (3 < 5 based on stored collector)

  const res = await run("su name collector ob what que");
  assert.equal(res, "exists su name collector ob num 5 be number ya");

  // now false condition should skip the next line
  forget();
  await run("exists su name collector ob num 10 be number ya");
  await run("ob num 10 be tiny from num 5 then"); // 10 < 5 is false
  await run("ob num 2 to name collector be plus do"); // should be skipped

  const res2 = await run("su name collector ob what que");
  assert.equal(res2, "exists su name collector ob num 10 be number ya");
});

test("tiny compares against stored subject value when su provided", async () => {
  forget();

  await run("exists su name collector ob num 4 be number ya");
  await run("su name collector be tiny from num 5 then");
  await run("ob num 1 to name collector be plus do"); // should run (collector.num 4 < 5)

  const res = await run("su name collector ob what que");
  assert.equal(res, "exists su name collector ob num 5 be number ya");
});

test("tiny compares su against another su value", async () => {
  forget();

  await run("exists su name lhs ob num 2 be number ya");
  await run("exists su name rhs ob num 5 be number ya");
  await run("su name lhs be tiny from name rhs then");
  await run("ob num 1 to name lhs be plus do"); // should run (2 < 5)

  const res = await run("su name lhs ob what que");
  assert.equal(res, "exists su name lhs ob num 3 be number ya");

  await run("exists su name lhs ob num 6 be number ya");
  await run("su name lhs be tiny from name rhs then");
  await run("ob num 1 to name lhs be plus do"); // should skip (6 < 5 false)

  const res2 = await run("su name lhs ob what que");
  assert.equal(res2, "exists su name lhs ob num 6 be number ya");
});

test("giant compares su against another su value", async () => {
  forget();

  await run("exists su name lhs ob num 7 be number ya");
  await run("exists su name rhs ob num 5 be number ya");
  await run("su name lhs be giant from name rhs then");
  await run("ob num 1 to name lhs be plus do"); // should run (7 > 5)

  const res = await run("su name lhs ob what que");
  assert.equal(res, "exists su name lhs ob num 8 be number ya");

  await run("exists su name lhs ob num 4 be number ya");
  await run("su name lhs be giant from name rhs then");
  await run("ob num 1 to name lhs be plus do"); // should skip (4 > 5 false)

  const res2 = await run("su name lhs ob what que");
  assert.equal(res2, "exists su name lhs ob num 4 be number ya");
});
