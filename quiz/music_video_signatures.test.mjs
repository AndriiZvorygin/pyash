import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";
import { deriveSignatureFromCall, joinSignatureWords, lookupSignature } from "../program/bridge/signature.mjs";

test("music video module registers filename signatures", async () => {
  forget();
  await interpret(parse('from filename "./module/music_video.pya" to name music video be import do'));

  const calls = [
    'su name demo from filename "quiz/fixtures/ramblings.txt" be music video do',
    'su name demo from filename "quiz/fixtures/ramblings.txt" to filename "artifacts/video/test.mp4" be music video do',
    'su name demo from filename "quiz/fixtures/ramblings.txt" be music video wide do',
    'su name demo from filename "quiz/fixtures/ramblings.txt" to filename "artifacts/video/test-wide.mp4" be music video wide do'
  ];

  for (const line of calls) {
    const signature = joinSignatureWords(deriveSignatureFromCall(parse(line)));
    const resolved = lookupSignature(signature);
    assert.ok(resolved, `missing signature: ${signature}`);
    assert.ok(String(resolved).includes("music video"), `unexpected target: ${resolved}`);
  }
});
