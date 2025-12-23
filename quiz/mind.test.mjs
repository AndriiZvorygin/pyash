import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { allRemember, forget } from "../program/remember/index.mjs";
import motor from "../program/motor/ollama.mjs";
import { resetMindLogs } from "../program/verbs/mind/mind.mjs";

test("mind registration stores engine/model/prompt contexts", async () => {
  forget();

  const sentence = parse(
    'su generator be mind from space "http://localhost:11434" via state "qwen3:8b" via discourse "orchestrator" ya'
  );

  await interpret(sentence);

  const mem = allRemember();
  const fact = mem.find(s => s.su?.name === "generator");

  assert.ok(fact);
  assert.equal(fact.be, "mind");
  assert.equal(fact.from?.name, "http://localhost:11434");
  assert.equal(fact.as?.name, "qwen3:8b");
  assert.equal(fact.accordingto?.name, "orchestrator");
});

test("mind invocation pulls model + prompt from registered mind", async () => {
  forget();

  // Seed stub response
  const original = motor.generate;
  motor.generate = async (model, prompt) => {
    return `MODEL=${model}\nPROMPT=${prompt}`;
  };

  // Register the mind
  await interpret(
    parse('su generator be mind from space "http://localhost:11434" via state "qwen3:8b" via discourse "orchestrator" ya')
  );

  // Ask the mind (no model/prompt on the call; should resolve from memory)
  const sentence = parse('su question ob discourse "Hello" to generator be mind do');

  await interpret(sentence);

  const mem = allRemember();
  const fact = mem.find(s => s.su?.name === "generator");

  assert.ok(fact);
  assert.equal(fact.be, "mind");
  assert.ok(fact.ob?.text?.includes("MODEL=qwen3:8b"));
  assert.ok(fact.ob?.text?.includes("Hello"));
  assert.ok(fact.ob?.text?.includes("orchestrator"));

  motor.generate = original;
});

test("mind invocation includes recent history in prompt with per-mind window", async () => {
  forget();
  resetMindLogs();

  const original = motor.generate;
  let capturedPrompt = "";
  motor.generate = async (model, prompt) => {
    capturedPrompt = prompt;
    return "ok";
  };

  await interpret(
    parse('su generator by num 1 be mind from space "http://localhost:11434" via state "qwen3:8b" via discourse "orchestrator" ya')
  );

  await interpret(parse('be say ob text "Hi" to generator do'));
  await interpret(parse('su question ob discourse "Hello" to generator be mind do'));

  // With window 1, we keep at most 1 user+assistant pair
  assert.match(capturedPrompt, /USER: Hi/);
  assert.match(capturedPrompt, /ASSISTANT:/);
  assert.match(capturedPrompt, /Hello/);

  motor.generate = original;
});

test("mind history is isolated by fromtext bucket", async () => {
  forget();
  resetMindLogs();

  const original = motor.generate;
  let capturedPromptA = "";
  let capturedPromptB = "";
  motor.generate = async (model, prompt) => {
    if (prompt.includes("Hello A")) capturedPromptA = prompt;
    if (prompt.includes("Hello B")) capturedPromptB = prompt;
    return "ok";
  };

  // Mind A with custom bucket
  await interpret(
    parse('su helperA from text bucketA be mind via state "qwen3:8b" ya')
  );
  // Mind B with different bucket
  await interpret(
    parse('su helperB from text bucketB be mind via state "qwen3:8b" ya')
  );

  await interpret(parse('be say ob text "Hi A" to helperA do'));
  await interpret(parse('be say ob text "Hi B" to helperB do'));

  await interpret(parse('su q ob discourse "Hello A" to helperA be mind do'));
  await interpret(parse('su q ob discourse "Hello B" to helperB be mind do'));

  motor.generate = original;

  assert.match(capturedPromptA, /Hi A/);
  assert.doesNotMatch(capturedPromptA, /Hi B/);
  assert.match(capturedPromptB, /Hi B/);
  assert.doesNotMatch(capturedPromptB, /Hi A/);
});

test("mind history defaults to `<name> story` bucket when fromtext absent", async () => {
  forget();
  resetMindLogs();

  const original = motor.generate;
  let capturedPrompt = "";
  motor.generate = async (model, prompt) => {
    capturedPrompt = prompt;
    return "ok";
  };

  await interpret(parse('su helper be mind via state "qwen3:8b" ya'));
  await interpret(parse('be say ob text "Ping" to helper do'));
  await interpret(parse('su q ob discourse "Hello" to helper be mind do'));

  motor.generate = original;

  assert.match(capturedPrompt, /Ping/, "default bucket should contain earlier say");
});

test.todo("mind call can override bucket with fromtext on invocation (pending signature/case support)");
