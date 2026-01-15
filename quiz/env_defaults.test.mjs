import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, remember } from "../program/remember/index.mjs";

async function run(line) {
  const sentence = parse(line);
  return interpret(sentence);
}

test("env defaults populate memory and can be overridden in program", async () => {
  forget();
  const original = process.env.PYA_STREAM_STDOUT;
  process.env.PYA_STREAM_STDOUT = "0";
  try {
    await run("exists su name alpha ob num 1 be number ya");
    const envFact = remember("stream stdout");
    assert.equal(envFact?.ob?.boolean, false);

    await run("exists su name stream stdout ob bool truth be default ya");
    const overrideFact = remember("stream stdout");
    assert.equal(overrideFact?.ob?.boolean, true);
  } finally {
    if (original === undefined) delete process.env.PYA_STREAM_STDOUT;
    else process.env.PYA_STREAM_STDOUT = original;
  }
});
