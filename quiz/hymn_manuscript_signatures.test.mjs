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

test("hymn manuscript module keeps verse chorus bridge staged flow", async () => {
  const text = await fs.readFile("module/hymn_manuscript.pya", "utf8");
  assert.match(text, /exists su name hymn verse one prompt ob text quoted\.text\.You are writing Verse 1/);
  assert.match(text, /exists su name hymn chorus prompt ob text quoted\.text\.You are writing the Chorus/);
  assert.match(text, /exists su name hymn verse two prompt ob text quoted\.text\.You are writing Verse 2/);
  assert.match(text, /exists su name hymn bridge prompt ob text quoted\.text\.You are writing the Bridge/);
  assert.match(text, /su name hymn verse one retry fromindex num 0 toindex num 0 be ceremony def/);
  assert.match(text, /su name hymn chorus retry fromindex num 0 toindex num 0 be ceremony def/);
  assert.match(text, /su name hymn verse two retry fromindex num 0 toindex num 0 be ceremony def/);
  assert.match(text, /su name hymn bridge retry fromindex num 0 toindex num 0 be ceremony def/);
  assert.match(text, /fromindex num 1 toindex num 3 be hymn verse one retry do/);
  assert.match(text, /fromindex num 1 toindex num 3 be hymn chorus retry do/);
  assert.match(text, /fromindex num 1 toindex num 3 be hymn verse two retry do/);
  assert.match(text, /fromindex num 1 toindex num 3 be hymn bridge retry do/);
  assert.match(text, /hymn out begin stage ob text quoted\.text\.Verse 1/);
  assert.match(text, /hymn out chorus one header stage ob text quoted\.text\./);
  assert.match(text, /hymn out bridge header stage ob text quoted\.text\./);
  assert.match(text, /hymn out chorus three stage ob name text chorus out to name hymn out be plus do/);
});
