import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";

async function run(line) {
  const s = parse(line);
  return interpret(s);
}

test("json map exports pretty JSON via say", async () => {
  forget();

  await run("subj name profile be json map def");
  await run('subj name name obj text "Ada" ya');
  await run("subj name age obj num 36 ya");
  await run("subj name alive obj bool truth ya");
  await run("subj name note obj hollow ya");
  await run("subj name profile be json map prah");

  const logs = [];
  const originalLog = console.log;
  // eslint-disable-next-line no-console
  console.log = (...args) => logs.push(args.join(" "));
  try {
    await run("obj name profile to state json be write do");
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

  await run("subj name profile be json map def");
  await run("subj name age obj num 36 ya");
  await run("subj name profile be json map prah");

  const logs = [];
  const originalLog = console.log;
  // eslint-disable-next-line no-console
  console.log = (...args) => logs.push(args.join(" "));
  try {
    await run("obj age of profile be write do");
  } finally {
    // eslint-disable-next-line no-console
    console.log = originalLog;
  }

  assert.deepEqual(logs, ["36"]);
});
