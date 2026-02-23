import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";
import { deriveSignatureFromCall, joinSignatureWords, lookupSignature, lookupSignatureHandler } from "../program/bridge/signature.mjs";

test("brief video module registers filename signatures", async () => {
  forget();
  await interpret(parse('from filename "./module/brief_video.pya" to name brief video be import do'));

  const calls = [
    'su name demo from filename "quiz/fixtures/ramblings.txt" be brief video do',
    'su name demo from filename "quiz/fixtures/ramblings.txt" to filename "artifacts/video/test.mp4" be brief video do'
  ];

  for (const line of calls) {
    const signature = joinSignatureWords(deriveSignatureFromCall(parse(line)));
    const resolved = lookupSignature(signature);
    assert.ok(resolved, `missing signature: ${signature}`);
    assert.ok(String(resolved).endsWith("brief video"), `unexpected target: ${resolved}`);
  }
});

test("teaching video verbs accept vector dependency forms", async () => {
  forget();
  await interpret(parse('su name init ob text "ready" be write do'));

  const lines = [
    'su name demo from ve name itinerary teaching cuts name photographs photos fromstate wo itinerary become wo video to filename "artifacts/video/test.mp4" be concatenate do',
    'su name demo from ve name hear platform name concatenate platform fromstate wo srt with name concatenate platform to filename "artifacts/video/test-footnote.mp4" as wo wordflow become wo video be footnote do'
  ];

  for (const line of lines) {
    const signature = joinSignatureWords(deriveSignatureFromCall(parse(line)));
    const handler = lookupSignatureHandler(signature);
    assert.equal(typeof handler, "function", `missing signature handler: ${signature}`);
  }
});
