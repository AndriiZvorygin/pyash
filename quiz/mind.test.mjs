import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { allRemember, forget } from "../program/remember/index.mjs";
import motor from "../program/motor/ollama.mjs";

test("mind registration stores engine/model/prompt contexts", async () => {
  forget();

  const sentence = parse(
    'su generator be mind from space "http://localhost:11434" via state "qwen3:8b" via discourse "orchestrator" ya'
  );

  await interpret(sentence);

  const mem = allRemember();
  const fact = mem.find(s => s.subj?.name === "generator");

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
  const sentence = parse('su question obj discourse "Hello" to generator be mind do');

  await interpret(sentence);

  const mem = allRemember();
  const fact = mem.find(s => s.subj?.name === "generator");

  assert.ok(fact);
  assert.equal(fact.be, "mind");
  assert.ok(fact.obj?.text?.includes("MODEL=qwen3:8b"));
  assert.ok(fact.obj?.text?.includes("Hello"));
  assert.ok(fact.obj?.text?.includes("orchestrator"));

  motor.generate = original;
});

test("mind invocation includes recent history in prompt with per-mind window", async () => {
  forget();

  const original = motor.generate;
  let capturedPrompt = "";
  motor.generate = async (model, prompt) => {
    capturedPrompt = prompt;
    return "ok";
  };

  await interpret(
    parse('su generator by num 1 be mind from space "http://localhost:11434" via state "qwen3:8b" via discourse "orchestrator" ya')
  );

  await interpret(parse('be say obj text "Hi" to generator do'));
  await interpret(parse('su question obj discourse "Hello" to generator be mind do'));

  // With window 1, we keep at most 1 user+assistant pair
  assert.match(capturedPrompt, /USER: Hi/);
  assert.match(capturedPrompt, /ASSISTANT:/);
  assert.match(capturedPrompt, /Hello/);

  motor.generate = original;
});
