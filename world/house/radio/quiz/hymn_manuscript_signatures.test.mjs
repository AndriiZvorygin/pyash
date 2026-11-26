import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

import { parse } from "../../../../program/understand/index.mjs";
import { interpret } from "../../../../program/bridge/index.mjs";
import { forget } from "../../../../program/remember/index.mjs";
import { deriveSignatureFromCall, joinSignatureWords, lookupSignature } from "../../../../program/bridge/signature.mjs";

test("hymn manuscript module registers both hymn signatures and as-wo alias", async () => {
  forget();
  await interpret(parse('from filename "./world/house/radio/module/hymn_manuscript.pya" to name hymn manuscript be import do'));

  const calls = [
    'su name demo from text "Solon source" to name text song be hymn manuscript do',
    'su name demo from text "Solon source" with text "armor of light" to name text song be hymn manuscript do',
    'su name demo from filename "quiz/fixtures/ramblings.txt" to name text song be hymn manuscript do',
    'su name demo from filename "quiz/fixtures/ramblings.txt" with text "armor of light" to name text song be hymn manuscript do',
    'su name demo from text "Solon source" to name text song be manuscript as wo hymn do',
    'su name demo from text "Solon source" with text "armor of light" to name text song be manuscript as wo hymn do',
    'su name demo from filename "quiz/fixtures/ramblings.txt" to name text song be manuscript as wo hymn do',
    'su name demo from filename "quiz/fixtures/ramblings.txt" with text "armor of light" to name text song be manuscript as wo hymn do'
  ];

  for (const line of calls) {
    const signature = joinSignatureWords(deriveSignatureFromCall(parse(line)));
    const resolved = lookupSignature(signature);
    assert.ok(resolved, `missing signature: ${signature}`);
  }
});

test("hymn manuscript module writes one prompt per song section", async () => {
  const text = await fs.readFile("world/house/radio/module/hymn_manuscript.pya", "utf8");

  assert.match(text, /exists su name hymn verse one prompt ob text quoted\.text\.You are writing Verse 1/);
  assert.match(text, /exists su name hymn verse two prompt ob text quoted\.text\.You are writing Verse 2/);
  assert.match(text, /exists su name hymn verse three prompt ob text quoted\.text\.You are writing Verse 3/);
  assert.match(text, /exists su name hymn chorus prompt ob text quoted\.text\.You are writing the Chorus of an educational song\./);
  assert.match(text, /exists su name hymn final chorus line prompt ob text quoted\.text\.You are rewriting the last line of the Chorus of an educational song\./);
  assert.match(text, /exists su name hymn bridge prompt ob text quoted\.text\.You are writing the Bridge/);
  assert.match(text, /exists su name hymn outro prompt ob text quoted\.text\.You are writing the Outro/);

  assert.match(text, /exists su name hymn verse one mind be mind fromtext name hymn verse one prompt ya/);
  assert.match(text, /exists su name hymn verse two mind be mind fromtext name hymn verse two prompt ya/);
  assert.match(text, /exists su name hymn verse three mind be mind fromtext name hymn verse three prompt ya/);
  assert.match(text, /exists su name hymn chorus mind be mind fromtext name hymn chorus prompt ya/);
  assert.match(text, /exists su name hymn final chorus line mind be mind fromtext name hymn final chorus line prompt ya/);
  assert.match(text, /exists su name hymn bridge mind be mind fromtext name hymn bridge prompt ya/);
  assert.match(text, /exists su name hymn outro mind be mind fromtext name hymn outro prompt ya/);

  assert.doesNotMatch(text, /exists su name hymn chorus stability/);
  assert.doesNotMatch(text, /hymn chorus stability/);
});

test("hymn manuscript module builds the chorus as a four line stanza", async () => {
  const text = await fs.readFile("world/house/radio/module/hymn_manuscript.pya", "utf8");

  assert.match(text, /The chorus structure is:/);
  assert.match(text, /HOOK\nCOUPLET\nCOUPLET/);
  assert.match(text, /Your job is to write all four lines\./);
  assert.match(text, /Write exactly 4 short lyrical lines\./);
  assert.match(text, /Line 1 is the HOOK_PHRASE, word for word\./);
  assert.match(text, /Line 4 must rhyme with line 3, because a later chorus rewrites that line\./);
  assert.match(text, /42 to 52 words in total\./);
});

