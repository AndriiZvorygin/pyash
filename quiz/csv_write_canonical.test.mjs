import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";

async function run(line) {
  const s = parse(line);
  return interpret(s);
}

test("csv write emits canonical order using header raw when present", async () => {
  forget();

  await run("su name people be csv map def");
  await run("exists su name header raw ob ve text Name Age ya");
  await run("exists su name header ob ve text name age ya");
  await run("exists su name name ob ve text Ada Turing ya");
  await run("exists su name age ob ve text 36 \"\" ya");
  await run("prah");

  const logs = [];
  const originalLog = console.log;
  // eslint-disable-next-line no-console
  console.log = (...args) => logs.push(args.join(" "));
  try {
    await run("ob name people to state csv be write do");
  } finally {
    // eslint-disable-next-line no-console
    console.log = originalLog;
  }

  assert.equal(logs.length, 1);
  assert.equal(logs[0], "Name,Age\nAda,36\nTuring,\n");
});
