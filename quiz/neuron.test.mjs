import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, remember } from "../program/remember/index.mjs";

async function run(line) {
  const s = parse(line);
  return interpret(s);
}

function closeEnough(actual, expected, tol = 1e-6) {
  return Math.abs(actual - expected) < tol;
}

test("neuron computes dot product + bias + sigmoid", async () => {
  forget();

  await run("su name weights ob vec num 1 2 3 be vector ya");
  await run("su name inputs ob vec num 4 5 6 be vector ya");
  await run("su name bias ob num 0 be number ya");

  await run("from name weights by name inputs fromstate name bias to name output be neuron do");

  const output = remember("output");
  const result = remember("result");

  const expected = 1 / (1 + Math.exp(-32)); // dot(1,2,3 · 4,5,6) = 32
  assert.ok(closeEnough(output.ob.num, expected), "output should be sigmoid(dot + bias)");
  assert.ok(closeEnough(result.ob.num, expected), "result fact should mirror neuron output");
});

test("neuron length mismatch throws", async () => {
  forget();

  await run("su name weights ob vec num 1 2 be vector ya");
  await run("su name inputs ob vec num 1 2 3 be vector ya");
  await run("su name bias ob num 0 be number ya");

  await assert.rejects(
    () => run("from name weights by name inputs fromstate name bias to name output be neuron do"),
    /length mismatch/
  );
});

test("twice crescent activation can be called directly", async () => {
  forget();

  await run("ob num 0 be twice crescent do");
  const res = remember("result");
  assert.ok(closeEnough(res.ob.num, 0.5), "sigmoid(0) should be 0.5");
});

test("neuron throws on non-numeric vectors or missing bias", async () => {
  forget();

  await run("su name weights ob vec letter a b c be vector ya");
  await run("su name inputs ob vec num 1 2 3 be vector ya");
  await run("su name bias ob num 0 be number ya");
  await assert.rejects(
    () => run("from name weights by name inputs fromstate name bias to name output be neuron do"),
    /numeric/
  );

  forget();
  await run("su name weights ob vec num 1 2 3 be vector ya");
  await run("su name inputs ob vec num 1 2 3 be vector ya");
  await assert.rejects(() => run("from name weights by name inputs to name output be neuron do"), /bias is required/);
});
