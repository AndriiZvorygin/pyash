import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/parser/index.mjs";

test("parses quoted text tokens", () => {
  const s = parse('subj name prompt with text "hello world" be topic ya');

  assert.equal(s.mood, "ya");
  assert.equal(s.subj.name, "prompt");
  assert.equal(s.with.text, "hello world");
  assert.equal(s.be, "topic");
});

test("supports escaped quotes inside text", () => {
  const s = parse('subj name note with text "say \\\"hi\\\"" be topic ya');

  assert.equal(s.with.text, 'say "hi"');
});

test("parses minimal declarative sentence", () => {
  const s = parse("subj hello be test ya");

  assert.equal(s.mood, "ya");
  assert.equal(s.subj.name, "hello");
  assert.equal(s.be, "test");
});

test("supports short subj/obj aliases su/ob", () => {
  const s = parse("su hello ob world be test ya");

  assert.equal(s.subj.name, "hello");
  assert.equal(s.obj.name, "world");
});
