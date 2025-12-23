import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";

test("loop ceremony can print fizzbuzz outputs using remains + inline then", async () => {
  forget();

  await interpret(parse("exists su name handled ob num 0 be number ya"));
  await interpret(parse("exists su name rem3 ob num 0 be number ya"));
  await interpret(parse("exists su name rem5 ob num 0 be number ya"));

  await interpret(parse("su name fizzbuzz step to name num bucket fromindex num 0 toindex num 0 be ceremony def"));
  await interpret(parse("su name handled ob num 0 be number ya"));
  await interpret(parse("ob this ti fromindex from num 3 to name rem3 be remains do"));
  await interpret(parse("ob this ti fromindex from num 5 to name rem5 be remains do"));
  await interpret(parse("ob name rem3 be equally from num 0 then ob num 1 to name handled be add do"));
  await interpret(parse("ob name rem5 be equally from num 0 then ob num 2 to name handled be add do"));
  await interpret(parse("ob name handled be equally from num 3 then ob text FizzBuzz be write do"));
  await interpret(parse("ob name handled be equally from num 1 then ob text Fizz be write do"));
  await interpret(parse("ob name handled be equally from num 2 then ob text Buzz be write do"));
  await interpret(parse("ob name handled be equally from num 0 then ob this ti fromindex be write do"));
  await interpret(parse("su name fizzbuzz step be ceremony prah"));

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

