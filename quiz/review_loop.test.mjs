import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, remember } from "../program/remember/index.mjs";

async function run(line) {
  return interpret(parse(line));
}

test("verify loop retries when reviewer last-line score is below threshold", async () => {
  forget();

  await run('exists su name gen count ob num 0 be number ya');
  await run('exists su name rev count ob num 0 be number ya');
  await run('su name gen loop ob text input to name text output be ceremony def');
  await run('ob num 1 to name gen count be plus do');
  await run('ob name gen count from num 1 be equally then ob text "draft1" to name text output be text do');
  await run('ob name gen count from num 2 be equally then ob text "draft2" to name text output be text do');
  await run('su name output ret');
  await run('prah');
  await run('su name verify loop test ob text input to name text output be ceremony def');
  await run('ob num 1 to name rev count be plus do');
  await run(`ob name rev count from num 1 be equally then ob text quoted.text.analysis with FAIL word in reasoning
0.7
.text.quoted to name text output be text do`);
  await run('ob name rev count from num 2 be equally then ob text "approved\\n0.9" to name text output be text do');
  await run('su name output ret');
  await run('prah');

  await run('ob text "Task." for name gen loop by name verify loop test atleast num 0.8 atmost num 3 to name text result be verify loop do');

  const result = remember("result");
  assert.equal(result?.ob?.text, "draft2");
  assert.equal(remember("verify loop score")?.ob?.num, 0.9);
});

test("verify loop parses verdict from last line only", async () => {
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

  await run('ob text "Task." for name gen one by name review one atleast num 0.8 atmost num 3 to name text result be verify loop do');

  assert.equal(remember("result")?.ob?.text, "single draft");
  assert.equal(remember("verify loop verdict")?.ob?.text, "PASS");
});

test("verify loop supports refinery as generator", async () => {
  forget();

  await run('su name unit gen be refinery def');
  await run('su name draft ob text "from refinery" be text do');
  await run('prah');

  await run('su name reviewer fixed ob text input to name text output be ceremony def');
  await run('ob text "ok\\nPASS" to name text output be plus do');
  await run('su name output ret');
  await run('prah');

  await run('ob text "Task." for name unit gen by name reviewer fixed to name text result be verify loop do');

  assert.equal(remember("result")?.ob?.text, "from refinery");
});

test("verify loop forwards tools to mind generator", async () => {
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

  await run('ob text "Task." for name generator by name reviewer fixed with wo tools to name text result be verify loop do');

  assert.equal(remember("result")?.ob?.text, "tool aware draft");
});

test("verify loop stops early when failed draft is unchanged", async () => {
  forget();

  await run('su name stale gen ob text input to name text output be ceremony def');
  await run('ob text "same draft" to name text output be text do');
  await run('su name output ret');
  await run('prah');

  await run('su name strict reviewer ob text input to name text output be ceremony def');
  await run('ob text "needs fixes\\n0.2" to name text output be text do');
  await run('su name output ret');
  await run('prah');

  await run('ob text "Task." for name stale gen by name strict reviewer atleast num 0.8 atmost num 5 to name text result be verify loop do');

  assert.equal(remember("result")?.ob?.text, "same draft");
  assert.equal(remember("verify loop attempts used")?.ob?.num, 2);
  assert.equal(remember("verify loop stop reason")?.ob?.text, "unchanged draft");
  assert.match(String(remember("verify loop summary")?.ob?.text ?? ""), /stop=unchanged draft/);
  const failure = remember("verify loop last failure")?.ob?.map ?? {};
  assert.equal(failure?.attempt?.num, 2);
  assert.equal(failure?.draft?.text, "same draft");
});

test("verify loop guarantee draft regex failure triggers retry and stores success bundle", async () => {
  forget();

  await run('exists su name gen count ob num 0 be number ya');
  await run('su name verify gen ob text input to name text output be ceremony def');
  await run('ob num 1 to name gen count be plus do');
  await run('ob name gen count from num 1 be equally then ob text "draft_missing_token" to name text output be text do');
  await run('ob name gen count from num 2 be equally then ob text "draft_ok_token" to name text output be text do');
  await run('su name output ret');
  await run('prah');

  await run('su name verify loop configure be map def');
  await run('su name guarantee draft regex ob text "draft_ok_token" ya');
  await run('prah');

  await run('ob text "Task." for name verify gen atleast num 0.8 atmost num 3 to name text result be verify loop do');

  assert.equal(remember("result")?.ob?.text, "draft_ok_token");
  assert.equal(remember("verify loop stop reason")?.ob?.text, "pass");
  assert.equal(remember("verify loop verdict")?.ob?.text, "PASS (guarantee)");
  assert.equal(remember("verify loop attempts used")?.ob?.num, 2);
  assert.match(String(remember("verify loop guarantee")?.ob?.text ?? ""), /draft regex=match/);
  const success = remember("verify loop last success")?.ob?.map ?? {};
  assert.equal(success?.attempt?.num, 2);
  assert.equal(success?.draft?.text, "draft_ok_token");
  assert.match(String(success?.guarantee?.text ?? ""), /draft regex=match/);
});

