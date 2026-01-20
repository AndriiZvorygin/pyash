import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";

async function run(line) {
  const s = parse(line);
  return interpret(s);
}

test("json map exports nested schema maps to canonical json", async () => {
  forget();

  await run("su name schema properties path be json map def");
  await run("su name type ob text \"string\" ya");
  await run("prah");

  await run("su name schema properties recursive be json map def");
  await run("su name type ob text \"boolean\" ya");
  await run("prah");

  await run("su name schema properties be json map def");
  await run("su name path ob name schema properties path ya");
  await run("su name recursive ob name schema properties recursive ya");
  await run("prah");

  await run("su name schema be json map def");
  await run("su name type ob text \"object\" ya");
  await run("su name properties ob name schema properties ya");
  await run("su name required ob ve text \"path\" ya");
  await run("prah");

  const logs = [];
  const originalLog = console.log;
  // eslint-disable-next-line no-console
  console.log = (...args) => logs.push(args.join(" "));
  try {
    await run("ob name schema to state json be write do");
  } finally {
    // eslint-disable-next-line no-console
    console.log = originalLog;
  }

  assert.deepEqual(logs, ['{"properties":{"path":{"type":"string"},"recursive":{"type":"boolean"}},"required":["path"],"type":"object"}']);
});
