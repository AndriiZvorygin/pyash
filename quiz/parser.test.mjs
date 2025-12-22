import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";

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

test("parses vector literals with element type", () => {
  const sNum = parse("obj ve num 1 2 3 be topic ya");
  assert.deepEqual(sNum.obj.ve, { type: "num", values: [1, 2, 3] });

  const sText = parse('obj ve text "apple" "red maple" "pine" be topic ya');
  assert.deepEqual(sText.obj.ve, { type: "text", values: ["apple", "red maple", "pine"] });

  const sLetters = parse("obj ve letter a b c d be topic ya");
  assert.deepEqual(sLetters.obj.ve, { type: "letter", values: ["a", "b", "c", "d"] });
});

test("parses typed name in name <type> <literal> order", () => {
  const s = parse("subj name alpha to name text line be topic ya");

  assert.equal(s.to.name, "line");
  assert.deepEqual(s.to.nameTypeWords, ["text"]);
});