test("verify loop can run with guarantee only and no reviewer", async () => {
  forget();

  await run('exists su name gen count ob num 0 be number ya');
  await run('su name guarantee only gen ob text input to name text output be ceremony def');
  await run('ob num 1 to name gen count be plus do');
  await run('ob name gen count from num 1 be equally then ob text "draft_bad" to name text output be text do');
  await run('ob name gen count from num 2 be equally then ob text "draft_ok" to name text output be text do');
  await run('su name output ret');
  await run('prah');

  await run('su name verify loop configure be map def');
  await run('su name guarantee draft regex ob text "draft_ok" ya');
  await run('prah');

  await run('ob text "Task." for name guarantee only gen atleast num 0.8 atmost num 3 to name text result be verify loop do');

  assert.equal(remember("result")?.ob?.text, "draft_ok");
  assert.equal(remember("verify loop verdict")?.ob?.text, "PASS (guarantee)");
  assert.equal(remember("verify loop attempts used")?.ob?.num, 2);
  assert.equal(remember("verify loop stop reason")?.ob?.text, "pass");
});

test("verify loop guarantee command can gate retries", async () => {
  forget();

  await run('exists su name gen count ob num 0 be number ya');
  await run('su name command guarantee gen ob text input to name text output be ceremony def');
  await run('ob num 1 to name gen count be plus do');
  await run('ob name gen count from num 1 be equally then ob text "draft_fail" to name text output be text do');
  await run('ob name gen count from num 2 be equally then ob text "draft_ok" to name text output be text do');
  await run('su name output ret');
  await run('prah');

  await run('su name verify loop configure be map def');
  await run(`su name guarantee command ob text quoted.text.printf %s {{draft}} | grep -q draft_ok && printf good.text.quoted ya`);
  await run('su name guarantee expect regex ob text "^good$" ya');
  await run('prah');

  await run('ob text "Task." for name command guarantee gen atleast num 0.8 atmost num 3 to name text result be verify loop do');

  assert.equal(remember("result")?.ob?.text, "draft_ok");
  assert.equal(remember("verify loop attempts used")?.ob?.num, 2);
  assert.equal(remember("verify loop verdict")?.ob?.text, "PASS (guarantee)");
  assert.match(String(remember("verify loop guarantee")?.ob?.text ?? ""), /regex=match/);
});

test("verify loop emits deterministic session gold record", async () => {
  forget();

  const worldRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-gold-world-"));
  await run(`exists su name world root ob filename "${worldRoot}" be default ya`);

  await run('su name gold gen ob text input to name text output be ceremony def');
  await run('ob text "final draft" to name text output be text do');
  await run('su name output ret');
  await run('prah');
  await run('su name verify loop configure be map def');
  await run('su name guarantee draft regex ob text "final draft" ya');
  await run('prah');

  await run('ob text "Task." for name gold gen atleast num 0.8 atmost num 2 to name text result be verify loop do');
  const firstFile = String(remember("verify loop gold file")?.ob?.text ?? "");
  const firstKey = String(remember("verify loop gold key")?.ob?.text ?? "");
  assert.equal(remember("verify loop gold label")?.ob?.text, "gold_positive");
  assert.ok(firstFile.includes("/gold/accepted/"));
  assert.ok(firstFile.includes("/house/varied/"));
  assert.ok(firstFile.includes("/gold/accepted/gold gen/"));
  assert.ok(firstKey.length >= 12);

  const firstText = await fs.readFile(firstFile, "utf8");
  assert.match(firstText, /su name gold label ob text "gold_positive"/);

  await run('ob text "Task." for name gold gen atleast num 0.8 atmost num 2 to name text result be verify loop do');
  const secondFile = String(remember("verify loop gold file")?.ob?.text ?? "");
  const secondKey = String(remember("verify loop gold key")?.ob?.text ?? "");
  assert.equal(secondFile, firstFile);
  assert.equal(secondKey, firstKey);
});
