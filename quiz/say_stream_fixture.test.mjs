import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { remember, forget } from "../program/remember/index.mjs";

async function run(line) {
  const sentence = parse(line);
  return interpret(sentence);
}

test("say stream returns a stream and chips yield text chunks", async () => {
  forget();
  const stream = await run('su name voice ob text "hello world" be say vyah stream do');
  assert.equal(stream?.be, "stream");
  assert.equal(stream?.su?.name, "voice");

  const first = await run("su name voice vyah eval be chip do");
  assert.equal(first?.be, "chip");
  assert.equal(first?.atindex?.num, 0);
  assert.equal(first?.toindex?.num, 1);
  assert.equal(first?.ob?.text, "hello");

  const second = await run("su name voice vyah eval be chip do");
  assert.equal(second?.atindex?.num, 1);
  assert.equal(second?.toindex?.num, 1);
  assert.equal(second?.ob?.text, "world");

  const streamState = remember("voice");
  assert.equal(streamState?.as?.name, "done");
});
