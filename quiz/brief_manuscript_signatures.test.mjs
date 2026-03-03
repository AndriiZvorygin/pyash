import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, remember } from "../program/remember/index.mjs";
import { deriveSignatureFromCall, joinSignatureWords, lookupSignature } from "../program/bridge/signature.mjs";

test("brief manuscript module registers text and filename signatures", async () => {
  forget();
  await interpret(parse('from filename "./module/brief_manuscript.pya" to name brief manuscript be import do'));

  const calls = [
    'su name demo from text "Solon banned debt bondage." to name text script be brief manuscript do',
    'su name demo from filename "quiz/fixtures/ramblings.txt" to name text script be brief manuscript do'
  ];

  for (const line of calls) {
    const signature = joinSignatureWords(deriveSignatureFromCall(parse(line)));
    const resolved = lookupSignature(signature);
    assert.ok(resolved, `missing signature: ${signature}`);
    assert.ok(String(resolved).endsWith("brief manuscript"), `unexpected target: ${resolved}`);
  }
});

test("brief manuscript module keeps staged word-count verifies including total bounds", async () => {
  const text = await fs.readFile("module/brief_manuscript.pya", "utf8");
  assert.match(text, /exists su name brief video script hook mind be mind fromtext name brief video script hook prompt ya/);
  assert.match(text, /exists su name brief video script cta mind be mind fromtext name brief video script cta prompt ya/);
  assert.match(text, /exists su name brief video script cta retry mind be mind fromtext name brief video script cta retry prompt ya/);
  assert.match(text, /exists su name brief video script cta prompt ob text quoted\.text\.Write one short call to action for this same short\./);
  assert.match(text, /exists su name brief video script cta retry prompt ob text quoted\.text\.Rewrite the provided call to action to exactly 2-4 words\./);
  assert.match(text, /exists su name brief video script body retry prompt ob text quoted\.text\.Rewrite the provided manuscript body to 62-97 words total\./);
  assert.match(text, /exists su name brief video script hook prompt ob text quoted\.text\.Write one opening hook line for this short\./);
  assert.match(text, /- Must end with "\." or "\?"\./);
  assert.match(text, /exists su name brief video script hook retry prompt ob text quoted\.text\.Rewrite the provided hook to exactly 6-9 words\./);
  assert.match(text, /- End with "\." or "\?"\./);
  assert.match(text, /su name manuscript ending connector from text line to name text pass be ceremony def/);
  assert.match(text, /su name manuscript sentence complete from text line to name text pass be ceremony def/);
  assert.match(text, /su name manuscript hook complete from text line to name text pass be ceremony def/);
  assert.match(text, /su name manuscript cta complete from text line to name text pass be ceremony def/);
  assert.match(text, /ob name text manuscript sentence complete line from text "\/\[\.!\?\]\\\\s\*\$\/" be resemble then/);
  assert.match(text, /ob name text manuscript hook complete line from text "\/\[\.\?\]\\\\s\*\$\/" be resemble then/);
  assert.match(text, /manuscript fact one write stage .* be verify loop do/);
  assert.match(text, /manuscript fact one verify stage be verify as wo word count atleast num 20 atmost num 34/);
  assert.match(text, /manuscript fact one complete stage from text of ob of output to name text manuscript fact one complete pass be manuscript sentence complete do/);
  assert.match(text, /su name manuscript fact one retry fromindex num 0 toindex num 0 be ceremony def/);
  assert.match(text, /manuscript fact one verify retry stage be verify as wo word count atleast num 20 atmost num 34/);
  assert.match(text, /manuscript fact one complete retry stage from text of ob of output to name text manuscript fact one complete pass be manuscript sentence complete do/);
  assert.match(text, /fromindex num 1 toindex num 3 be manuscript fact one retry do/);
  assert.doesNotMatch(text, /manuscript fact one verify retry first stage/);
  assert.match(text, /manuscript fact two write stage .* be verify loop do/);
  assert.match(text, /manuscript fact two verify stage be verify as wo word count atleast num 20 atmost num 34/);
  assert.match(text, /manuscript fact two complete stage from text of ob of output to name text manuscript fact two complete pass be manuscript sentence complete do/);
  assert.match(text, /su name manuscript fact two retry fromindex num 0 toindex num 0 be ceremony def/);
  assert.match(text, /manuscript fact two verify retry stage be verify as wo word count atleast num 20 atmost num 34/);
  assert.match(text, /manuscript fact two complete retry stage from text of ob of output to name text manuscript fact two complete pass be manuscript sentence complete do/);
  assert.match(text, /fromindex num 1 toindex num 3 be manuscript fact two retry do/);
  assert.doesNotMatch(text, /manuscript fact two verify retry first stage/);
  assert.match(text, /manuscript uplift write stage .* be verify loop do/);
  assert.match(text, /manuscript uplift verify stage be verify as wo word count atleast num 18 atmost num 40/);
  assert.match(text, /manuscript uplift complete stage from text of ob of output to name text manuscript uplift complete pass be manuscript sentence complete do/);
  assert.match(text, /su name manuscript uplift retry fromindex num 0 toindex num 0 be ceremony def/);
  assert.match(text, /manuscript uplift retry write stage .* be verify loop do/);
  assert.match(text, /manuscript uplift verify retry stage be verify as wo word count atleast num 18 atmost num 40/);
  assert.match(text, /manuscript uplift complete retry stage from text of ob of output to name text manuscript uplift complete pass be manuscript sentence complete do/);
  assert.match(text, /fromindex num 1 toindex num 3 be manuscript uplift retry do/);
  assert.doesNotMatch(text, /manuscript uplift verify retry first stage/);
  assert.match(text, /manuscript hook verify stage be verify as wo word count atleast num 6 atmost num 9/);
  assert.match(text, /manuscript hook complete stage from text of ob of output to name text manuscript hook complete pass be manuscript hook complete do/);
  assert.match(text, /su name manuscript hook retry fromindex num 0 toindex num 0 be ceremony def/);
  assert.match(text, /manuscript hook verify retry stage be verify as wo word count atleast num 6 atmost num 9/);
  assert.match(text, /manuscript hook complete retry stage from text of ob of output to name text manuscript hook complete pass be manuscript hook complete do/);
  assert.match(text, /fromindex num 1 toindex num 3 be manuscript hook retry do/);
  assert.doesNotMatch(text, /manuscript hook verify retry first stage/);
  assert.match(text, /su name manuscript cta checked to name text output be ceremony def/);
  assert.match(text, /manuscript cta verify stage be verify as wo word count atleast num 2 atmost num 4/);
  assert.match(text, /su name manuscript cta retry fromindex num 0 toindex num 0 be ceremony def/);
  assert.match(text, /manuscript cta verify retry stage be verify as wo word count atleast num 2 atmost num 4/);
  assert.match(text, /manuscript cta complete retry stage from text of ob of output to name text manuscript cta complete pass be manuscript cta complete do/);
  assert.match(text, /fromindex num 1 toindex num 3 be manuscript cta retry do/);
  assert.match(text, /manuscript cta complete stage from text of ob of output to name text manuscript cta complete pass be manuscript cta complete do/);
  assert.match(text, /manuscript cta guarantee stage ob bool lie fromtext text "manuscript cta constraints defective" be guarantee do/);
  assert.match(text, /manuscript total verify stage be verify as wo word count atleast num 70 atmost num 110/);
  assert.match(text, /su name manuscript total retry fromindex num 0 toindex num 0 be ceremony def/);
  assert.match(text, /manuscript total retry verify stage be verify as wo word count atleast num 70 atmost num 110/);
  assert.doesNotMatch(text, /fromindex num 1 toindex num 3 be manuscript total retry do/);
  assert.match(text, /manuscript out cta stage ob name text manuscript cta out to name manuscript out be plus do/);
  assert.doesNotMatch(text, /manuscript total retry first verify stage/);
  assert.match(text, /brief video script source thrust verify prompt ob text quoted\.text\.Good\. Here is a much cleaner rubric/);
  assert.match(text, /brief video script source thrust intent ob text quoted\.text\.The generator is asked to write a short spoken script/);
  assert.match(text, /brief video script source thrust verdict prompt ob text quoted\.text\.Read the verifier analysis and output exactly one word: PASS or FAIL\./);
  assert.match(text, /manuscript source thrust write stage .* by num 0 atmost num 280 be write do/);
  assert.match(text, /manuscript source thrust verdict tail stage ob name text manuscript source thrust review atmost num 1 to name text manuscript source thrust verdict line be line tail do/);
  assert.match(text, /manuscript source thrust verdict request begin stage ob text "VERIFIER_ANALYSIS:\\n" to name text manuscript source thrust verdict request be text do/);
  assert.match(text, /for name brief video script source thrust verdict mind to name text manuscript source thrust verdict raw by num 0 atmost num 8 be write do/);
  assert.match(text, /manuscript source thrust request intent header stage ob text "\\n\\nGENERATOR_INTENT:\\n" to name text manuscript source thrust request be plus do/);
  assert.match(text, /manuscript source thrust verify stage from text of ob of brief video script source with text of ob of manuscript out to name text manuscript source thrust pass be manuscript source thrust do/);
  assert.match(text, /su name manuscript source thrust retry fromindex num 0 toindex num 0 be ceremony def/);
  assert.match(text, /manuscript source thrust verify retry stage from text of ob of brief video script source with text of ob of manuscript out to name text manuscript source thrust pass be manuscript source thrust do/);
  assert.match(text, /fromindex num 1 toindex num 3 be manuscript source thrust retry do/);
  assert.doesNotMatch(text, /manuscript source thrust verify retry first stage/);
  assert.match(text, /manuscript source thrust guarantee stage ob bool lie fromtext text "manuscript source thrust defective" be guarantee do/);
  assert.match(text, /be depart do/);
});

