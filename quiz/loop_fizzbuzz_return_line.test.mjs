import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";

test("ceremony can return fizzbuzz line and say outside", async () => {
  forget();

  await interpret(parse("subj name fizzbuzz line obj num 0 to name line be ceremony def"));
  await interpret(parse("exists subj name line obj num 0 be number ya"));
  await interpret(parse("exists subj name rem3 obj num 0 be number ya"));
  await interpret(parse("exists subj name rem5 obj num 0 be number ya"));
  await interpret(parse("subj name line obj num of obj of this be number ya"));
  await interpret(parse("obj num of obj of this from num 3 to name rem3 be remains do"));
  await interpret(parse("obj num of obj of this from num 5 to name rem5 be remains do"));
  await interpret(parse("obj name rem3 be equally from num 0 then obj text Fizz to name line be add do"));
  await interpret(parse("obj name rem5 be equally from num 0 then obj text Buzz to name line be add do"));
  await interpret(parse("subj name line ret"));
  await interpret(parse("subj name fizzbuzz line be ceremony prah"));

  const logs = [];
  const originalLog = console.log;
  // eslint-disable-next-line no-console
  console.log = (...args) => logs.push(args.join(" "));
  try {
    await interpret(parse("obj num 15 to name line be fizzbuzz line do"));
    await interpret(parse("obj name line be say do"));
  } finally {
    // eslint-disable-next-line no-console
    console.log = originalLog;
  }

  assert.deepEqual(logs, ["FizzBuzz"]);
});
