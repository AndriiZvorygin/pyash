import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, remember } from "../program/remember/index.mjs";

async function run(line) {
  const s = parse(line);
  return interpret(s);
}

test("multiply two numbers via by and store result", async () => {
  forget();

  await run("obj num 2 by num 3 be multiply do");

  const result = remember("result");
  assert.ok(result, "result fact should be recorded");
  assert.equal(result.obj.num, 6);
});

test("multiply using named operand and target", async () => {
  forget();

  await run("subj name acc obj num 5 be number ya");
  await run("obj name acc by num 2 to name acc be multiply do");

  const acc = remember("acc");
  const result = remember("result");

  assert.equal(acc.obj.num, 10, "target should be updated with product");
  assert.equal(result.obj.num, 10, "result fact should mirror product");
});

test("divide using by for divisor and update target", async () => {
  forget();

  await run("subj name acc obj num 20 be number ya");
  await run("obj name acc by num 4 to name acc be divide do");

  const acc = remember("acc");
  const result = remember("result");

  assert.equal(acc.obj.num, 5, "target should hold quotient");
  assert.equal(result.obj.num, 5, "result fact should mirror quotient");
});

test("divide by zero throws", async () => {
  forget();

  await assert.rejects(() => run("obj num 1 by num 0 be divide do"), /by cannot be zero/);
});
