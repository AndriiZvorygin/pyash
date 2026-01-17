import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";

async function run(line) {
  const sentence = parse(line);
  return interpret(sentence);
}

test("hear timebox accepts prompt with fixture", async () => {
  forget();
  process.env.PYA_HEAR_FIXTURE = "fixture line";
  try {
    const result = await run("su name record ob text \"Proper nouns: Pyash, Ollama\" during num 1 be hear vyah timebox do");
    assert.equal(result?.value?.text, "fixture line");
  } finally {
    delete process.env.PYA_HEAR_FIXTURE;
  }
});

test("hear stream accepts prompt with fixture", async () => {
  forget();
  process.env.PYA_HEAR_FIXTURE = "first line\nsecond line";
  process.env.PYA_STREAM_STDOUT = "0";
  try {
    const stream = await run("su name H1 ob text \"Prompt\" be hear vyah stream do");
    assert.equal(stream?.be, "stream");

    const chip1 = await run("su name H1 be chip vyah eval do");
    assert.equal(chip1?.be, "chip");
    assert.equal(chip1?.ob?.text, "first line");
  } finally {
    delete process.env.PYA_HEAR_FIXTURE;
    delete process.env.PYA_STREAM_STDOUT;
  }
});

test("hear eval accepts prompt with fixture", async () => {
  forget();
  process.env.PYA_HEAR_FIXTURE = "prompt fixture";
  try {
    const result = await run("su name out ob text \"Prompt\" be hear do");
    assert.equal(result?.value?.text, "prompt fixture");
  } finally {
    delete process.env.PYA_HEAR_FIXTURE;
  }
});
