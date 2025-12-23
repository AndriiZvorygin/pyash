import test from "node:test";
import assert from "node:assert/strict";
import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { remember, forget } from "../program/remember/index.mjs";

test("add to vector element by index mutates in place", async () => {
  forget();
  await interpret(parse("exists su name values ob ve num 1 2 3 be vector ya"));
  await interpret(parse("ob name values from num 5 at num 2 be add do"));

  const vec = remember("values");
  assert.deepEqual(vec?.ob?.ve?.values, [1, 7, 3]);
});

test("add using ob num and from vec at index mutates in place", async () => {
  forget();
  await interpret(parse("exists su name values ob ve num 10 20 30 be vector ya"));
  await interpret(parse("ob num 3 from name values at num 1 be add do"));

  const vec = remember("values");
  assert.deepEqual(vec?.ob?.ve?.values, [13, 20, 30]);
});

test("subtract ob num from vec at index mutates in place", async () => {
  forget();
  await interpret(parse("exists su name values ob ve num 10 20 30 be vector ya"));
  await interpret(parse("ob num 5 from name values at num 2 be subtract do"));

  const vec = remember("values");
  assert.deepEqual(vec?.ob?.ve?.values, [10, 15, 30]);
});
