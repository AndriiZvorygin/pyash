import test from "node:test";
import assert from "node:assert/strict";

import { deriveSignatureFromCall } from "../program/bridge/signature.mjs";
import { parse } from "../program/understand/index.mjs";

function sig(sentence) {
  return deriveSignatureFromCall(sentence, {});
}

function words(s) {
  return sig(parse(s)).join(" ");
}

test("genitive tails derive numeric for remains ob/by", () => {
  assert.equal(words("ob num of ob of this by num of fromindex of this be remains do"),
    "be remains by num ob num");
});

test("genitive tail name derives name num for target", () => {
  assert.equal(words("ob num of ob of this to name of this be plus do"),
    "be plus ob num to name num");
});

test("genitive tail text derives text", () => {
  assert.equal(words("ob text of ob of this be write do"),
    "be write ob text");
});

test("genitive tail vec derives vec", () => {
  const sig = words("ob ve of ob of this to name bucket be read do");
  assert.match(sig, /\bvec\b/);
});
