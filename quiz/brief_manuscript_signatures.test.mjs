import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";
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
  assert.match(text, /manuscript fact one write stage .* by num 0 atmost num 72 be write do/);
  assert.match(text, /manuscript fact one verify stage be verify as wo word count atleast num 20 atmost num 34/);
  assert.match(text, /su name manuscript fact one retry fromindex num 0 toindex num 0 be ceremony def/);
  assert.match(text, /manuscript fact one verify retry stage be verify as wo word count atleast num 20 atmost num 34/);
  assert.match(text, /fromindex num 1 toindex num 3 be manuscript fact one retry do/);
  assert.doesNotMatch(text, /manuscript fact one verify retry first stage/);
  assert.match(text, /manuscript fact two write stage .* by num 0 atmost num 72 be write do/);
  assert.match(text, /manuscript fact two verify stage be verify as wo word count atleast num 20 atmost num 34/);
  assert.match(text, /su name manuscript fact two retry fromindex num 0 toindex num 0 be ceremony def/);
  assert.match(text, /manuscript fact two verify retry stage be verify as wo word count atleast num 20 atmost num 34/);
  assert.match(text, /fromindex num 1 toindex num 3 be manuscript fact two retry do/);
  assert.doesNotMatch(text, /manuscript fact two verify retry first stage/);
  assert.match(text, /manuscript uplift write stage .* by num 0 atmost num 120 be write do/);
  assert.match(text, /manuscript uplift verify stage be verify as wo word count atleast num 18 atmost num 40/);
  assert.match(text, /su name manuscript uplift retry fromindex num 0 toindex num 0 be ceremony def/);
  assert.match(text, /manuscript uplift retry write stage .* by num 0 atmost num 64 be write do/);
  assert.match(text, /manuscript uplift verify retry stage be verify as wo word count atleast num 18 atmost num 40/);
  assert.match(text, /fromindex num 1 toindex num 3 be manuscript uplift retry do/);
  assert.doesNotMatch(text, /manuscript uplift verify retry first stage/);
  assert.match(text, /manuscript hook verify stage be verify as wo word count atleast num 6 atmost num 9/);
  assert.match(text, /su name manuscript hook retry fromindex num 0 toindex num 0 be ceremony def/);
  assert.match(text, /manuscript hook verify retry stage be verify as wo word count atleast num 6 atmost num 9/);
  assert.match(text, /fromindex num 1 toindex num 3 be manuscript hook retry do/);
  assert.doesNotMatch(text, /manuscript hook verify retry first stage/);
  assert.match(text, /manuscript total verify stage be verify as wo word count atleast num 70 atmost num 110/);
  assert.match(text, /su name manuscript total retry fromindex num 0 toindex num 0 be ceremony def/);
  assert.match(text, /manuscript total retry verify stage be verify as wo word count atleast num 70 atmost num 110/);
  assert.match(text, /fromindex num 1 toindex num 3 be manuscript total retry do/);
  assert.doesNotMatch(text, /manuscript total retry first verify stage/);
  assert.match(text, /brief video script source thrust verify prompt ob text quoted\.text\.Good\. Here is a much cleaner rubric/);
  assert.match(text, /manuscript source thrust write stage .* by num 0 atmost num 12 be write do/);
  assert.match(text, /manuscript source thrust verdict tail stage ob name text manuscript source thrust review atmost num 1 to name text manuscript source thrust verdict line be line tail do/);
  assert.match(text, /manuscript source thrust verify stage from text of ob of brief video script source with text of ob of manuscript out to name text manuscript source thrust pass be manuscript source thrust do/);
  assert.match(text, /su name manuscript source thrust retry fromindex num 0 toindex num 0 be ceremony def/);
  assert.match(text, /manuscript source thrust verify retry stage from text of ob of brief video script source with text of ob of manuscript out to name text manuscript source thrust pass be manuscript source thrust do/);
  assert.match(text, /fromindex num 1 toindex num 3 be manuscript source thrust retry do/);
  assert.doesNotMatch(text, /manuscript source thrust verify retry first stage/);
  assert.match(text, /manuscript source thrust guarantee stage ob bool lie fromtext text "manuscript source thrust defective" be guarantee do/);
  assert.match(text, /be depart do/);
});
