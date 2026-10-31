import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";

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
    await interpret(parse('exists su name helper be mind via state "qwen3.5:9b" ya'));
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
    await interpret(parse('exists su name helper be mind via state "qwen3.5:9b" ya'));
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

test("scripted session returns its final response as typed text", async () => {
  forget();
  resetMindLogs();
  const original = process.env.PYA_MIND_RESPONSE;
  process.env.PYA_MIND_RESPONSE = "typed final answer";
  try {
    await interpret(parse('exists su name helper be mind via state "qwen3-vl:8b-instruct" ya'));
    const result = await interpret(parse('ob text "Hello" for name helper to name text final be session do'));
    assert.equal(result?.be, "text");
    assert.equal(result?.ob?.text, "typed final answer");
    const mem = allRemember();
    assert.equal(mem.find((sentence) => sentence.su?.name === "final")?.ob?.text, "typed final answer");
  } finally {
    if (original === undefined) delete process.env.PYA_MIND_RESPONSE;
    else process.env.PYA_MIND_RESPONSE = original;
  }
});

test("a session reads the lines that were piped in", async () => {
  // The example runner pipes the scripted lines of a session example into
  // the process, so a session has to read them from its input.
  forget();
  resetMindLogs();
  const original = process.env.PYA_MIND_RESPONSE;
  process.env.PYA_MIND_RESPONSE = "piped answer";
  try {
    await interpret(parse('exists su name helper be mind via state "qwen3.5:9b" ya'));
    await session(parse("for name helper be session do"), {
      stdin: Readable.from(["Hello\n", "/bye\n"])
    });
    const mem = allRemember();
    const answer = mem.find((s) => s.su?.name === "helper answer 1");
    assert.ok(answer);
    assert.equal(answer.ob?.text, "piped answer");
  } finally {
    if (original === undefined) delete process.env.PYA_MIND_RESPONSE;
    else process.env.PYA_MIND_RESPONSE = original;
  }
});

test("a session with no input says that it cannot run", async () => {
  // With no terminal and nothing piped in there is no session to run. The
  // verb has to say so instead of waiting for input that never arrives.
  forget();
  resetMindLogs();
  await assert.rejects(
    () => session(parse("for name helper be session do"), { stdin: Readable.from([]) }),
    /session defective: no interactive input available/
  );
});
