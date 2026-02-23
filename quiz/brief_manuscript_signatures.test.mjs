import test from "node:test";
import assert from "node:assert/strict";

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
