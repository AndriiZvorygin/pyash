import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";

async function run(line) {
  const s = parse(line);
  return interpret(s);
}

test("giant conditional controls next statement with inline values", async () => {
  forget();

  await run("su name collector ob num 1 be number ya");
  await run("ob num 7 be giant from num 5 then");
  await run("ob num 2 to name collector be plus do"); // should run (7 > 5)

  const res = await run("su name collector ob what que");
  assert.equal(res, "su name collector ob num 3 be number ya");

  forget();
  await run("su name collector ob num 1 be number ya");
  await run("ob num 2 be giant from num 5 then"); // false
  await run("ob num 2 to name collector be plus do"); // should be skipped

  const res2 = await run("su name collector ob what que");
  assert.equal(res2, "su name collector ob num 1 be number ya");
});

test("giant compares su against literal", async () => {
  forget();

  await run("su name collector ob num 7 be number ya");
  await run("su name collector be giant from num 5 then");
  await run("ob num 2 to name collector be plus do"); // should run (7 > 5)

  const res = await run("su name collector ob what que");
  assert.equal(res, "su name collector ob num 9 be number ya");
});

test("giant compares su against another su value", async () => {
  forget();

  await run("su name lhs ob num 6 be number ya");
  await run("su name rhs ob num 5 be number ya");
  await run("su name lhs be giant from name rhs then");
  await run("ob num 1 to name lhs be plus do"); // should run (6 > 5)

  const res = await run("su name lhs ob what que");
  assert.equal(res, "su name lhs ob num 7 be number ya");

  await run("su name lhs ob num 4 be number ya");
  await run("su name lhs be giant from name rhs then"); // 4 > 5 false
  await run("ob num 1 to name lhs be plus do"); // should skip

  const res2 = await run("su name lhs ob what que");
  assert.equal(res2, "su name lhs ob num 4 be number ya");
});

test("giant errors when su name is unknown", async () => {
  forget();

  await assert.rejects(() => run("su name ghost be giant from num 1 then"), /Unknown su: ghost/);
});

test("giant errors on unknown comparison verb", async () => {
  forget();

  await assert.rejects(() => run("ob num 1 be nonexistent from num 0 then"), /Unknown verb: nonexistent/);
});
