import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, remember } from "../program/remember/index.mjs";

async function run(line) {
  const s = parse(line);
  return interpret(s);
}

test("invert negates numeric ob and stores result", async () => {
  forget();

  await run("ob num 3 be invert do");

  const result = remember("result");
  assert.ok(result, "result fact should be recorded");
  assert.equal(result.ob.num, -3);
});

test("invert named operand and update target", async () => {
  forget();

  await run("su name var ob num 5 be number ya");
  await run("ob name var to name var be invert do");

  const varFact = remember("var");
  assert.equal(varFact.ob.num, -5);
  assert.equal(remember("result").ob.num, -5);
});

test("exponential computes power with literal base/exponent and target", async () => {
  forget();

  await run("ob num 2 from num 3 to name variable be exponential do");

  const variable = remember("variable");
  const res = remember("result");

  assert.equal(variable.ob.num, 8);
  assert.equal(res.ob.num, 8);
});

test("exponential accepts named base and exponent", async () => {
  forget();

  await run("su name angle ob num 2 be number ya");
  await run("su name power ob num 5 be number ya");
  await run("ob name angle from name power be exponential do");

  const res = remember("result");
  assert.equal(res.ob.num, 32);
});

test("exponential supports eulers_number as base", async () => {
  forget();

  await run("ob name eulers_number from num 2 be exponential do");

  const res = remember("result");
  assert.ok(res.ob.num > 7.38 && res.ob.num < 7.40);
});
