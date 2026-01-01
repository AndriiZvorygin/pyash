import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { deriveSignatureFromCall } from "../program/bridge/signature.mjs";
import { state } from "../program/bridge/state.mjs";
import { surfaceErrorSentence } from "../program/error.mjs";

test("signature derive error includes filename, line, and at la sentence", async () => {
  const sentence = parse("be espeak say from do");
  state.currentSourceFilename = "example.pya";
  state.currentSourceLine = 1;
  state.currentSourceSentence = sentence;
  try {
    deriveSignatureFromCall({ mood: "do", be: "espeak say", from: null });
    assert.fail("expected signature derive error");
  } catch (err) {
    const surfaced = surfaceErrorSentence(err?.sentence ?? err);
    assert.equal(surfaced?.su?.name, "signature derive");
    assert.deepEqual(surfaced?.from, { filename: "example.pya" });
    assert.deepEqual(surfaced?.by, { num: 1 });
    assert.ok(surfaced?.at?.la, "expected at la sentence");
    assert.equal(surfaced.at.la.be, "espeak say");
  } finally {
    state.currentSourceFilename = null;
    state.currentSourceLine = null;
    state.currentSourceSentence = null;
  }
});
