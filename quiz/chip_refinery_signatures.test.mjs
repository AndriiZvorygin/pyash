import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, remember } from "../program/remember/index.mjs";
import { deriveSignatureFromCall, joinSignatureWords, lookupSignature } from "../program/bridge/signature.mjs";

test("chip refinery module registers text and filename chip signatures", async () => {
  forget();
  await interpret(parse('from filename "./module/chip_refinery.pya" ob name chip to name chip be import do'));

  const calls = [
    'su name demo from text "Questioner: Hello. Answer: Peace." ob text "Create wise chips where each chip contains one full question and its full corresponding answer." to name series chips be chip do',
    'su name demo from filename "quiz/fixtures/ramblings.txt" ob text "Create wise chips where each chip captures one coherent section." to name series chips be chip do'
  ];

  for (const line of calls) {
    const signature = joinSignatureWords(deriveSignatureFromCall(parse(line)));
    const resolved = lookupSignature(signature);
    assert.ok(resolved, `missing signature: ${signature}`);
  }
});

test("chip refinery module keeps adaptive staged flow", async () => {
  const text = await fs.readFile("module/chip_refinery.pya", "utf8");
  assert.match(text, /exists su name chip classifier prompt ob text quoted\.text\.You read CHIP_STYLE_PROMPT and FIRST_GROSS_CHIP\./);
  assert.match(text, /exists su name chip strategy analyzer prompt ob text quoted\.text\.You read CHIP_STYLE_PROMPT and FIRST_GROSS_CHIP\./);
  assert.match(text, /exists su name chip classifier be mind via state "qwen3\.5:9b" fromtext name chip classifier prompt ya/);
  assert.match(text, /exists su name chip strategy analyzer be mind via state "qwen3\.5:9b" fromtext name chip strategy analyzer prompt ya/);
  assert.match(text, /su name chip classify request stage from text of from of this with text of with of this to name text chip classify request be chip classify request do/);
  assert.match(text, /ob name text chip classify request for name chip classifier to name text chip boundary prompt be write do/);
  assert.match(text, /ob name text chip classify request for name chip strategy analyzer to name text chip strategy raw be write do/);
  assert.match(text, /ob name text chip strategy raw atmost num 1 to name text chip strategy be line tail do/);
  assert.match(text, /from text of from of this with text of with of this to name text chip boundary proposals be chip programmatic boundaries do/);
  assert.match(text, /from name chip gross chips by name chip mixed boundary to name text chip boundary proposals be series map do/);
  assert.match(text, /from name chip gross chips by name chip llm boundary to name text chip boundary proposals be series map do/);
  assert.match(text, /node command\/chip_programmatic_boundary\.mjs/);
  assert.match(text, /node command\/chip_programmatic_boundaries\.mjs/);
  assert.match(text, /exists su name chip boundary proposer be mind via state "qwen3\.5:9b" fromtext name chip boundary prompt ya/);
  assert.match(text, /from text of from of this by name text chip boundary proposals to name text output be wise chip do/);
  assert.match(text, /from filename of from of this become wo text to name text chip source be read do/);
  assert.match(text, /exists su name chip be export ya/);
});

test("chip refinery module runs a direct text plus style invocation without recursive overflow", async () => {
  forget();
  process.env.PYA_COMMAND_RESPONSE = JSON.stringify({ response: "Questioner:" });
  try {
    await interpret(parse('from filename "./module/mind_ollama.pya" ob name mind to name ollama command mind be import do'));
    await interpret(parse("exists su name mind backend be default ob name ollama command mind ya"));
    await interpret(parse('from filename "./module/chip_refinery.pya" ob name chip to name chip be import do'));
    await interpret(parse('exists su name source ob text "Questioner: Hello. Ra: Love is the path. Questioner: What is wisdom? Ra: Wisdom balances compassion." be text ya'));
    await interpret(parse('from name text source with text "Create wise chips where each chip contains one full question and its full corresponding answer." to name series chips be chip do'));
    const chips = remember("chips");
    assert.equal(chips?.be, "series");
    assert.ok(Array.isArray(chips?.ob?.series));
  } finally {
    delete process.env.PYA_COMMAND_RESPONSE;
  }
});
