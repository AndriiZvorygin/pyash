import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, remember } from "../program/remember/index.mjs";

test("vector ya supports fill via by num N (num)", async () => {
  forget();
  await interpret(parse("exists su name doors ob ve num 0 by num 5 be vector ya"));
  assert.deepEqual(remember("doors")?.ob?.ve?.values, [0, 0, 0, 0, 0]);
});

test("vector ya supports fill via by num N (bool)", async () => {
  forget();
  await interpret(parse("exists su name switches ob ve bool lie by num 3 be vector ya"));
  assert.deepEqual(remember("switches")?.ob?.ve?.values, ["lie", "lie", "lie"]);
});

test("vector ya supports fill via by name N (num)", async () => {
  forget();
  await interpret(parse("exists su name n ob num 4 be number ya"));
  await interpret(parse("exists su name doors ob ve num 0 by name n be vector ya"));
  assert.deepEqual(remember("doors")?.ob?.ve?.values, [0, 0, 0, 0]);
});

test("vector ya supports fill via by genitive (num of ob of n)", async () => {
  forget();
  await interpret(parse("exists su name n ob num 3 be number ya"));
  await interpret(parse("exists su name doors ob ve num 9 by num of ob of n be vector ya"));
  assert.deepEqual(remember("doors")?.ob?.ve?.values, [9, 9, 9]);
});
