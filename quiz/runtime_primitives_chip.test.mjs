import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { remember, forget } from "../program/remember/index.mjs";

async function run(line) {
  const sentence = parse(line);
  return interpret(sentence);
}

test("chip pulls stream items and marks final", async () => {
  forget();
  await run("su name S3 as name open ob ve text he llo be stream ya");

  const first = await run("su name S3 vyah eval be chip do");
  assert.equal(first?.be, "chip");
  assert.equal(first?.atindex?.num, 0);
  assert.equal(first?.as?.name, "notfinal");
  assert.deepEqual(first?.vyah?.ve?.values, ["eval", "sloh"]);

  const second = await run("su name S3 vyah eval be chip do");
  assert.equal(second?.atindex?.num, 1);
  assert.equal(second?.as?.name, "final");

  const stream = remember("S3");
  assert.equal(stream?.as?.name, "done");

  const third = await run("su name S3 vyah eval be chip do");
  assert.equal(third?.be, "error");
});
