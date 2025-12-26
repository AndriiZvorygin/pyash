import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { remember, forget } from "../program/remember/index.mjs";

async function run(line) {
  const s = parse(line);
  return interpret(s);
}

async function runProgram(text) {
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    await run(line);
  }
}

test("json -> pyash -> json roundtrip is canonical", async () => {
  forget();

  const json = JSON.stringify({
    b: 2,
    a: 1,
    tags: [true, false],
    inner: { z: 9, y: 8 }
  });

  await run(`su name profile ob text ${JSON.stringify(json)} from state json to state pyash to name output be compile do`);

  const output = remember("output");
  const quoted = output?.ob?.text ?? "";
  const pyash = quoted
    .replace(/^\s*quoted\.pyash\.\s*/, "")
    .replace(/\s*\.pyash\.quoted\s*$/, "");

  await runProgram(pyash);

  const logs = [];
  const originalLog = console.log;
  // eslint-disable-next-line no-console
  console.log = (...args) => logs.push(args.join(" "));
  try {
    await run("ob name profile to state json be write do");
  } finally {
    // eslint-disable-next-line no-console
    console.log = originalLog;
  }

  assert.deepEqual(logs, ['{"a":1,"b":2,"inner":{"y":8,"z":9},"tags":[true,false]}']);
});
