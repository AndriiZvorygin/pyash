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
  assert.match(text, /exists su name brief video script cta prompt ob text quoted\.text\.Write one short call to action for this same short\./);
  assert.match(text, /exists su name brief video script hook prompt ob text quoted\.text\.Write one opening hook line for this short\./);
  assert.match(text, /- Must end with "\." or "\?"\./);
  assert.doesNotMatch(text, /brief video script hook retry mind/u);
  assert.doesNotMatch(text, /brief video script cta retry mind/u);
  assert.doesNotMatch(text, /brief video script fact one retry mind/u);
  assert.doesNotMatch(text, /brief video script fact two retry mind/u);
  assert.doesNotMatch(text, /brief video script uplift retry mind/u);
  assert.doesNotMatch(text, /brief video script body retry mind/u);
  assert.doesNotMatch(text, /be verify loop do/u);
  assert.match(text, /su name manuscript ending connector from text line to name text pass be ceremony def/);
  assert.match(text, /su name manuscript sentence polish from text line to name map result be ceremony def/);
  assert.match(text, /su name manuscript sentence complete from text line to name text pass be ceremony def/);
  assert.doesNotMatch(text, /su name manuscript hook complete from text line to name text pass be ceremony def/);
  assert.doesNotMatch(text, /su name manuscript cta complete from text line to name text pass be ceremony def/);
  assert.match(text, /su name manuscript segment distinct from text line with text prior to name text pass be ceremony def/);
  assert.match(text, /manuscript sentence polish verify platform be verify as wo sentence complete ob text of from of this to name map result do/);
  assert.match(text, /su name manuscript platform verify from text request for name platform mind accordingto name checks series to name text output be ceremony def/);
  assert.match(text, /manuscript platform verify run platform ob text of from of this for name of for of this among name brief video script platform verify mind accordingto name of accordingto of this atleast num 0\.8 fromindex num 1 toindex num 3 to name text output be verify platform do/);
  assert.match(text, /su name manuscript fact one checks be series def/);
  assert.match(text, /su name manuscript fact two checks be series def/);
  assert.match(text, /su name manuscript uplift checks be series def/);
  assert.match(text, /su name manuscript hook checks be series def/);
  assert.match(text, /su name manuscript cta checks be series def/);
  assert.match(text, /su name word_min ob num 20 ya/);
  assert.match(text, /su name word_max ob num 34 ya/);
  assert.match(text, /su name word_min ob num 18 ya/);
  assert.match(text, /su name word_max ob num 40 ya/);
  assert.match(text, /su name word_min ob num 6 ya/);
  assert.match(text, /su name word_max ob num 9 ya/);
  assert.match(text, /su name word_min ob num 2 ya/);
  assert.match(text, /su name word_max ob num 4 ya/);
  assert.match(text, /su name sentence_complete ob bool truth ya/);
  assert.match(text, /be verify platform do/);
  assert.match(text, /manuscript fact one platform from text of ob of manuscript fact one request for name brief video script fact one mind accordingto name manuscript fact one checks to name text manuscript fact one out be manuscript platform verify do/);
  assert.match(text, /manuscript fact two platform from text of ob of manuscript fact two request for name brief video script fact two mind accordingto name manuscript fact two checks to name text output be manuscript platform verify do/);
  assert.match(text, /manuscript fact two distinct platform from text of ob of output with text of ob of manuscript fact one out to name text manuscript fact two distinct pass be manuscript segment distinct do/);
  assert.match(text, /manuscript fact two guarantee platform ob bool lie fromtext text "manuscript fact two constraints defective" be guarantee do/);
  assert.match(text, /manuscript uplift platform from text of ob of manuscript uplift request for name brief video script uplift mind accordingto name manuscript uplift checks to name text manuscript uplift out be manuscript platform verify do/);
  assert.match(text, /manuscript hook platform from text of ob of manuscript hook request for name brief video script hook mind accordingto name manuscript hook checks to name text manuscript hook out be manuscript platform verify do/);
  assert.match(text, /manuscript cta platform from text of ob of manuscript cta request for name brief video script cta mind accordingto name manuscript cta checks to name text manuscript cta out be manuscript platform verify do/);
  assert.match(text, /manuscript total verify platform be verify as wo word count atleast num 70 atmost num 110/);
  assert.doesNotMatch(text, /su name manuscript total retry fromindex num 0 toindex num 0 be ceremony def/);
  assert.match(text, /manuscript out cta platform ob name text manuscript cta out to name manuscript out be plus do/);
  assert.match(text, /brief video script source thrust verify prompt ob text quoted\.text\.Good\. Here is a much cleaner rubric/);
  assert.match(text, /brief video script source thrust intent ob text quoted\.text\.The generator is asked to write a short spoken script/);
  assert.match(text, /brief video script source thrust verdict prompt ob text quoted\.text\.Read the verifier analysis and output exactly one word: PASS or FAIL\./);
  assert.match(text, /manuscript source thrust write platform .* by num 0 atmost num 280 be write do/);
  assert.match(text, /manuscript source thrust verdict request begin platform ob text "VERIFIER_ANALYSIS:\\n" to name text manuscript source thrust verdict request be text do/);
  assert.match(text, /for name brief video script source thrust verdict mind to name text manuscript source thrust verdict raw by num 0 atmost num 8 be write do/);
  assert.match(text, /manuscript source thrust verdict known be text do/);
  assert.match(text, /manuscript source thrust request intent header platform ob text "\\n\\nGENERATOR_INTENT:\\n" to name text manuscript source thrust request be plus do/);
  assert.match(text, /manuscript source thrust verify platform from text of ob of brief video script source with text of ob of manuscript out to name text manuscript source thrust pass be manuscript source thrust do/);
  assert.match(text, /su name manuscript source thrust retry fromindex num 0 toindex num 0 be ceremony def/);
  assert.match(text, /manuscript source thrust verify retry platform from text of ob of brief video script source with text of ob of manuscript out to name text manuscript source thrust pass be manuscript source thrust do/);
  assert.match(text, /fromindex num 1 toindex num 3 be manuscript source thrust retry do/);
  assert.match(text, /manuscript source thrust guarantee platform ob bool lie fromtext text "manuscript source thrust defective" be guarantee do/);
  assert.match(text, /be depart do/);
});

