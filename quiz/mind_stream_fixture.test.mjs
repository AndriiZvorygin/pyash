import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { remember, forget } from "../program/remember/index.mjs";

async function run(line) {
  const sentence = parse(line);
  return interpret(sentence);
}

test("mind stream uses config vyah stream and yields chips", async () => {
  forget();
  const original = process.env.PYA_MIND_RESPONSE;
  process.env.PYA_MIND_RESPONSE = "alpha beta gamma";
  try {
    await run("exists su name helper be mind vyah stream ya");
    const stream = await run('su name helper-stream ob text "prompt" to name helper be write do');
    assert.equal(stream?.be, "stream");
    assert.equal(stream?.su?.name, "helper-stream");

    const first = await run("su name helper-stream vyah eval be chip do");
    assert.equal(first?.ob?.text, "alpha");
    assert.equal(first?.atindex?.num, 0);
    assert.equal(first?.toindex?.num, 2);

    const second = await run("su name helper-stream vyah eval be chip do");
    assert.equal(second?.ob?.text, "alpha beta");
    assert.equal(second?.atindex?.num, 1);

    const third = await run("su name helper-stream vyah eval be chip do");
    assert.equal(third?.ob?.text, "alpha beta gamma");
    assert.equal(third?.atindex?.num, 2);
    assert.equal(third?.toindex?.num, 2);

    const streamState = remember("helper-stream");
    assert.equal(streamState?.as?.name, "done");
  } finally {
    if (original === undefined) delete process.env.PYA_MIND_RESPONSE;
    else process.env.PYA_MIND_RESPONSE = original;
  }
});
