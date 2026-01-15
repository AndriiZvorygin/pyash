import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, remember, allRemember } from "../program/remember/index.mjs";

async function run(line) {
  const s = parse(line);
  return interpret(s);
}

test("result facts chain across evocations", async () => {
  forget();

  await run("exists su name a ob num 1 be number ya");
  await run("ob num 2 to name a be plus do");

  const first = remember("result");
  assert.equal(first?.ob?.num, 3);

  await run("ob num 4 to name result be plus do");

  const second = remember("result");
  assert.equal(second?.ob?.num, 7);
});

test("ceremony defs feed result into the next call", async () => {
  forget();

  await run("exists su name result ob num 0 be number ya");

  await run("su name plus one to name num target be ceremony def");
  await run("ob num 1 to name result be plus do");
  await run("this ret");
  await run("su name plus one be ceremony prah");

  await run("su name plus two to name num target be ceremony def");
  await run("ob num 2 to name result be plus do");
  await run("this ret");
  await run("su name plus two be ceremony prah");

  await run("to name result be plus one do");
  await run("to name result be plus two do");

  const chained = remember("result");
  assert.equal(chained?.ob?.num, 3);
});

test("ret merges onto evoke and writes result fact", async () => {
  forget();

  await run("exists su name target ob num 0 be number ya");
  await run("su name mark to name num target be ceremony def");
  await run("ob num 5 to name target ret");
  await run("su name mark be ceremony prah");

  await run("to name target be mark do");

  const evoker = [...allRemember()].reverse().find(s => s.be === "mark" && s.mood === "do");
  const result = remember("result");
  const target = remember("target");

  assert.ok(evoker, "evoker should be stored");
  assert.equal(target?.ob?.num, 5, "target should be updated via ret");
  assert.equal(result?.ob?.num, 5, "result fact should reflect ret ob");
});

test("non-numeric ceremonies do not default missing results", async () => {
  forget();

  await run("exists su name payload ob text hello be text ya");
  await run("su name note ob name text payload be ceremony def");
  await run("ob name payload ret");
  await run("su name note be ceremony prah");

  await run("su name message ob name payload be note do");

  const message = remember("message");

  assert.ok(message, "invocation should store message fact");
  assert.equal(message.ob?.text ?? message.ob, "hello");
});
