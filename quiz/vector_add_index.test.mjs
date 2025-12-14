import test from "node:test";
import assert from "node:assert/strict";
import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { remember, forget } from "../program/remember/index.mjs";

test("add to vector element by index mutates in place", async () => {
  forget();
  await interpret(parse("exists subj name vec obj ve num 1 2 3 be vector ya"));
  await interpret(parse("obj name vec from num 5 at num 2 be add do"));

  const vec = remember("vec");
  assert.deepEqual(vec?.obj?.ve?.values, [1, 7, 3]);
});

test("add using obj num and from vec at index mutates in place", async () => {
  forget();
  await interpret(parse("exists subj name vec obj ve num 10 20 30 be vector ya"));
  await interpret(parse("obj num 3 from name vec at num 1 be add do"));

  const vec = remember("vec");
  assert.deepEqual(vec?.obj?.ve?.values, [13, 20, 30]);
});

test("subtract obj num from vec at index mutates in place", async () => {
  forget();
  await interpret(parse("exists subj name vec obj ve num 10 20 30 be vector ya"));
  await interpret(parse("obj num 5 from name vec at num 2 be subtract do"));

  const vec = remember("vec");
  assert.deepEqual(vec?.obj?.ve?.values, [10, 15, 30]);
});
