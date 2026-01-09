import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";

async function run(line) {
  const sentence = parse(line);
  return interpret(sentence);
}

test("write to keyboard sends text", async () => {
  forget();
  process.env.PYA_KEYBOARD_BIN = "true";
  try {
    const result = await run("su name typed ob text \"hello\" to name keyboard be write do");
    assert.equal(result?.be, "write");
    assert.equal(result?.ob?.text, "hello");
  } finally {
    delete process.env.PYA_KEYBOARD_BIN;
  }
});

test("write stream to keyboard consumes hear stream", async () => {
  forget();
  process.env.PYA_KEYBOARD_BIN = "true";
  process.env.PYA_HEAR_FIXTURE = "first line\nsecond line";
  process.env.PYA_STREAM_STDOUT = "0";
  try {
    const stream = await run("su name H1 be hear vyah stream do");
    assert.equal(stream?.be, "stream");

    const result = await run("su name typed from name H1 to name keyboard be write vyah stream do");
    assert.equal(result?.be, "write");
    assert.equal(result?.ob?.text, "first line\nsecond line");
  } finally {
    delete process.env.PYA_KEYBOARD_BIN;
    delete process.env.PYA_HEAR_FIXTURE;
    delete process.env.PYA_STREAM_STDOUT;
  }
});
