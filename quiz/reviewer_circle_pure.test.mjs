import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, remember } from "../program/remember/index.mjs";

async function run(line) {
  return interpret(parse(line));
}

async function setupRetryFixtures() {
  await run("exists su name mind response ob text quoted.text.approved\nPASS\n.text.quoted be text ya");
  await run('exists su name author be mind as name "qwen3-vl:8b-instruct" fromtext text "draft" ya');
  await run('exists su name reviewer be mind as name "qwen3-vl:8b-instruct" fromtext text "review" ya');
}

async function setupScoreRetryCeremonies() {
  await run('exists su name mind response ob text "analysis\\n0.9" be text ya');
  await run('exists su name author be mind as name "qwen3-vl:8b-instruct" fromtext text "draft" ya');
  await run('exists su name reviewer be mind as name "qwen3-vl:8b-instruct" fromtext text "review" ya');
}

async function setupLastLineCeremonies() {
  await run(`exists su name mind response ob text quoted.text.Reasoning says FAIL in discussion but final verdict is pass
PASS
.text.quoted be text ya`);
  await run('exists su name author be mind as name "qwen3-vl:8b-instruct" fromtext text "draft" ya');
  await run('exists su name reviewer be mind as name "qwen3-vl:8b-instruct" fromtext text "review" ya');
}

test("pure reviewer module matches builtin output shape", async () => {
  forget();
  await setupRetryFixtures();
  await run('from name ./module/reviewer_circle.pya to name reviewer circle module be import do');
  await run('exists su name pure task ob text "Task." be text ya');

  await run('ob name text pure task for name text author by name text reviewer atleast num 0.8 atmost num 3 to name text pure result be reviewer circle module reviewer trying do');
  const pureResult = remember("pure result")?.ob?.text;

  forget();
  await setupRetryFixtures();
  await run('ob text "Task." for name author by name reviewer atleast num 0.8 atmost num 3 to name text builtin result be verify loop do');
  const builtinResult = remember("builtin result")?.ob?.text;

  assert.match(pureResult ?? "", /PASS/);
  assert.equal(pureResult, builtinResult);
});

test("pure reviewer module can return map produce via genitives", async () => {
  forget();
  await setupRetryFixtures();
  await run('from name ./module/reviewer_circle.pya to name reviewer circle module be import do');
  await run('exists su name pure task ob text "Task." be text ya');

  await run('ob name text pure task for name text author by name text reviewer atleast num 0.8 atmost num 3 to name map produce be reviewer circle module reviewer trying do');
  const produce = remember("produce");
  const result = produce?.ob?.map?.result?.text ?? produce?.ob?.map?.result?.ob?.text ?? "";
  const decision = produce?.ob?.map?.decision?.text ?? produce?.ob?.map?.decision?.ob?.text ?? "";

  assert.match(result, /PASS/);
  assert.equal(decision, "PASS");
});

test("pure reviewer matches builtin score parsing behavior", async () => {
  forget();
  await run('from name ./module/reviewer_circle.pya to name reviewer circle module be import do');
  await setupScoreRetryCeremonies();
  await run('exists su name pure score task ob text "Task." be text ya');

  await run('ob name text pure score task for name text author by name text reviewer atleast num 0.95 atmost num 1 to name map produce be reviewer circle module reviewer trying do');
  const pureProduce = remember("produce");
  const pureResult = pureProduce?.ob?.map?.result?.text ?? pureProduce?.ob?.map?.result?.ob?.text ?? "";
  const pureDecision = pureProduce?.ob?.map?.decision?.text ?? pureProduce?.ob?.map?.decision?.ob?.text ?? "";

  forget();
  await setupScoreRetryCeremonies();
  await run('ob text "Task." for name author by name reviewer atleast num 0.95 atmost num 1 to name text builtin result be verify loop do');
  const builtinResult = remember("builtin result")?.ob?.text;
  const builtinScore = remember("verify loop score")?.ob?.num;

  assert.equal(pureResult, builtinResult);
  assert.match(pureResult ?? "", /0\.9/);
  assert.equal(pureDecision, "FAIL");
  assert.equal(builtinScore, 0.9);
});

test("pure reviewer matches builtin last-line-only verdict behavior", async () => {
  forget();
  await run('from name ./module/reviewer_circle.pya to name reviewer circle module be import do');
  await setupLastLineCeremonies();
  await run('exists su name pure line task ob text "Task." be text ya');

  await run('ob name text pure line task for name text author by name text reviewer atleast num 0.8 atmost num 3 to name map produce be reviewer circle module reviewer trying do');
  const pureProduce = remember("produce");
  const pureResult = pureProduce?.ob?.map?.result?.text ?? pureProduce?.ob?.map?.result?.ob?.text ?? "";
  const pureDecision = pureProduce?.ob?.map?.decision?.text ?? pureProduce?.ob?.map?.decision?.ob?.text ?? "";

  forget();
  await setupLastLineCeremonies();
  await run('ob text "Task." for name author by name reviewer atleast num 0.8 atmost num 3 to name text builtin result be verify loop do');
  const builtinResult = remember("builtin result")?.ob?.text;
  const builtinVerdict = remember("verify loop verdict")?.ob?.text;

  assert.equal(pureResult, builtinResult);
  assert.match(pureResult ?? "", /PASS/);
  assert.equal(pureDecision, "PASS");
  assert.equal(builtinVerdict, "PASS");
});
