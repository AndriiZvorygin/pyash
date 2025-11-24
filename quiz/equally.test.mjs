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

  await run("subj name collector obj num 1 be number ya");
  await run("obj num 5 be equally from num 5 then");
  await run("obj num 2 to name collector be add do"); // should run (5 === 5)

  const res = await run("subj name collector obj what que");
  assert.equal(res, "subj name collector obj num 3 be number ya");

  forget();
  await run("subj name collector obj num 1 be number ya");
  await run("obj num 4 be equally from num 5 then"); // false
  await run("obj num 2 to name collector be add do"); // should be skipped

  const res2 = await run("subj name collector obj what que");
  assert.equal(res2, "subj name collector obj num 1 be number ya");
});

test("equally compares subj against literal", async () => {
  forget();

  await run("subj name collector obj num 4 be number ya");
  await run("subj name collector be equally from num 4 then");
  await run("obj num 1 to name collector be add do"); // should run (collector.num === 4)

  const res = await run("subj name collector obj what que");
  assert.equal(res, "subj name collector obj num 5 be number ya");
});

test("equally compares subj against another subj value", async () => {
  forget();

  await run("subj name lhs obj num 5 be number ya");
  await run("subj name rhs obj num 5 be number ya");
  await run("subj name lhs be equally from name rhs then");
  await run("obj num 1 to name lhs be add do"); // should run (5 === 5)

  const res = await run("subj name lhs obj what que");
  assert.equal(res, "subj name lhs obj num 6 be number ya");

  await run("subj name lhs obj num 6 be number ya");
  await run("subj name lhs be equally from name rhs then"); // 6 === 5 false
  await run("obj num 1 to name lhs be add do"); // should skip

  const res2 = await run("subj name lhs obj what que");
  assert.equal(res2, "subj name lhs obj num 6 be number ya");
});
