import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, remember } from "../program/remember/index.mjs";

async function run(line) {
  return interpret(parse(line));
}

test("review loop retries when reviewer last-line score is below threshold", async () => {
  forget();

  await run('exists su name gen count ob num 0 be number ya');
  await run('exists su name rev count ob num 0 be number ya');
  await run('su name gen loop ob text input to name text output be ceremony def');
  await run('ob num 1 to name gen count be plus do');
  await run('ob name gen count from num 1 be equally then ob text "draft1" to name text output be text do');
  await run('ob name gen count from num 2 be equally then ob text "draft2" to name text output be text do');
  await run('su name output ret');
  await run('prah');
  await run('su name review loop test ob text input to name text output be ceremony def');
  await run('ob num 1 to name rev count be plus do');
  await run(`ob name rev count from num 1 be equally then ob text quoted.text.analysis with FAIL word in reasoning
0.7
.text.quoted to name text output be text do`);
  await run('ob name rev count from num 2 be equally then ob text "approved\\n0.9" to name text output be text do');
  await run('su name output ret');
  await run('prah');

  await run('ob text "Task." for name gen loop by name review loop test atleast num 0.8 atmost num 3 to name text result be review loop do');

  const result = remember("result");
  assert.equal(result?.ob?.text, "draft2");
  assert.equal(remember("review loop score")?.ob?.num, 0.9);
});

test("review loop parses verdict from last line only", async () => {
  forget();

  await run('su name gen one ob text input to name text output be ceremony def');
  await run('ob text "single draft" to name text output be text do');
  await run('su name output ret');
  await run('prah');
  await run('su name review one ob text input to name text output be ceremony def');
  await run(`ob text quoted.text.Reasoning says FAIL in discussion but final verdict is pass
PASS
.text.quoted to name text output be text do`);
  await run('su name output ret');
  await run('prah');

  await run('ob text "Task." for name gen one by name review one atleast num 0.8 atmost num 3 to name text result be review loop do');

  assert.equal(remember("result")?.ob?.text, "single draft");
  assert.equal(remember("review loop verdict")?.ob?.text, "PASS");
});

test("review loop supports refinery as generator", async () => {
  forget();

  await run('su name unit gen be refinery def');
  await run('su name draft ob text "from refinery" be text do');
  await run('prah');

  await run('su name reviewer fixed ob text input to name text output be ceremony def');
  await run('ob text "ok\\nPASS" to name text output be plus do');
  await run('su name output ret');
  await run('prah');

  await run('ob text "Task." for name unit gen by name reviewer fixed to name text result be review loop do');

  assert.equal(remember("result")?.ob?.text, "from refinery");
});

test("review loop forwards tools to mind generator", async () => {
  forget();

  await run('exists su name mind response ob text "tool aware draft" be text ya');
  await run('exists su name generator prompter ob text "Generate with tools." be text ya');
  await run('exists su name generator be mind as name "qwen3-vl:8b-instruct" fromtext name generator prompter ya');
  await run('su name reviewer fixed ob text input to name text output be ceremony def');
  await run(`ob text quoted.text.looks good
PASS
.text.quoted to name text output be text do`);
  await run('su name output ret');
  await run('prah');

  await run('ob text "Task." for name generator by name reviewer fixed with wo tools to name text result be review loop do');

  assert.equal(remember("result")?.ob?.text, "tool aware draft");
});
