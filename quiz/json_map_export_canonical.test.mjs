import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";

async function run(line) {
  const s = parse(line);
  return interpret(s);
}

test("json map exports canonical json with key ordering and omission", async () => {
  forget();

  await run("su name sample be json map def");
  await run("su name b ob num 3 ya");
  await run("su name a ob num 1 ya");
  await run("su name aa ob num 2 ya");
  await run("su name skip ya");
  await run("su name sample be json map prah");

  const logs = [];
  const originalLog = console.log;
  // eslint-disable-next-line no-console
  console.log = (...args) => logs.push(args.join(" "));
  try {
    await run("ob name sample to state json be write do");
  } finally {
    // eslint-disable-next-line no-console
    console.log = originalLog;
  }

  assert.deepEqual(logs, ['{"a":1,"aa":2,"b":3}']);
});
