import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, remember } from "../program/remember/index.mjs";

test("vector ya supports fill via by num N (num)", async () => {
  forget();
  await interpret(parse("exists subj name doors obj ve num 0 by num 5 be vector ya"));
  assert.deepEqual(remember("doors")?.obj?.ve?.values, [0, 0, 0, 0, 0]);
});

test("vector ya supports fill via by num N (bool)", async () => {
  forget();
  await interpret(parse("exists subj name switches obj ve bool lie by num 3 be vector ya"));
  assert.deepEqual(remember("switches")?.obj?.ve?.values, ["lie", "lie", "lie"]);
});

