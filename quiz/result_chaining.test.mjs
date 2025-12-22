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

  await run("subj name a obj num 1 be number ya");
  await run("obj num 2 to name a be add do");

  const first = remember("result");
  assert.equal(first?.obj?.num, 3);

  await run("obj num 4 to name result be add do");

  const second = remember("result");
  assert.equal(second?.obj?.num, 7);
});

test("ceremony defs feed result into the next call", async () => {
  forget();

  await run("subj name result obj num 0 be number ya");

  await run("subj name add one to name num target be ceremony def");
  await run("obj num 1 to name result be add do");
  await run("this ret");
  await run("subj name add one be ceremony prah");

  await run("subj name add two to name num target be ceremony def");
  await run("obj num 2 to name result be add do");
  await run("this ret");
  await run("subj name add two be ceremony prah");

  await run("to name result be add one do");
  await run("to name result be add two do");

  const chained = remember("result");
  assert.equal(chained?.obj?.num, 3);
});

test("ret merges onto evoke and writes result fact", async () => {
  forget();

  await run("subj name target obj num 0 be number ya");
  await run("subj name mark to name num target be ceremony def");
  await run("obj num 5 to name target ret");
  await run("subj name mark be ceremony prah");

  await run("to name target be mark do");

  const evoker = [...allRemember()].reverse().find(s => s.be === "mark" && s.mood === "do");
  const result = remember("result");
  const target = remember("target");

  assert.ok(evoker, "evoker should be stored");
  assert.equal(target?.obj?.num, 5, "target should be updated via ret");
  assert.equal(result?.obj?.num, 5, "result fact should reflect ret obj");
});

test("non-numeric ceremonies do not default missing results", async () => {
  forget();

  await run("subj name note obj name text be ceremony def");
  await run("subj name payload obj text hello be text ya");
  await run("obj name payload ret");
  await run("subj name note be ceremony prah");

  await run("subj name message obj name payload be note do");

  const message = remember("message");

  assert.ok(message, "invocation should store message fact");
  assert.equal(message.obj?.text ?? message.obj, "hello");
});
