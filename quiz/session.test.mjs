import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { allRemember, forget } from "../program/remember/index.mjs";
import { session } from "../program/verbs/session.mjs";
import { resetMindLogs } from "../program/verbs/mind/mind.mjs";

test("session loops through scripted inputs", async () => {
  forget();
  resetMindLogs();
  const original = process.env.PYA_MIND_RESPONSE;
  process.env.PYA_MIND_RESPONSE = "ok";
  try {
    await interpret(parse('exists su name helper be mind via state "qwen3-vl:8b-instruct" ya'));
    const sentence = parse("for name helper be session do");
    await session(sentence, { inputs: ["Hello", "/bye"] });
    const mem = allRemember();
    const answer = mem.find(s => s.su?.name === "helper answer 1");
    assert.ok(answer);
    assert.equal(answer.ob?.text, "ok");
  } finally {
    if (original === undefined) delete process.env.PYA_MIND_RESPONSE;
    else process.env.PYA_MIND_RESPONSE = original;
  }
});

test("session accepts default tools map with wo tools", async () => {
  forget();
  resetMindLogs();
  const original = process.env.PYA_MIND_RESPONSE;
  process.env.PYA_MIND_RESPONSE = "ok";
  try {
    await interpret(parse('exists su name helper be mind via state "qwen3-vl:8b-instruct" ya'));
    await interpret(parse('ob text "Hello" for name helper with wo tools be session do'));
    const mem = allRemember();
    const answer = mem.find(s => s.su?.name === "helper answer 1");
    assert.ok(answer);
    assert.equal(answer.ob?.text, "ok");
  } finally {
    if (original === undefined) delete process.env.PYA_MIND_RESPONSE;
    else process.env.PYA_MIND_RESPONSE = original;
  }
});