test("hymn manuscript module writes the final chorus as three kept lines plus one new line", async () => {
  const text = await fs.readFile("world/house/radio/module/hymn_manuscript.pya", "utf8");

  assert.match(text, /su name hymn final chorus build from text chorus with text request to name text final chorus out be ceremony def/);
  assert.match(text, /su name final chorus line stage from text of with of this for name hymn final chorus line mind accordingto name hymn final chorus line checks to name text final chorus line out be hymn section verify do/);
  assert.match(text, /ob text of from of this to name text hymn chorus source be text do/);
  assert.match(text, /ob name text hymn chorus source by wo newline to name vec text hymn chorus lines be distribute do/);
  assert.match(text, /su name hymn chorus line one stage ob name hymn chorus lines at num 0 be read to name text hymn chorus line one out do/);
  assert.match(text, /su name hymn chorus line two stage ob name hymn chorus lines at num 1 be read to name text hymn chorus line two out do/);
  assert.match(text, /su name hymn chorus line three stage ob name hymn chorus lines at num 2 be read to name text hymn chorus line three out do/);
  assert.match(text, /su name final chorus out begin stage ob name text hymn chorus line one out to name text final chorus out be text do/);
  assert.match(text, /su name final chorus out line four stage ob name text final chorus line out to name text final chorus out be plus do/);
  assert.doesNotMatch(text, /ob of request/);
});

test("hymn manuscript module budgets every section for the reference song density", async () => {
  const text = await fs.readFile("world/house/radio/module/hymn_manuscript.pya", "utf8");

  assert.match(text, /su name hymn verse one checks be series def[\s\S]*?su name word_min ob num 36 ya[\s\S]*?su name word_max ob num 64 ya[\s\S]*?su name line_count_min ob num 3 ya[\s\S]*?su name line_count_max ob num 5 ya/);
  assert.match(text, /su name hymn verse two checks be series def[\s\S]*?su name word_min ob num 36 ya[\s\S]*?su name word_max ob num 64 ya[\s\S]*?su name line_count_min ob num 3 ya[\s\S]*?su name line_count_max ob num 5 ya/);
  assert.match(text, /su name hymn verse three checks be series def[\s\S]*?su name word_min ob num 36 ya[\s\S]*?su name word_max ob num 64 ya[\s\S]*?su name line_count_min ob num 3 ya[\s\S]*?su name line_count_max ob num 5 ya/);
  assert.match(text, /su name hymn chorus checks be series def[\s\S]*?su name word_min ob num 34 ya[\s\S]*?su name word_max ob num 60 ya[\s\S]*?su name line_count_min ob num 4 ya[\s\S]*?su name line_count_max ob num 4 ya/);
  assert.match(text, /su name hymn final chorus line checks be series def[\s\S]*?su name word_min ob num 8 ya[\s\S]*?su name word_max ob num 20 ya[\s\S]*?su name line_count_min ob num 1 ya[\s\S]*?su name line_count_max ob num 1 ya/);
  assert.match(text, /su name hymn bridge checks be series def[\s\S]*?su name word_min ob num 32 ya[\s\S]*?su name word_max ob num 60 ya[\s\S]*?su name line_count_min ob num 3 ya[\s\S]*?su name line_count_max ob num 5 ya/);
  assert.match(text, /su name hymn outro checks be series def[\s\S]*?su name word_min ob num 5 ya[\s\S]*?su name word_max ob num 28 ya[\s\S]*?su name line_count_min ob num 2 ya[\s\S]*?su name line_count_max ob num 4 ya/);

  assert.match(text, /TARGET_WORDS: 44-56\\nSECTION_ROLE: CONCEPT_OPENING/);
  assert.match(text, /TARGET_WORDS: 44-56\\nSECTION_ROLE: EXPLANATION_EXAMPLES/);
  assert.match(text, /TARGET_WORDS: 44-56\\nSECTION_ROLE: CONCEPT_LANDING/);
  assert.match(text, /TARGET_WORDS: 42-52\\nSECTION_ROLE: MEMORY_ANCHOR\\n/);
  assert.match(text, /TARGET_WORDS: 40-52\\nSECTION_ROLE: REFLECTION_SHIFT/);
  assert.match(text, /TARGET_WORDS: 10-14\\nSECTION_ROLE: MEMORY_ANCHOR_ESCALATION\\nFORMAT: SINGLE_LINE/);
  assert.match(text, /TARGET_WORDS: 8-20\\nSECTION_ROLE: OUTRO_CLOSURE/);
});

