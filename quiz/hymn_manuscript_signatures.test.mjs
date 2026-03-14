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

test("hymn manuscript module keeps educational staged flow with verify platform", async () => {
  const text = await fs.readFile("module/hymn_manuscript.pya", "utf8");
  assert.match(text, /exists su name hymn hook prompt ob text quoted\.text\.You are writing the fixed hook phrase/);
  assert.match(text, /exists su name hymn intro prompt ob text quoted\.text\.You are writing the Intro/);
  assert.match(text, /exists su name hymn verse one prompt ob text quoted\.text\.You are writing Verse 1/);
  assert.match(text, /exists su name hymn chorus prompt ob text quoted\.text\.You are writing the Chorus/);
  assert.match(text, /exists su name hymn final chorus prompt ob text quoted\.text\.You are writing the Final Chorus/);
  assert.match(text, /exists su name hymn verse two prompt ob text quoted\.text\.You are writing Verse 2/);
  assert.match(text, /exists su name hymn bridge prompt ob text quoted\.text\.You are writing the Bridge/);
  assert.match(text, /exists su name hymn outro prompt ob text quoted\.text\.You are writing the Outro/);
  assert.match(text, /exists su name hymn hook mind be mind fromtext name hymn hook prompt ya/);
  assert.match(text, /exists su name hymn intro mind be mind fromtext name hymn intro prompt ya/);
  assert.match(text, /exists su name hymn outro mind be mind fromtext name hymn outro prompt ya/);
  assert.match(text, /exists su name hymn final chorus mind be mind fromtext name hymn final chorus prompt ya/);
  assert.match(text, /exists su name hymn imagery verify mind be mind fromtext name hymn imagery verify prompt ya/);
  assert.match(text, /exists su name hymn imagery verdict mind be mind fromtext name hymn imagery verdict prompt ya/);
  assert.match(text, /exists su name hymn chorus stability verify mind be mind fromtext name hymn chorus stability verify prompt ya/);
  assert.match(text, /exists su name hymn chorus stability verdict mind be mind fromtext name hymn chorus stability verdict prompt ya/);
  assert.match(text, /exists su name hymn source thrust verify mind be mind fromtext name hymn source thrust verify prompt ya/);
  assert.match(text, /exists su name hymn source thrust verdict mind be mind fromtext name hymn source thrust verdict prompt ya/);
  assert.match(text, /exists su name hymn source thrust intent ob text quoted\.text\./);
  assert.match(text, /Prefer positive goal-state language\./);
  assert.match(text, /Avoid negations and fear framing such as not, never, no more, cannot, won't, don't/);
  assert.match(text, /Land in the healed or illuminated goal state rather than in fear or warning\./);
  assert.match(text, /End in the desired spiritual state, promise, or encouragement\./);
  assert.match(text, /hymn source thrust verify prompt ob text quoted\.text\.Verify whether LYRIC stays faithful to the source teaching in TRANSCRIPT\./);
  assert.match(text, /hymn source thrust verdict prompt ob text quoted\.text\.Read the verifier analysis and output exactly one word: PASS or FAIL\./);
  assert.match(text, /su name hymn hook checks be series def/);
  assert.match(text, /su name hymn intro checks be series def/);
  assert.match(text, /su name hymn verse one checks be series def/);
  assert.match(text, /su name hymn chorus checks be series def/);
  assert.match(text, /su name hymn final chorus checks be series def/);
  assert.match(text, /su name hymn verse two checks be series def/);
  assert.match(text, /su name hymn bridge checks be series def/);
  assert.match(text, /su name hymn outro checks be series def/);
  assert.match(text, /su name line_count_min ob num 1 ya/);
  assert.match(text, /su name line_count_max ob num 2 ya/);
  assert.match(text, /su name line_count_min ob num 4 ya/);
  assert.match(text, /su name line_count_max ob num 4 ya/);
  assert.match(text, /su name line_count_min ob num 2 ya/);
  assert.match(text, /su name line_count_max ob num 4 ya/);
  assert.match(text, /su name hymn stage pass ob text packet to name text verdict be ceremony def/);
  assert.match(text, /su name hymn section verify from text request for name platform mind accordingto name checks series to name text output be ceremony def/);
  assert.match(text, /hymn section verify run platform ob text of from of this for name of for of this among name hymn stage pass accordingto name of accordingto of this atleast num 0\.8 fromindex num 1 toindex num 8 to name text output be verify platform do/);
  assert.match(text, /su name hook stage from text of ob of hook request for name hymn hook mind accordingto name hymn hook checks to name text hook out be hymn section verify do/);
  assert.match(text, /su name intro stage from text of ob of intro request for name hymn intro mind accordingto name hymn intro checks to name text intro out be hymn section verify do/);
  assert.match(text, /su name verse one stage from text of ob of verse one request for name hymn verse one mind accordingto name hymn verse one checks to name text verse one out be hymn section verify do/);
  assert.match(text, /su name verse one imagery verify stage from text of ob of verse one out to name text verse one imagery pass be hymn imagery do/);
  assert.match(text, /fromindex num 1 toindex num 3 be hymn verse one imagery retry do/);
  assert.match(text, /su name chorus stage from text of ob of chorus request for name hymn chorus mind accordingto name hymn chorus checks to name text chorus out be hymn section verify do/);
  assert.match(text, /su name verse two stage from text of ob of verse two request for name hymn verse two mind accordingto name hymn verse two checks to name text verse two out be hymn section verify do/);
  assert.match(text, /su name verse two imagery verify stage from text of ob of verse two out to name text verse two imagery pass be hymn imagery do/);
  assert.match(text, /fromindex num 1 toindex num 3 be hymn verse two imagery retry do/);
  assert.match(text, /su name bridge stage from text of ob of bridge request for name hymn bridge mind accordingto name hymn bridge checks to name text bridge out be hymn section verify do/);
  assert.match(text, /su name final chorus stage from text of ob of final chorus request for name hymn final chorus mind accordingto name hymn final chorus checks to name text final chorus out be hymn section verify do/);
  assert.match(text, /su name hymn chorus stability verify stage from text of ob of chorus out with text of ob of final chorus out to name text hymn chorus stability pass be hymn chorus stability do/);
  assert.match(text, /fromindex num 1 toindex num 3 be hymn chorus stability retry do/);
  assert.match(text, /su name outro stage from text of ob of outro request for name hymn outro mind accordingto name hymn outro checks to name text outro out be hymn section verify do/);
  assert.doesNotMatch(text, /be verify loop do/);
  assert.match(text, /su name hymn source thrust checked to name text pass be ceremony def/);
  assert.match(text, /su name hymn positive language from text lyric to name text pass be ceremony def/);
  assert.match(text, /su name hymn imagery verify to name text pass be ceremony def/);
  assert.match(text, /su name hymn imagery from text verse to name text pass be ceremony def/);
  assert.match(text, /su name hymn chorus stability verify to name text pass be ceremony def/);
  assert.match(text, /su name hymn chorus stability from text chorus with text final chorus to name text pass be ceremony def/);
  assert.match(text, /not\|never\|cannot\|can't\|won't\|don't\|didn't\|isn't\|aren't\|without\|no more/);
  assert.match(text, /su name hymn verse one imagery retry fromindex num 0 toindex num 0 be ceremony def/);
  assert.match(text, /su name hymn verse two imagery retry fromindex num 0 toindex num 0 be ceremony def/);
  assert.match(text, /su name hymn chorus stability retry fromindex num 0 toindex num 0 be ceremony def/);
  assert.match(text, /su name hymn source thrust retry fromindex num 0 toindex num 0 be ceremony def/);
  assert.match(text, /su name hymn goal state retry stage from text of ob of manuscript out to name text hymn goal state pass be hymn positive language do/);
  assert.match(text, /su name hymn goal state verify stage from text of ob of manuscript out to name text hymn goal state pass be hymn positive language do/);
  assert.match(text, /su name hymn goal state guarantee stage ob bool lie fromtext text "hymn goal state defective" be guarantee do/);
  assert.match(text, /hymn source thrust verify stage from text of ob of hymn script source with text of ob of manuscript out to name text hymn source thrust pass be hymn source thrust do/);
  assert.match(text, /fromindex num 1 toindex num 3 be hymn source thrust retry do/);
  assert.match(text, /su name hymn source thrust guarantee stage ob bool lie fromtext text "hymn source thrust defective" be guarantee do/);
  assert.match(text, /exists su name hymn manuscript be export ya/);
  assert.match(text, /exists su name manuscript as wo hymn be export ya/);
  assert.match(text, /su name chorus request begin stage ob text "TARGET_WORDS: 14-24\\nSECTION_ROLE: MEMORY_ANCHOR\\nFORMAT: RHYMING_COUPLETS\\nRHYME_SCHEME: AAAA_OR_AABB\\nHOOK_PHRASE:\\n"/);
  assert.match(text, /su name final chorus request begin stage ob text "TARGET_WORDS: 14-24\\nSECTION_ROLE: FINAL_CHORUS_REINFORCEMENT/);
  assert.match(text, /su name final chorus request prior stage ob name text final chorus prior to name final chorus request be plus do/);
  assert.match(text, /HOOK_PHRASE:\\n/);
  assert.match(text, /hymn out begin stage ob text quoted\.text\.\[intro\]/);
  assert.match(text, /hymn out chorus one header stage ob text quoted\.text\./);
  assert.match(text, /\[chorus\]/);
  assert.match(text, /hymn out bridge header stage ob text quoted\.text\./);
  assert.match(text, /\[bridge\]/);
  assert.match(text, /\[outro\]/);
  assert.match(text, /hymn out chorus three stage ob name text final chorus out to name hymn out be plus do/);
});
