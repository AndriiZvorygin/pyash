import test from "node:test";
import assert from "node:assert/strict";
import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { remember, forget } from "../program/remember/index.mjs";

test("write sets vector element by index", async () => {
  forget();
  await interpret(parse("exists subj name vec obj ve num 10 20 30 be vector ya"));
  await interpret(parse("obj num 99 to name vec at num 1 be write do"));

  const vec = remember("vec");
  assert.deepEqual(vec?.obj?.ve?.values, [10, 99, 30]);
});

test("write sets text vector element by index", async () => {
  forget();
  await interpret(parse("exists subj name words obj ve text hello world be vector ya"));
  await interpret(parse("obj text alpha to name words at num 1 be write do"));

  const words = remember("words");
  assert.deepEqual(words?.obj?.ve?.values, ["hello", "alpha"]);
});

test("write sets boolean vector element by index", async () => {
  forget();
  await interpret(parse("exists subj name switches obj ve bool truth lie truth be vector ya"));
  await interpret(parse("obj text truth to name switches at num 1 be write do"));

  const switches = remember("switches");
  assert.deepEqual(switches?.obj?.ve?.values, ["truth", "truth", "truth"]);
});
