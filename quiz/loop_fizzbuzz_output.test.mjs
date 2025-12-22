import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";

test("loop ceremony can print fizzbuzz outputs using remains + inline then", async () => {
  forget();

  await interpret(parse("exists subj name handled obj num 0 be number ya"));
  await interpret(parse("exists subj name rem3 obj num 0 be number ya"));
  await interpret(parse("exists subj name rem5 obj num 0 be number ya"));

  await interpret(parse("subj name fizzbuzz step to name num bucket fromindex num 0 toindex num 0 be ceremony def"));
  await interpret(parse("subj name handled obj num 0 be number ya"));
  await interpret(parse("obj this ti fromindex from num 3 to name rem3 be remains do"));
  await interpret(parse("obj this ti fromindex from num 5 to name rem5 be remains do"));
  await interpret(parse("obj name rem3 be equally from num 0 then obj num 1 to name handled be add do"));
  await interpret(parse("obj name rem5 be equally from num 0 then obj num 2 to name handled be add do"));
  await interpret(parse("obj name handled be equally from num 3 then obj text FizzBuzz be say do"));
  await interpret(parse("obj name handled be equally from num 1 then obj text Fizz be say do"));
  await interpret(parse("obj name handled be equally from num 2 then obj text Buzz be say do"));
  await interpret(parse("obj name handled be equally from num 0 then obj this ti fromindex be say do"));
  await interpret(parse("subj name fizzbuzz step be ceremony prah"));

  const logs = [];
  const originalLog = console.log;
  // eslint-disable-next-line no-console
  console.log = (...args) => logs.push(args.join(" "));
  try {
    await interpret(parse("to name outside fromindex num 1 toindex num 16 be fizzbuzz step do"));
  } finally {
    // eslint-disable-next-line no-console
    console.log = originalLog;
  }

  assert.deepEqual(logs, [
    "1",
    "2",
    "Fizz",
    "4",
    "Buzz",
    "Fizz",
    "7",
    "8",
    "Fizz",
    "Buzz",
    "11",
    "Fizz",
    "13",
    "14",
    "FizzBuzz",
  ]);
});

