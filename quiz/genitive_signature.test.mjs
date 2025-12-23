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

test("genitive tails derive numeric for remains obj/by", () => {
  assert.equal(words("obj num of obj of this by num of fromindex of this be remains do"),
    "be remains by num obj num");
});

test("genitive tail name derives name num for target", () => {
  assert.equal(words("obj num of obj of this to name of this be add do"),
    "be add obj num to name num");
});

test("genitive tail text derives text", () => {
  assert.equal(words("obj text of obj of this be write do"),
    "be write obj text");
});

test("genitive tail vec derives vec", () => {
  const sig = words("obj ve of obj of this to name bucket be read do");
  assert.match(sig, /\bvec\b/);
});
