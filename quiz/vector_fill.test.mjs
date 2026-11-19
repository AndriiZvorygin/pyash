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

test("vector ya zero-fills a typed float prefix to its declared width", async () => {
  forget();
  await interpret(parse("exists su name weights ob ve float32 1.0 1.2 1.3 by num 16 be vector ya"));
  const values = remember("weights")?.ob?.ve?.values;
  assert.deepEqual(values?.slice(0, 3), [1, 1.2, 1.3]);
  assert.deepEqual(values?.slice(3), Array(13).fill(0));
});

test("vector ya initializes a typed vector with no explicit values to zero", async () => {
  forget();
  await interpret(parse("exists su name weights ob ve float32 by num 16 be vector ya"));
  assert.deepEqual(remember("weights")?.ob?.ve?.values, Array(16).fill(0));
});

test("general Pyash text vectors remain variable-length arrays beyond hardware width", async () => {
  forget();
  const values = Array.from({ length: 20 }, (_, index) => `text-${index}`);
  await interpret({
    exists: true,
    mood: "ya",
    su: { name: "labels" },
    ob: { ve: { type: "text", values } },
    be: "vector"
  });
  assert.deepEqual(remember("labels")?.ob?.ve?.values, values);
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
