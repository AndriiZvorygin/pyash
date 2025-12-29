import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { remember, forget } from "../program/remember/index.mjs";

async function run(line) {
  const sentence = parse(line);
  return interpret(sentence);
}

test("cancel updates duty state and returns sloh", async () => {
  forget();
  await run("su name L7 as name running be duty ya");

  const res = await run("su name L7 vyah cancel be hear do");
  assert.equal(res?.be, "hear");
  assert.deepEqual(res?.vyah?.ve?.values, ["cancel", "sloh"]);

  const duty = remember("L7");
  assert.equal(duty?.as?.name, "abandoned");
});

test("finish updates stream state and returns sloh", async () => {
  forget();
  await run("su name S3 as name open ob ve text he llo be stream ya");

  const res = await run("su name S3 vyah finish be hear do");
  assert.equal(res?.be, "hear");
  assert.deepEqual(res?.vyah?.ve?.values, ["finish", "sloh"]);

  const stream = remember("S3");
  assert.equal(stream?.as?.name, "done");
});

test("await succeeds only when duty is done", async () => {
  forget();
  await run("su name L9 as name done be duty ya");

  const res = await run("su name L9 vyah await be hear do");
  assert.equal(res?.be, "hear");
  assert.deepEqual(res?.vyah?.ve?.values, ["await", "sloh"]);
});
