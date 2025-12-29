import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { deriveSignatureFromCall, joinSignatureWords } from "../program/bridge/signature.mjs";

test("vyah aspect participates in signature derivation", () => {
  const sentence = parse("ob num 1 vyah cancel be add do");
  const sig = deriveSignatureFromCall(sentence);
  assert.equal(joinSignatureWords(sig), "be add ob num vyah cancel");
});

test("vyah defaults to do when aspect missing", () => {
  const sentence = parse("ob num 1 vyah sloh be add do");
  const sig = deriveSignatureFromCall(sentence);
  assert.equal(joinSignatureWords(sig), "be add ob num vyah eval");
});

test("vyah rejects multiple aspect modifiers", () => {
  const sentence = parse("ob num 1 vyah cancel start be add do");
  assert.throws(() => deriveSignatureFromCall(sentence), /vyah allows at most one aspect/);
});
