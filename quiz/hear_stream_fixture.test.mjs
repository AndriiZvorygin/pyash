import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";

async function run(line) {
  const sentence = parse(line);
  return interpret(sentence);
}

test("hear stream fixture yields chips in order", async () => {
  forget();
  process.env.PYA_HEAR_FIXTURE = "first line\nsecond line";
  try {
    const stream = await run("su name H1 be hear vyah stream do");
    assert.equal(stream?.be, "stream");

    const chip1 = await run("su name H1 be chip vyah eval do");
    assert.equal(chip1?.be, "chip");
    assert.equal(chip1?.ob?.text, "first line");

    const chip2 = await run("su name H1 be chip vyah eval do");
    assert.equal(chip2?.be, "chip");
    assert.equal(chip2?.ob?.text, "second line");
  } finally {
    delete process.env.PYA_HEAR_FIXTURE;
  }
});