test("brief manuscript completion ceremonies reject sentence fragments", async () => {
  forget();
  await interpret(parse('from filename "./module/brief_manuscript.pya" to name brief manuscript be import do'));

  await interpret(parse('su name demo from text "Families lost homes to debt traps." to name text pass be manuscript sentence complete do'));
  assert.equal(remember("pass")?.ob?.text, "true");

  await interpret(parse('su name demo from text "Families lost homes to debt traps" to name text pass be manuscript sentence complete do'));
  assert.equal(remember("pass")?.ob?.text, "false");

  await interpret(parse('su name demo from text "Families lost homes and." to name text pass be manuscript sentence complete do'));
  assert.equal(remember("pass")?.ob?.text, "false");

  await interpret(parse('su name demo from text "Will families regain ownership?" to name text pass be manuscript hook complete do'));
  assert.equal(remember("pass")?.ob?.text, "true");

  await interpret(parse('su name demo from text "Will families regain ownership" to name text pass be manuscript hook complete do'));
  assert.equal(remember("pass")?.ob?.text, "false");

  await interpret(parse('su name demo from text "Restore land ownership today" to name text pass be manuscript cta complete do'));
  assert.equal(remember("pass")?.ob?.text, "true");

  await interpret(parse('su name demo from text "Restore land and." to name text pass be manuscript cta complete do'));
  assert.equal(remember("pass")?.ob?.text, "false");
});
