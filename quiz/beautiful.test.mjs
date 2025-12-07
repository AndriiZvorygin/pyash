// test/pretty.test.mjs
import test from "node:test";
import assert from "node:assert/strict";

import { npToPyash, sentenceToPyash } from "../program/beautiful.mjs";

test("npToPyash renders {name: X}", () => {
  assert.equal(npToPyash({ name: "collector" }), "name collector");
});

test("npToPyash renders {num: N}", () => {
  assert.equal(npToPyash({ num: 42 }), "num 42");
});

test("npToPyash gracefully handles empty NP", () => {
  assert.equal(npToPyash({}), "");
});

test("sentenceToPyash prints subj only", () => {
  const sentence = {
    mood: "ya",
    subj: { name: "a" },
    be: "number"
  };

  const out = sentenceToPyash(sentence);

  assert.equal(out, "subj name a be number ya");
});

test("sentenceToPyash prints subj + obj", () => {
  const sentence = {
    mood: "ya",
    subj: { name: "a" },
    obj: { num: 7 },
    be: "number"
  };

  const out = sentenceToPyash(sentence);

  assert.equal(out, "subj name a obj num 7 be number ya");
});

test("sentenceToPyash prints all NP slots correctly", () => {
  const sentence = {
    mood: "do",
    subj: { name: "x" },
    obj: { num: 2 },
    from: { num: 3 },
    to: { name: "y" },
    be: "add"
  };

  const out = sentenceToPyash(sentence);

  assert.equal(
    out,
    "subj name x obj num 2 to name y be add from num 3 do"
  );
});

test("sentenceToPyash ignores empty fields cleanly", () => {
  const sentence = {
    mood: "que",
    subj: { name: "x" },
    be: "number"
    // obj/from/to all missing
  };

  const out = sentenceToPyash(sentence);

  assert.equal(out, "subj name x be number que");
});
