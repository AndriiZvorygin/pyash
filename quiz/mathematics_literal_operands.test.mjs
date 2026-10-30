import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, remember } from "../program/remember/index.mjs";

async function run(line) {
  return interpret(parse(line));
}

// The operand order used across the mathematics verbs: the ob operand is the
// left-hand side and the secondary role (from, with, to) is the right-hand
// side. plus, remains, and exponential already follow it.

test("subtract two literal numbers with the from operand", async () => {
  forget();

  await run("ob num 9 from num 4 be subtract do");

  const result = remember("result");
  assert.ok(result, "result fact should be recorded");
  assert.equal(result.ob.num, 5);
});

test("subtract keeps the operand order the other way round", async () => {
  forget();

  await run("ob num 4 from num 9 be subtract do");

  assert.equal(remember("result").ob.num, -5);
});

test("multiply two literal numbers with the with operand", async () => {
  forget();

  await run("ob num 3 with num 4 be multiply do");

  const result = remember("result");
  assert.ok(result, "result fact should be recorded");
  assert.equal(result.ob.num, 12);
});

test("divide two literal numbers with the with operand", async () => {
  forget();

  await run("ob num 8 with num 2 be divide do");

  const result = remember("result");
  assert.ok(result, "result fact should be recorded");
  assert.equal(result.ob.num, 4);
});

test("divide by zero is rejected", async () => {
  forget();

  await assert.rejects(() => run("ob num 8 with num 0 be divide do"), /divide/u);
});

test("exclusive or two literal numbers with the to operand", async () => {
  forget();

  await run("ob num 7 to num 3 be xor do");

  const result = remember("result");
  assert.ok(result, "result fact should be recorded");
  assert.equal(result.ob.num, 4);
});

test("exclusive or of equal numbers is zero", async () => {
  forget();

  await run("ob num 6 to num 6 be xor do");

  assert.equal(remember("result").ob.num, 0);
});
