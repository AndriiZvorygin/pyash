import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";

async function run(line) {
  const s = parse(line);
  return interpret(s);
}

test("pyash map write orders entries by official key order", async () => {
  forget();

  const lines = [
    "su name sample be map def",
    "exists su name b ob num 2 be number ya",
    "exists su name a ob num 1 be number ya",
    "exists su name aa ob text \"x\" be text ya",
    "prah"
  ];
  for (const line of lines) {
    await run(line);
  }

  const logs = [];
  const originalLog = console.log;
  // eslint-disable-next-line no-console
  console.log = (...args) => logs.push(args.join(" "));
  try {
    await run("ob name sample be write do");
  } finally {
    // eslint-disable-next-line no-console
    console.log = originalLog;
  }

  const outputLines = logs.join("\n").split("\n").filter(Boolean);
  assert.deepEqual(outputLines, [
    "su name sample be map def",
    "exists su name a ob num 1 be number ya",
    "exists su name aa ob text \"x\" be text ya",
    "exists su name b ob num 2 be number ya",
    "prah"
  ]);
});
