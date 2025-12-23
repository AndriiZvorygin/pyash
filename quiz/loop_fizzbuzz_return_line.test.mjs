import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";

test("loop ceremony can return fizzbuzz line and write outside", async () => {
  forget();

  await interpret(parse("subj name fizzbuzz line by num 0 to name text line be ceremony def"));
  await interpret(parse("exists subj name line obj text quoted.text..text.quoted be text ya"));
  await interpret(parse("exists subj name rem3 obj num 0 be number ya"));
  await interpret(parse("exists subj name rem5 obj num 0 be number ya"));
  await interpret(parse("obj this by from num 3 to name rem3 be remains do"));
  await interpret(parse("obj this by from num 5 to name rem5 be remains do"));
  await interpret(parse("obj name rem3 be equally from num 0 then obj text Fizz to name line be add do"));
  await interpret(parse("obj name rem5 be equally from num 0 then obj text Buzz to name line be add do"));
  await interpret(parse("obj name line be equally from text quoted.text..text.quoted then obj this by to name line be add do"));
  await interpret(parse("obj name line ret"));
  await interpret(parse("subj name fizzbuzz line be ceremony prah"));

  await interpret(parse("subj name fizzbuzz write fromindex num 0 toindex num 0 be ceremony def"));
  await interpret(parse("exists subj name line obj text quoted.text..text.quoted be text ya"));
  await interpret(parse("by num of fromindex of this to name line be fizzbuzz line do"));
  await interpret(parse("obj name line be write do"));
  await interpret(parse("subj name fizzbuzz write be ceremony prah"));

  const logs = [];
  const originalLog = console.log;
  // eslint-disable-next-line no-console
  console.log = (...args) => logs.push(args.join(" "));
  try {
    await interpret(parse("to name outside fromindex num 1 toindex num 16 be fizzbuzz write do"));
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
