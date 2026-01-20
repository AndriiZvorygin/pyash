import test from "node:test";
import assert from "node:assert/strict";
import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, remember } from "../program/remember/index.mjs";

async function run(line) {
  const sentence = parse(line);
  return interpret(sentence);
}

test("mind module exposes discharge", async () => {
  forget();
  process.env.PYA_COMMAND_RESPONSE = "{}";
  try {
    await run('from filename "./module/mind_ollama.pya" ob name mind to name ollama command mind be import do');
    await run('ob text "qwen3-vl:8b-instruct" to name text out be mind ollama discharge do');
    const out = remember("out");
    assert.equal(out?.ob?.text, "ollama mind discharged");
  } finally {
    delete process.env.PYA_COMMAND_RESPONSE;
    forget();
  }
});

test("mind module exposes begin and restart", async () => {
  forget();
  process.env.PYA_COMMAND_RESPONSE = "{}";
  try {
    await run('from filename "./module/mind_ollama.pya" ob name mind to name ollama command mind be import do');
    await run('ob text "qwen3-vl:8b-instruct" to name text begin-out be mind ollama begin do');
    const beginOut = remember("begin-out");
    assert.equal(beginOut?.ob?.text, "ollama mind begun");

    await run('ob text "qwen3-vl:8b-instruct" to name text restart-out be mind ollama restart do');
    const restartOut = remember("restart-out");
    assert.equal(restartOut?.ob?.text, "ollama mind restarted");
  } finally {
    delete process.env.PYA_COMMAND_RESPONSE;
    forget();
  }
});
