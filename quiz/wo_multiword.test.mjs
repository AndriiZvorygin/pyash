import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { deriveSignatureFromCall } from "../program/bridge/signature.mjs";
import { joinSignatureWords } from "../program/bridge/signature/normalize.mjs";

test("wo supports multi-token literals", () => {
  const sentence = parse("fromstate wo markdown plain be read do");
  assert.equal(sentence?.fromstate?.wo, "markdown plain");
  const sigWords = deriveSignatureFromCall(sentence);
  assert.ok(sigWords);
  const signature = joinSignatureWords(sigWords);
  assert.equal(signature, "be read fromstate wo markdown plain");
});
