import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { deriveSignatureFromCall, joinSignatureWords } from "../program/bridge/signature.mjs";

test("vyah aspect participates in signature derivation", () => {
  const sentence = parse("ob num 1 vyah cancel be plus do");
  const sig = deriveSignatureFromCall(sentence);
  assert.equal(joinSignatureWords(sig), "be plus ob num vyah cancel");
});

test("vyah defaults to do when aspect missing", () => {
  const sentence = parse("ob num 1 vyah success be plus do");
  const sig = deriveSignatureFromCall(sentence);
  assert.equal(joinSignatureWords(sig), "be plus ob num vyah eval");
});

test("vyah rejects multiple aspect modifiers", () => {
  const sentence = parse("ob num 1 vyah cancel start be plus do");
  assert.throws(() => deriveSignatureFromCall(sentence), /vyah allows at most one aspect/);
});

test("vyah aspect alias cron normalizes to habit in signature", () => {
  const sentence = parse("ob num 1 vyah cron be plus do");
  const sig = deriveSignatureFromCall(sentence);
  assert.equal(joinSignatureWords(sig), "be plus ob num vyah habit");
});
