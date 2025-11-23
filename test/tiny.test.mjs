import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../parser.mjs";
import { interpret } from "../dispatcher.mjs";
import { resetMemory } from "../memory.mjs";

async function run(line) {
  const s = parse(line);
  return interpret(s);
}

test("tiny conditional controls next statement (less-than)", async () => {
  resetMemory();

  await run("subj name collector obj num 3 be number ya");
  await run("obj num 3 be tiny from num 5 then");
  await run("obj num 2 to name collector be add do"); // should run (3 < 5 based on stored collector)

  const res = await run("subj name collector obj what que");
  assert.equal(res, "subj name collector obj num 5 be number ya");

  // now false condition should skip the next line
  resetMemory();
  await run("subj name collector obj num 10 be number ya");
  await run("obj num 10 be tiny from num 5 then"); // 10 < 5 is false
  await run("obj num 2 to name collector be add do"); // should be skipped

  const res2 = await run("subj name collector obj what que");
  assert.equal(res2, "subj name collector obj num 10 be number ya");
});

test("tiny compares against stored subject value when subj provided", async () => {
  resetMemory();

  await run("subj name collector obj num 4 be number ya");
  await run("subj name collector be tiny from num 5 then");
  await run("obj num 1 to name collector be add do"); // should run (collector.num 4 < 5)

  const res = await run("subj name collector obj what que");
  assert.equal(res, "subj name collector obj num 5 be number ya");
});

test("tiny compares subj against another subj value", async () => {
  resetMemory();

  await run("subj name lhs obj num 2 be number ya");
  await run("subj name rhs obj num 5 be number ya");
  await run("subj name lhs be tiny from name rhs then");
  await run("obj num 1 to name lhs be add do"); // should run (2 < 5)

  const res = await run("subj name lhs obj what que");
  assert.equal(res, "subj name lhs obj num 3 be number ya");

  await run("subj name lhs obj num 6 be number ya");
  await run("subj name lhs be tiny from name rhs then");
  await run("obj num 1 to name lhs be add do"); // should skip (6 < 5 false)

  const res2 = await run("subj name lhs obj what que");
  assert.equal(res2, "subj name lhs obj num 6 be number ya");
});

test("giant compares subj against another subj value", async () => {
  resetMemory();

  await run("subj name lhs obj num 7 be number ya");
  await run("subj name rhs obj num 5 be number ya");
  await run("subj name lhs be giant from name rhs then");
  await run("obj num 1 to name lhs be add do"); // should run (7 > 5)

  const res = await run("subj name lhs obj what que");
  assert.equal(res, "subj name lhs obj num 8 be number ya");

  await run("subj name lhs obj num 4 be number ya");
  await run("subj name lhs be giant from name rhs then");
  await run("obj num 1 to name lhs be add do"); // should skip (4 > 5 false)

  const res2 = await run("subj name lhs obj what que");
  assert.equal(res2, "subj name lhs obj num 4 be number ya");
});
