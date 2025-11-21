import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../parser.mjs";
import { interpret } from "../dispatcher.mjs";
import { dumpMemory, resetMemory } from "../memory.mjs";
import motor from "../motor/ollama.mjs";

test("mind registration stores engine/model/prompt contexts", async () => {
  resetMemory();

  const sentence = parse(
    'su generator be mind from space "http://localhost:11434" via state "qwen3:8b" via discourse "orchestrator" ya'
  );

  await interpret(sentence);

  const mem = dumpMemory();
  const fact = mem.find(s => s.subj?.name === "generator");

  assert.ok(fact);
  assert.equal(fact.be, "mind");
  assert.equal(fact.from?.context, "space");
  assert.equal(fact.from?.name, "http://localhost:11434");
  assert.deepEqual(fact.via, [
    { context: "state", name: "qwen3:8b" },
    { context: "discourse", name: "orchestrator" }
  ]);
});

test("mind invocation pulls model + prompt from registered mind", async () => {
  resetMemory();

  // Seed stub response
  const original = motor.generate;
  motor.generate = async (model, prompt) => {
    return `MODEL=${model}\nPROMPT=${prompt}`;
  };

  // Register the mind
  await interpret(
    parse('su generator be mind from space "http://localhost:11434" via state "qwen3:8b" via discourse "orchestrator" do')
  );

  // Ask the mind (no model/prompt on the call; should resolve from memory)
  const sentence = parse('su question obj discourse "Hello" to generator be mind do');

  await interpret(sentence);

  const mem = dumpMemory();
  const fact = mem.find(s => s.subj?.name === "question");

  assert.ok(fact);
  assert.equal(fact.be, "mind");
  assert.ok(fact.obj?.text?.includes("MODEL=qwen3:8b"));
  assert.ok(fact.obj?.text?.includes("Hello"));
  assert.ok(fact.obj?.text?.includes("orchestrator"));

  motor.generate = original;
});
