import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { sentenceToPyash } from "../program/beautiful.mjs";
import { deriveSignatureFromCall } from "../program/bridge/signature.mjs";
import { splitSentences } from "../program/library/sentenceSplitter.mjs";

test("subordinate clause parses into la sentence object", () => {
  const sentence = parse("ob la su name clause ob name example ko be evoke ya");
  assert.equal(sentence?.ob?.la?.su?.name, "clause");
  assert.equal(sentence?.ob?.la?.ob?.name, "example");
  assert.equal(sentence?.be, "evoke");
});

test("subordinate clause allows mood inside", () => {
  const sentence = parse("ob la su name clause ob name example be text ya ko be evoke ya");
  assert.equal(sentence?.ob?.la?.mood, "ya");
  assert.equal(sentence?.ob?.la?.be, "text");
});

test("subordinate clause formats with la/ko", () => {
  const sentence = parse("ob la su name clause ob name example ko be evoke ya");
  const rendered = sentenceToPyash(sentence);
  assert.match(rendered, /la su name clause ob name example ko/);
});

test("subordinate clause participates in signature derivation", () => {
  const sentence = parse("ob la su name clause ob name example ko be evoke ya");
  const sig = deriveSignatureFromCall(sentence, { remember: () => null });
  assert.ok(sig.includes("la"), "signature should include la type");
});

test("sentence splitter ignores moods inside clauses", () => {
  const text = "ob la su name clause be text ya ko be evoke ya su name next be text ya";
  const sentences = splitSentences(text);
  assert.equal(sentences.length, 2);
  assert.equal(sentences[0], "ob la su name clause be text ya ko be evoke ya");
});
