import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, remember } from "../program/remember/index.mjs";

async function run(line) {
  const sentence = parse(line);
  return interpret(sentence);
}

test("hear timebox fixture returns transcript", async () => {
  forget();
  process.env.PYA_HEAR_FIXTURE = "Timed transcript.";
  try {
    await run("su name H2 during num 10000 be hear vyah timebox do");
    const fact = remember("H2");
    assert.equal(fact?.be, "hear");
    assert.equal(fact?.ob?.text, "Timed transcript.");
  } finally {
    delete process.env.PYA_HEAR_FIXTURE;
  }
});
