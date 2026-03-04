import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";
import { deriveSignatureFromCall, joinSignatureWords, lookupSignature } from "../program/bridge/signature.mjs";

test("hymn manuscript module registers both hymn signatures and as-wo alias", async () => {
  forget();
  await interpret(parse('from filename "./module/hymn_manuscript.pya" to name hymn manuscript be import do'));

  const calls = [
    'su name demo from text "Solon source" to name text song be hymn manuscript do',
    'su name demo from filename "quiz/fixtures/ramblings.txt" to name text song be hymn manuscript do',
    'su name demo from text "Solon source" to name text song be manuscript as wo hymn do',
    'su name demo from filename "quiz/fixtures/ramblings.txt" to name text song be manuscript as wo hymn do'
  ];

  for (const line of calls) {
    const signature = joinSignatureWords(deriveSignatureFromCall(parse(line)));
    const resolved = lookupSignature(signature);
    assert.ok(resolved, `missing signature: ${signature}`);
  }
});

test("hymn manuscript module keeps educational staged flow with verifier loops", async () => {
  const text = await fs.readFile("module/hymn_manuscript.pya", "utf8");
  assert.match(text, /exists su name hymn intro prompt ob text quoted\.text\.You are writing the Intro/);
  assert.match(text, /exists su name hymn verse one prompt ob text quoted\.text\.You are writing Verse 1/);
  assert.match(text, /exists su name hymn chorus prompt ob text quoted\.text\.You are writing the Chorus/);
  assert.match(text, /exists su name hymn final chorus prompt ob text quoted\.text\.You are writing the Final Chorus/);
  assert.match(text, /exists su name hymn verse two prompt ob text quoted\.text\.You are writing Verse 2/);
  assert.match(text, /exists su name hymn bridge prompt ob text quoted\.text\.You are writing the Bridge/);
  assert.match(text, /exists su name hymn outro prompt ob text quoted\.text\.You are writing the Outro/);
  assert.match(text, /exists su name hymn intro mind be mind fromtext name hymn intro prompt ya/);
  assert.match(text, /exists su name hymn outro mind be mind fromtext name hymn outro prompt ya/);
  assert.match(text, /exists su name hymn final chorus mind be mind fromtext name hymn final chorus prompt ya/);
  assert.match(text, /exists su name hymn stage verify mind be mind fromtext name hymn stage verify prompt ya/);
  assert.match(text, /exists su name hymn source thrust verify mind be mind fromtext name hymn source thrust verify prompt ya/);
  assert.match(text, /exists su name hymn source thrust verdict mind be mind fromtext name hymn source thrust verdict prompt ya/);
  assert.match(text, /exists su name hymn source thrust intent ob text quoted\.text\./);
  assert.match(text, /hymn stage verify prompt ob text quoted\.text\.You verify whether a candidate lyric section fits its task instructions\./);
  assert.match(text, /hymn source thrust verify prompt ob text quoted\.text\.Verify whether the historical content in LYRIC is grounded in TRANSCRIPT\./);
  assert.match(text, /hymn source thrust verdict prompt ob text quoted\.text\.Read the verifier analysis and output exactly one word: PASS or FAIL\./);
  assert.match(text, /hymn intro write stage .* be verify loop do/);
  assert.match(text, /hymn verse one write stage .* be verify loop do/);
  assert.match(text, /hymn chorus write stage .* be verify loop do/);
  assert.match(text, /hymn verse two write stage .* be verify loop do/);
  assert.match(text, /hymn bridge write stage .* be verify loop do/);
  assert.match(text, /hymn final chorus write stage .* be verify loop do/);
  assert.match(text, /hymn outro write stage .* be verify loop do/);
  assert.match(text, /hymn intro write retry stage .* be verify loop do/);
  assert.match(text, /hymn verse one write retry stage .* be verify loop do/);
  assert.match(text, /hymn chorus write retry stage .* be verify loop do/);
  assert.match(text, /hymn verse two write retry stage .* be verify loop do/);
  assert.match(text, /hymn bridge write retry stage .* be verify loop do/);
  assert.match(text, /hymn final chorus write retry stage .* be verify loop do/);
  assert.match(text, /hymn outro write retry stage .* be verify loop do/);
  assert.match(text, /su name hymn source thrust checked to name text pass be ceremony def/);
  assert.match(text, /su name hymn source thrust retry fromindex num 0 toindex num 0 be ceremony def/);
  assert.match(text, /hymn source thrust verify stage from text of ob of hymn script source with text of ob of manuscript out to name text hymn source thrust pass be hymn source thrust do/);
  assert.match(text, /fromindex num 1 toindex num 3 be hymn source thrust retry do/);
  assert.match(text, /su name hymn source thrust guarantee stage ob bool lie fromtext text "hymn source thrust defective" be guarantee do/);
  assert.match(text, /exists su name hymn manuscript be export ya/);
  assert.match(text, /exists su name manuscript as wo hymn be export ya/);
  assert.match(text, /su name hymn intro retry fromindex num 0 toindex num 0 be ceremony def/);
  assert.match(text, /su name hymn verse one retry fromindex num 0 toindex num 0 be ceremony def/);
  assert.match(text, /su name hymn chorus retry fromindex num 0 toindex num 0 be ceremony def/);
  assert.match(text, /su name hymn verse two retry fromindex num 0 toindex num 0 be ceremony def/);
  assert.match(text, /su name hymn bridge retry fromindex num 0 toindex num 0 be ceremony def/);
  assert.match(text, /su name hymn final chorus retry fromindex num 0 toindex num 0 be ceremony def/);
  assert.match(text, /su name hymn outro retry fromindex num 0 toindex num 0 be ceremony def/);
  assert.match(text, /fromindex num 1 toindex num 3 be hymn intro retry do/);
  assert.match(text, /fromindex num 1 toindex num 3 be hymn verse one retry do/);
  assert.match(text, /fromindex num 1 toindex num 3 be hymn chorus retry do/);
  assert.match(text, /fromindex num 1 toindex num 3 be hymn verse two retry do/);
  assert.match(text, /fromindex num 1 toindex num 3 be hymn bridge retry do/);
  assert.match(text, /fromindex num 1 toindex num 3 be hymn final chorus retry do/);
  assert.match(text, /fromindex num 1 toindex num 3 be hymn outro retry do/);
  assert.match(text, /su name final chorus request begin stage ob text "TARGET_WORDS: 18-25\\nSECTION_ROLE: FINAL_CHORUS_REINFORCEMENT/);
  assert.match(text, /su name final chorus request prior stage ob name text final chorus prior to name final chorus request be plus do/);
  assert.match(text, /hymn out begin stage ob text quoted\.text\.\[intro\]/);
  assert.match(text, /hymn out chorus one header stage ob text quoted\.text\./);
  assert.match(text, /\[chorus\]/);
  assert.match(text, /hymn out bridge header stage ob text quoted\.text\./);
  assert.match(text, /\[bridge\]/);
  assert.match(text, /\[outro\]/);
  assert.match(text, /hymn out chorus three stage ob name text final chorus out to name hymn out be plus do/);
});
