import test from "node:test";
import assert from "node:assert/strict";
import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { remember, forget } from "../program/remember/index.mjs";

test("write sets vector element by index", async () => {
  forget();
  await interpret(parse("exists su name values ob ve num 10 20 30 be vector ya"));
  await interpret(parse("ob num 99 to name values at num 1 be write do"));

  const vec = remember("values");
  assert.deepEqual(vec?.ob?.ve?.values, [10, 99, 30]);
});

test("write sets text vector element by index", async () => {
  forget();
  await interpret(parse("exists su name words ob ve text hello world be vector ya"));
  await interpret(parse("ob text alpha to name words at num 1 be write do"));

  const words = remember("words");
  assert.deepEqual(words?.ob?.ve?.values, ["hello", "alpha"]);
});

test("write sets boolean vector element by index", async () => {
  forget();
  await interpret(parse("exists su name switches ob ve bool truth lie truth be vector ya"));
  await interpret(parse("ob text truth to name switches at num 1 be write do"));

  const switches = remember("switches");
  assert.deepEqual(switches?.ob?.ve?.values, ["truth", "truth", "truth"]);
});
