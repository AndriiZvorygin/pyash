import test from "node:test";
import assert from "node:assert/strict";
import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";

test("say on vector name prints full sentence", async () => {
  forget();

  await interpret(parse("subj name vec obj ve num 1 2 3 be vector ya"));

  const logs = [];
  const originalLog = console.log;
  // eslint-disable-next-line no-console
  console.log = (...args) => logs.push(args.join(" "));
  try {
    await interpret(parse("obj name vec be say do"));
  } finally {
    // eslint-disable-next-line no-console
    console.log = originalLog;
  }

  assert.equal(logs.length, 1);
  assert.equal(logs[0], "subj name vec obj ve num 1 2 3 be vector ya");
});

test("say on vector literal prints vector only", async () => {
  forget();

  await interpret(parse("subj name vec obj ve num 1 2 3 be vector ya"));

  const logs = [];
  const originalLog = console.log;
  // eslint-disable-next-line no-console
  console.log = (...args) => logs.push(args.join(" "));
  try {
    await interpret(parse("obj ve of vec be say do"));
  } finally {
    // eslint-disable-next-line no-console
    console.log = originalLog;
  }

  assert.equal(logs.length, 1);
  assert.equal(logs[0], "ve num 1 2 3");
});
