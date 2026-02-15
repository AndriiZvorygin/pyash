import test from "node:test";
import assert from "node:assert/strict";
import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";

async function run(line) {
  const sentence = parse(line);
  return interpret(sentence);
}

test("mind uses backend module response when configured", async () => {
  forget();
  process.env.PYA_COMMAND_RESPONSE = "{\"response\":\"module ok\"}";

  try {
    await run('from filename "./module/mind_ollama.pya" ob name mind to name ollama command mind be import do');
    await run("exists su name mind backend be default ob name ollama command mind ya");
    await run("exists su name mind be mind ya");

    const res = await run('su name prompt ob text "Hello" for name mind to name text out be write do');
    assert.equal(res?.ob?.text, "module ok");
  } finally {
    delete process.env.PYA_COMMAND_RESPONSE;
    forget();
  }
});

test("openai-style mind backend module exposes configured signature", async () => {
  forget();
  process.env.PYA_COMMAND_RESPONSE = "{\"response\":\"openai module ok\"}";

  try {
    await run('from filename "./module/mind_openai.pya" ob name openai command mind be import do');
    await run("exists su name mind backend be default ob name openai command mind ya");
    await run("exists su name mind be mind ya");

    const res = await run('su name prompt ob text "Hello" for name mind to name text out be write do');
    assert.equal(res?.ob?.text, "openai module ok");
  } finally {
    delete process.env.PYA_COMMAND_RESPONSE;
    forget();
  }
});
