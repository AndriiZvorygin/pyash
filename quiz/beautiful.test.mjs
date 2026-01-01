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

test("sentenceToPyash prints su only", () => {
  const sentence = {
    mood: "ya",
    su: { name: "a" },
    be: "number"
  };

  const out = sentenceToPyash(sentence);

  assert.equal(out, "su name a be number ya");
});

test("sentenceToPyash prints su + ob", () => {
  const sentence = {
    mood: "ya",
    su: { name: "a" },
    ob: { num: 7 },
    be: "number"
  };

  const out = sentenceToPyash(sentence);

  assert.equal(out, "su name a ob num 7 be number ya");
});

test("sentenceToPyash prints all NP slots correctly", () => {
  const sentence = {
    mood: "do",
    su: { name: "x" },
    ob: { num: 2 },
    from: { num: 3 },
    to: { name: "y" },
    be: "add"
  };

  const out = sentenceToPyash(sentence);

  assert.equal(
    out,
    "su name x ob num 2 from num 3 to name y be add do"
  );
});

test("sentenceToPyash ignores empty fields cleanly", () => {
  const sentence = {
    mood: "que",
    su: { name: "x" },
    be: "number"
    // ob/from/to all missing
  };

  const out = sentenceToPyash(sentence);

  assert.equal(out, "su name x be number que");
});
