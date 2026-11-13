import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { parse as parseRaw } from "../program/understand/parse_tokens.mjs";

test("parses quoted text tokens", () => {
  const s = parse('exists su name prompt with text "hello world" be topic ya');

  assert.equal(s.mood, "ya");
  assert.equal(s.su.name, "prompt");
  assert.equal(s.with.text, "hello world");
  assert.equal(s.be, "topic");
});

test("supports escaped quotes inside text", () => {
  const s = parse('exists su name note with text "say \\\"hi\\\"" be topic ya');

  assert.equal(s.with.text, 'say "hi"');
});

test("decodes JSON escapes in quoted text tokens", () => {
  const s = parse('exists su name note with text "line one\\nline two\\t\\u263A" be topic ya');

  assert.equal(s.with.text, "line one\nline two\t☺");
});

test("includes the exact source and clause position when a subordinate clause is unclosed", () => {
  const source = 'la su name broken clause be text ya';

  for (const parser of [parse, parseRaw]) {
    assert.throws(() => parser(source), (error) => {
      assert.equal(error.message, "subordinate clause missing ko");
      assert.deepEqual(error.parseDiagnostic, {
        kind: "unclosed-subordinate-clause",
        sourceText: source,
        parseAttempt: "primary",
        clauseStartIndex: 0,
        unmatchedDepth: 1,
        clauseTokenCount: 6
      });
      return true;
    });
  }
});

test("parses minimal declarative sentence", () => {
  const s = parse("su hello be test ya");

  assert.equal(s.mood, "ya");
  assert.equal(s.su.name, "hello");
  assert.equal(s.be, "test");
});

test("supports short su/ob aliases su/ob", () => {
  const s = parse("su hello ob world be test ya");

  assert.equal(s.su.name, "hello");
  assert.equal(s.ob.name, "world");
});

test("parses vector literals with element type", () => {
  const sNum = parse("ob ve num 1 2 3 be topic ya");
  assert.deepEqual(sNum.ob.ve, { type: "num", values: [1, 2, 3] });

  const sText = parse('ob ve text "apple" "red maple" "pine" be topic ya');
  assert.deepEqual(sText.ob.ve, { type: "text", values: ["apple", "red maple", "pine"] });

  const sLetters = parse("ob ve letter a b c d be topic ya");
  assert.deepEqual(sLetters.ob.ve, { type: "letter", values: ["a", "b", "c", "d"] });
});

test("parses typed name in name <type> <literal> order", () => {
  const s = parse("exists su name alpha to name text line be topic ya");

  assert.equal(s.to.name, "line");
  assert.deepEqual(s.to.nameTypeWords, ["text"]);
});

test("ignores a genitive chain without a role slot", () => {
  assert.deepEqual(parse("text of foo ya"), { mood: "ya" });
  assert.deepEqual(parse("ve of foo ya"), { mood: "ya" });
});

test("keeps genitive chains attached to their role slot", () => {
  assert.deepEqual(parse("ob num of ob of this be number ya"), {
    mood: "ya",
    ob: { genitive: { chain: ["this", "ob", "num"] } },
    be: "number"
  });
});

test("parses itinerary typed name in name <type> <literal> order", () => {
  const s = parse("from name itinerary teaching cuts be topic ya");
  assert.equal(s.from.name, "teaching cuts");
  assert.deepEqual(s.from.nameTypeWords, ["itinerary"]);
});

test("parses photographs typed name in name <type> <literal> order", () => {
  const s = parse("to name photographs photos be topic ya");
  assert.equal(s.to.name, "photos");
  assert.deepEqual(s.to.nameTypeWords, ["photographs"]);
});

test("parses bool and hollow literals", () => {
  const sBool = parse("ob bool truth be topic ya");
  assert.equal(sBool.ob.boolean, true);

  const sHollow = parse("ob hollow be topic ya");
  assert.equal(sHollow.ob.hollow, true);
});

test("parses hollow vector literal", () => {
  const s = parse("ob ve hollow be topic ya");
  assert.deepEqual(s.ob.ve, { type: "hollow", values: [] });
});
