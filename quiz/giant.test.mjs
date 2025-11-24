import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/parser/index.mjs";
import { interpret } from "../program/dispatcher/index.mjs";
import { resetMemory } from "../program/memory/index.mjs";

async function run(line) {
  const s = parse(line);
  return interpret(s);
}

test("giant conditional controls next statement with inline values", async () => {
  resetMemory();

  await run("subj name collector obj num 1 be number ya");
  await run("obj num 7 be giant from num 5 then");
  await run("obj num 2 to name collector be add do"); // should run (7 > 5)

  const res = await run("subj name collector obj what que");
  assert.equal(res, "subj name collector obj num 3 be number ya");

  resetMemory();
  await run("subj name collector obj num 1 be number ya");
  await run("obj num 2 be giant from num 5 then"); // false
  await run("obj num 2 to name collector be add do"); // should be skipped

  const res2 = await run("subj name collector obj what que");
  assert.equal(res2, "subj name collector obj num 1 be number ya");
});

test("giant compares subj against literal", async () => {
  resetMemory();

  await run("subj name collector obj num 7 be number ya");
  await run("subj name collector be giant from num 5 then");
  await run("obj num 2 to name collector be add do"); // should run (7 > 5)

  const res = await run("subj name collector obj what que");
  assert.equal(res, "subj name collector obj num 9 be number ya");
});

test("giant compares subj against another subj value", async () => {
  resetMemory();

  await run("subj name lhs obj num 6 be number ya");
  await run("subj name rhs obj num 5 be number ya");
  await run("subj name lhs be giant from name rhs then");
  await run("obj num 1 to name lhs be add do"); // should run (6 > 5)

  const res = await run("subj name lhs obj what que");
  assert.equal(res, "subj name lhs obj num 7 be number ya");

  await run("subj name lhs obj num 4 be number ya");
  await run("subj name lhs be giant from name rhs then"); // 4 > 5 false
  await run("obj num 1 to name lhs be add do"); // should skip

  const res2 = await run("subj name lhs obj what que");
  assert.equal(res2, "subj name lhs obj num 4 be number ya");
});