test("hymn manuscript module assembles the reference arrangement deterministically", async () => {
  const text = await fs.readFile("world/house/radio/module/hymn_manuscript.pya", "utf8");

  assert.match(text, /su name sheet begin stage ob text "\[Verse\]\\n" to name text sheet out be text do/);
  assert.match(text, /su name sheet verse two header stage ob text "\\n\\n\[Verse\]\\n" to name sheet out be plus do/);
  assert.match(text, /su name sheet chorus one header stage ob text "\\n\\n\[Chorus\]\\n" to name sheet out be plus do/);
  assert.match(text, /su name sheet bridge header stage ob text "\\n\\n\[Bridge\]\\n" to name sheet out be plus do/);
  assert.match(text, /su name sheet chorus three header stage ob text "\\n\\n\[Chorus\]\\n" to name sheet out be plus do/);
  assert.match(text, /su name sheet outro header stage ob text "\\n\\n\[Outro\]\\n" to name sheet out be plus do/);
  assert.match(text, /su name sheet chorus two stage ob name text chorus out to name sheet out be plus do/);
  assert.match(text, /su name sheet chorus three stage ob name text final chorus out to name sheet out be plus do/);

  assert.doesNotMatch(text, /quoted\.text\.\[verse/u);
  assert.doesNotMatch(text, /\[verse 1\]/);
  assert.doesNotMatch(text, /\[chorus\]/);
  assert.doesNotMatch(text, /\[bridge\]/);
  assert.doesNotMatch(text, /\[outro\]/);
  assert.doesNotMatch(text, /hymn intro/);
});

test("hymn manuscript module counts the hook once per chorus", async () => {
  const text = await fs.readFile("world/house/radio/module/hymn_manuscript.pya", "utf8");

  assert.match(text, /be verify as wo phrase count atleast num 1 atmost num 2 from name text chorus out with name text hook out to name map hymn chorus hook verify do/);
  assert.match(text, /be verify as wo phrase count atleast num 1 atmost num 2 from name text final chorus out with name text hook out to name map hymn final chorus hook verify do/);
  assert.match(text, /be verify as wo phrase count atleast num 3 atmost num 6 from name text hymn out with name text hook out to name map hymn total hook verify do/);
});

test("hymn manuscript module keeps the hook and verifier machinery", async () => {
  const text = await fs.readFile("world/house/radio/module/hymn_manuscript.pya", "utf8");

  assert.match(text, /exists su name hymn hook prompt ob text quoted\.text\.You are writing the fixed hook phrase/);
  assert.match(text, /exists su name hymn hook pool prompt ob text quoted\.text\.You are generating a pool of hook candidates/);
  assert.match(text, /exists su name hymn hook source focus prompt ob text quoted\.text\.Extract the most hook-worthy source lines/);
  assert.match(text, /exists su name hymn source analysis prompt ob text quoted\.text\.Extract a compact writing brief/);
  assert.match(text, /exists su name hymn hook sieve prompt ob text quoted\.text\.Filter the hook candidates down to only valid refrain lines/);
  assert.match(text, /exists su name hymn hook choose prompt ob text quoted\.text\.Select the single best usable hook candidate/);
  assert.match(text, /exists su name hymn imagery verify mind be mind fromtext name hymn imagery verify prompt ya/);
  assert.match(text, /exists su name hymn imagery verdict mind be mind fromtext name hymn imagery verdict prompt ya/);
  assert.match(text, /exists su name hymn communal voice verify mind be mind fromtext name hymn communal voice verify prompt ya/);
  assert.match(text, /exists su name hymn communal voice verdict mind be mind fromtext name hymn communal voice verdict prompt ya/);
  assert.match(text, /exists su name hymn source thrust verify mind be mind fromtext name hymn source thrust verify prompt ya/);
  assert.match(text, /exists su name hymn source thrust verdict mind be mind fromtext name hymn source thrust verdict prompt ya/);
  assert.match(text, /exists su name hymn source thrust intent ob text quoted\.text\./);

  assert.match(text, /su name hymn stage pass ob text packet to name text verdict be ceremony def/);
  assert.match(text, /su name hymn section verify from text request for name platform mind accordingto name checks series to name text output be ceremony def/);
  assert.match(text, /hymn section verify run platform ob text of from of this for name of for of this among name hymn stage pass accordingto name of accordingto of this atleast num 0\.8 fromindex num 1 toindex num 8 to name text output be verify platform do/);

  assert.match(text, /su name hymn hook checks be series def[\s\S]*?su name word_min ob num 4 ya[\s\S]*?su name word_max ob num 8 ya[\s\S]*?su name line_count_min ob num 1 ya[\s\S]*?su name line_count_max ob num 1 ya/);
  assert.match(text, /su name hymn hook source focus from text source to name text output be ceremony def/);
  assert.match(text, /su name hymn source analysis from text source to name text output be ceremony def/);
  assert.match(text, /su name hymn hook pool fill from text source to name text output be ceremony def/);
  assert.match(text, /su name hymn hook sieve from text source with text candidates to name text output be ceremony def/);
  assert.match(text, /su name hymn hook choose from text source with text candidates to name text output be ceremony def/);
  assert.match(text, /su name hymn hook source fit from text source with text hook to name text pass be ceremony def/);
  assert.match(text, /su name hymn imagery verify to name text pass be ceremony def/);
  assert.match(text, /su name hymn imagery from text verse to name text pass be ceremony def/);
  assert.match(text, /su name hymn communal voice checked to name text pass be ceremony def/);
  assert.match(text, /su name hymn communal voice from text lyric to name text pass be ceremony def/);
  assert.match(text, /su name hymn source thrust checked to name text pass be ceremony def/);
  assert.match(text, /su name hymn source thrust from text transcript with text lyric to name text pass be ceremony def/);
  assert.match(text, /su name hymn positive language from text lyric to name text pass be ceremony def/);
  assert.match(text, /su name hymn manuscript be export ya/);
  assert.match(text, /exists su name manuscript as wo hymn be export ya/);
});

test("hymn manuscript module rates its gates instead of failing the run", async () => {
  const text = await fs.readFile("world/house/radio/module/hymn_manuscript.pya", "utf8");

  assert.doesNotMatch(text, /be guarantee do/);
  assert.doesNotMatch(text, /PASS or FAIL/);

  assert.match(text, /Read the verifier analysis and output exactly one rating: HIGH, MID, or LOW\./);
  assert.match(text, /Final line must be exactly HIGH, MID, or LOW\./);
  assert.match(text, /Output MID when the analysis is unclear\./);

  assert.ok(text.includes('ob name text hymn imagery verdict line from text "/^\\\\s*(?:HIGH|MID)\\\\b/i" be resemble then'));
  assert.ok(text.includes('ob name text hymn communal voice verdict line from text "/^\\\\s*(?:HIGH|MID)\\\\b/i" be resemble then'));
  assert.ok(text.includes('ob name text hymn source thrust verdict line from text "/^\\\\s*(?:HIGH|MID)\\\\b/i" be resemble then'));

  assert.match(text, /su name hymn hook fallback to name text hook out be ceremony def/);
  assert.match(text, /su name hymn hook fallback stage to name text hook out be hymn hook fallback do/);
  assert.match(text, /ob name text hymn hook candidates raw out by wo newline to name vec text hymn hook fallback vec be distribute do/);
  assert.match(text, /su name hymn hook fallback first stage ob name hymn hook fallback vec at num 0 be read to name text hook out do/);
});