test("brief manuscript completion ceremonies reject sentence fragments", async () => {
  forget();
  await interpret(parse('from filename "./module/brief_manuscript.pya" to name brief manuscript be import do'));

  await interpret(parse('su name demo from text "Families lost homes to debt traps." to name text pass be manuscript sentence complete do'));
  assert.equal(remember("pass")?.ob?.text, "true");

  await interpret(parse('su name demo from text "Families lost homes to debt traps" to name text pass be manuscript sentence complete do'));
  assert.equal(remember("pass")?.ob?.text, "true");

  await interpret(parse('su name demo from text "Families lost homes and." to name text pass be manuscript sentence complete do'));
  assert.equal(remember("pass")?.ob?.text, "false");

  await interpret(parse('su name demo from text "Families lost homes on." to name text pass be manuscript sentence complete do'));
  assert.equal(remember("pass")?.ob?.text, "true");

  await interpret(parse('su name demo from text "Will families regain ownership?" to name text pass be manuscript sentence complete do'));
  assert.equal(remember("pass")?.ob?.text, "true");

  await interpret(parse('su name demo from text "Will families regain ownership" to name text pass be manuscript sentence complete do'));
  assert.equal(remember("pass")?.ob?.text, "true");

  await interpret(parse('su name demo from text "Restore land ownership today" to name text pass be manuscript sentence complete do'));
  assert.equal(remember("pass")?.ob?.text, "true");

  await interpret(parse('su name demo from text "Restore land and." to name text pass be manuscript sentence complete do'));
  assert.equal(remember("pass")?.ob?.text, "false");

  await interpret(parse('su name demo from text "Restore land ownership now" with text "Restore land ownership now." to name text pass be manuscript segment distinct do'));
  assert.equal(remember("pass")?.ob?.text, "false");

  await interpret(parse('su name demo from text "Restore land ownership now" with text "Restore family farms now." to name text pass be manuscript segment distinct do'));
  assert.equal(remember("pass")?.ob?.text, "true");
});
