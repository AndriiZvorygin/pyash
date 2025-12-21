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

test("exponential computes power with literal base/exponent and target", async () => {
  forget();

  await run("obj num 2 from num 3 to name variable be exponential do");

  const variable = remember("variable");
  const res = remember("result");

  assert.equal(variable.obj.num, 8);
  assert.equal(res.obj.num, 8);
});

test("exponential accepts named base and exponent", async () => {
  forget();

  await run("subj name angle obj num 2 be number ya");
  await run("subj name power obj num 5 be number ya");
  await run("obj name angle from name power be exponential do");

  const res = remember("result");
  assert.equal(res.obj.num, 32);
});

test("exponential supports eulers_number as base", async () => {
  forget();

  await run("obj name eulers_number from num 2 be exponential do");

  const res = remember("result");
  assert.ok(res.obj.num > 7.38 && res.obj.num < 7.40);
});
