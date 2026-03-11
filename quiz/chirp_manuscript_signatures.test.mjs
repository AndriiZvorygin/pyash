import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";
import { deriveSignatureFromCall, joinSignatureWords, lookupSignature } from "../program/bridge/signature.mjs";

test("chirp manuscript module registers both chirp manuscript signatures and as-wo alias", async () => {
  forget();
  await interpret(parse('from filename "./module/chirp_manuscript.pya" to name chirp manuscript be import do'));

  const calls = [
    'su name demo from text "Solon source" to name text post be chirp manuscript do',
    'su name demo from filename "quiz/fixtures/ramblings.txt" to name text post be chirp manuscript do',
    'su name demo from text "Solon source" to name text post be manuscript as wo chirp do',
    'su name demo from filename "quiz/fixtures/ramblings.txt" to name text post be manuscript as wo chirp do'
  ];

  for (const line of calls) {
    const signature = joinSignatureWords(deriveSignatureFromCall(parse(line)));
    const resolved = lookupSignature(signature);
    assert.ok(resolved, `missing signature: ${signature}`);
  }
});

test("chirp manuscript module exports manuscript alias and manuscript prompts", async () => {
  const text = await fs.readFile("module/chirp_manuscript.pya", "utf8");
  assert.match(text, /exists su name chirp problem prompt ob text quoted\.text\.You are writing candidate problem atoms/);
  assert.match(text, /exists su name chirp cause prompt ob text quoted\.text\.You are writing candidate hidden-cause atoms/);
  assert.match(text, /exists su name chirp insight prompt ob text quoted\.text\.You are writing candidate insight atoms/);
  assert.match(text, /be distribute do/);
  assert.match(text, /be gather do/);
  assert.match(text, /exists su name chirp template prompt ob text quoted\.text\.You are choosing the best evergreen template family for a short chirp manuscript\./);
  assert.match(text, /exists su name chirp draft prompt ob text quoted\.text\.You are writing one chirp manuscript\./);
  assert.match(text, /su name chirp manuscript from text source to name text manuscript out be ceremony def/);
  assert.match(text, /su name chirp manuscript from filename source to name text manuscript out be ceremony def/);
  assert.match(text, /su name manuscript as wo chirp from text source to name text manuscript out be ceremony def/);
  assert.match(text, /su name manuscript as wo chirp from filename source to name text manuscript out be ceremony def/);
  assert.match(text, /exists su name chirp manuscript be export ya/);
  assert.match(text, /exists su name manuscript as wo chirp be export ya/);
});
