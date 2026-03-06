import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, remember } from "../program/remember/index.mjs";
import { deriveSignatureFromCall, joinSignatureWords, lookupSignature } from "../program/bridge/signature.mjs";

async function run(line) {
  return interpret(parse(line));
}

async function setupGenerator() {
  await run('exists su name draft count ob num 0 be number ya');
  await run("su name draft gen ob text input to name text output be ceremony def");
  await run("ob num 1 to name draft count be plus do");
  await run('ob name draft count from num 1 be equally then ob text "draft1" to name text output be text do');
  await run('ob name draft count from num 2 be equally then ob text "draft2" to name text output be text do');
  await run('ob name draft count from num 3 be equally then ob text "draft3" to name text output be text do');
  await run('ob name draft count from num 4 be equally then ob text "draft4" to name text output be text do');
  await run('ob name draft count from num 5 be equally then ob text "draft5" to name text output be text do');
  await run('ob name draft count from num 6 be equally then ob text "draft6" to name text output be text do');
  await run("su name output ret");
  await run("prah");
}

async function setupMindFixture() {
  await run("exists su name provider auto discharge ob bool lie ya");
  await run('exists su name mind be mind as name "qwen3-vl:8b-instruct" ya');
}

test("better compare module registers clause-based signature", async () => {
  forget();
  await run('from filename "./module/better_compare.pya" to name better compare be import do');

  const line = 'su name run from la ob text "task" to name text scratch be draft gen do ko ob text "pick better" to name text winner atmost num 6 be better compare do';
  const signature = joinSignatureWords(deriveSignatureFromCall(parse(line)));
  const resolved = lookupSignature(signature);
  assert.ok(resolved, `missing signature: ${signature}`);
  assert.ok(String(resolved).endsWith("better compare"), `unexpected target: ${resolved}`);
});

test("better compare returns incumbent after two A wins", async () => {
  const original = process.env.PYA_MIND_RESPONSE;
  process.env.PYA_MIND_RESPONSE = "A";
  try {
    forget();
    await setupMindFixture();
    await run('from filename "./module/better_compare.pya" to name better compare be import do');
    await setupGenerator();

    await run('su name run from la ob text "task" to name text scratch be draft gen do ko ob text "pick better" to name text winner atmost num 6 be better compare do');

    assert.equal(remember("winner")?.ob?.text, "draft1");
    assert.equal(remember("draft count")?.ob?.num, 2);
  } finally {
    if (original === undefined) delete process.env.PYA_MIND_RESPONSE;
    else process.env.PYA_MIND_RESPONSE = original;
  }
});

test("better compare promotes B and continues until cap", async () => {
  const original = process.env.PYA_MIND_RESPONSE;
  process.env.PYA_MIND_RESPONSE = "B";
  try {
    forget();
    await setupMindFixture();
    await run('from filename "./module/better_compare.pya" to name better compare be import do');
    await setupGenerator();

    await run('su name run from la ob text "task" to name text scratch be draft gen do ko ob text "pick better" to name text winner atmost num 3 be better compare do');

    assert.equal(remember("winner")?.ob?.text, "draft4");
    assert.equal(remember("draft count")?.ob?.num, 4);
  } finally {
    if (original === undefined) delete process.env.PYA_MIND_RESPONSE;
    else process.env.PYA_MIND_RESPONSE = original;
  }
});

test("better compare surfaces malformed judge output as refinery stage failure", async () => {
  const original = process.env.PYA_MIND_RESPONSE;
  process.env.PYA_MIND_RESPONSE = "maybe";
  try {
    forget();
    await setupMindFixture();
    await run('from filename "./module/better_compare.pya" to name better compare be import do');
    await setupGenerator();

    await run('su name run from la ob text "task" to name text scratch be draft gen do ko ob text "pick better" to name text winner atmost num 3 be better compare do');

    assert.match(remember("winner")?.ob?.text ?? "", /platform defective/);
    assert.ok((remember("draft count")?.ob?.num ?? 0) > 2);
  } finally {
    if (original === undefined) delete process.env.PYA_MIND_RESPONSE;
    else process.env.PYA_MIND_RESPONSE = original;
  }
});
