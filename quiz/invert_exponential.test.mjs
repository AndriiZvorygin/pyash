import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, remember } from "../program/remember/index.mjs";

async function run(line) {
  const s = parse(line);
  return interpret(s);
}

test("invert negates numeric obj and stores result", async () => {
  forget();

  await run("obj num 3 be invert do");

  const result = remember("result");
  assert.ok(result, "result fact should be recorded");
  assert.equal(result.obj.num, -3);
});

test("invert named operand and update target", async () => {
  forget();

  await run("subj name var obj num 5 be number ya");
  await run("obj name var to name var be invert do");

  const varFact = remember("var");
  assert.equal(varFact.obj.num, -5);
  assert.equal(remember("result").obj.num, -5);
});

test("exponential computes e^x with literal and target", async () => {
  forget();

  await run("obj num 1 to name variable be exponential do");

  const variable = remember("variable");
  const res = remember("result");

  const expected = Math.exp(1);
  const precision = 1e-9;
  assert.ok(Math.abs(variable.obj.num - expected) < precision);
  assert.ok(Math.abs(res.obj.num - expected) < precision);
});

test("exponential accepts named operand", async () => {
  forget();

  await run("subj name angle obj num 2 be number ya");
  await run("obj name angle be exponential do");

  const res = remember("result");
  const expected = Math.exp(2);
  assert.ok(Math.abs(res.obj.num - expected) < 1e-9);
});
