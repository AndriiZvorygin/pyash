import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";

async function run(line) {
  const s = parse(line);
  return interpret(s);
}

test("json map exports pretty JSON via write", async () => {
  forget();

  await run("su name profile be json map def");
  await run('su name name ob text "Ada" ya');
  await run("su name age ob num 36 ya");
  await run("su name alive ob bool truth ya");
  await run("su name note ob hollow ya");
  await run("prah");

  const logs = [];
  const originalLog = console.log;
  // eslint-disable-next-line no-console
  console.log = (...args) => logs.push(args.join(" "));
  try {
    await run("ob name profile to state beautiful json be write do");
  } finally {
    // eslint-disable-next-line no-console
    console.log = originalLog;
  }

  assert.equal(logs.length, 1);
  assert.equal(
    logs[0],
    '{\n  "name": "Ada",\n  "age": 36,\n  "alive": true,\n  "note": null\n}'
  );
});

test("json map allows genitive access by switch", async () => {
  forget();

  await run("su name profile be json map def");
  await run("su name age ob num 36 ya");
  await run("prah");

  const logs = [];
  const originalLog = console.log;
  // eslint-disable-next-line no-console
  console.log = (...args) => logs.push(args.join(" "));
  try {
    await run("ob age of profile be write do");
  } finally {
    // eslint-disable-next-line no-console
    console.log = originalLog;
  }

  assert.deepEqual(logs, ["36"]);
});
