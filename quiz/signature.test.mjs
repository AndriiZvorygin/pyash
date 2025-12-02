import test from "node:test";
import assert from "node:assert/strict";

import { joinSignatureWords, makeSignatureWords } from "../program/bridge/signature.mjs";

test("makeSignatureWords sorts cases and flattens type words", () => {
  const words = makeSignatureWords({
    be: "neuron",
    cases: {
      to: ["name", "num"],
      from: ["name", "vec", "num"],
      by: "name vec num",
      fromstate: ["num"]
    }
  });

  assert.deepEqual(words, [
    "be", "neuron",
    "by", "name", "vec", "num",
    "from", "name", "vec", "num",
    "fromstate", "num",
    "to", "name", "num"
  ]);
});

test("multi-word verbs and case arrays normalize whitespace", () => {
  const words = makeSignatureWords({
    be: "  twice   crescent ",
    cases: [
      { case: "obj", typeWords: [" num "] }
    ]
  });

  assert.deepEqual(words, ["be", "twice crescent", "obj", "num"]);
});

test("joinSignatureWords renders a space-joined key", () => {
  const words = ["be", "add", "obj", "num", "to", "name", "num"];
  assert.equal(joinSignatureWords(words), "be add obj num to name num");
});

test("missing type words throws", () => {
  assert.throws(
    () => makeSignatureWords({ be: "add", cases: [{ case: "obj", typeWords: [] }] }),
    /needs at least one type word/
  );
});
