import test from "node:test";
import assert from "node:assert/strict";

import { deriveSignatureFromCall, joinSignatureWords, makeSignatureWords } from "../program/bridge/signature.mjs";

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

test("deriveSignatureFromCall builds inline produce signature (vec obj + by)", () => {
  const sentence = {
    mood: "do",
    be: "produce",
    obj: { ve: { type: "num", values: [1, 2, 3] } },
    by: { ve: { type: "num", values: [4, 5, 6] } },
    to: { name: "z" }
  };

  const sig = deriveSignatureFromCall(sentence);

  assert.deepEqual(sig, [
    "be", "produce",
    "by", "vec", "num",
    "obj", "vec", "num",
    "to", "name", "num"
  ]);
});

test("deriveSignatureFromCall uses memory for named vectors in produce", () => {
  const sentence = {
    mood: "do",
    be: "produce",
    from: { name: "lhs" },
    by: { name: "rhs" },
    to: { name: "z" }
  };

  const remember = name => {
    if (name === "lhs" || name === "rhs") {
      return { obj: { ve: { type: "num", values: [1, 2, 3] } } };
    }
    if (name === "z") {
      return { obj: { num: 0 } };
    }
    return undefined;
  };

  const sig = deriveSignatureFromCall(sentence, { remember });

  assert.deepEqual(sig, [
    "be", "produce",
    "by", "name", "vec", "num",
    "from", "name", "vec", "num",
    "to", "name", "num"
  ]);
});

test("deriveSignatureFromCall carries fromstate/become for understand with text types", () => {
  const sentence = {
    mood: "do",
    be: "understand",
    obj: { name: "input" },
    fromstate: { name: "pyash" },
    become: { name: "JSON" },
    to: { name: "output" }
  };

  const remember = name => {
    if (name === "input" || name === "pyash" || name === "JSON" || name === "output") {
      return { obj: { text: `${name}-text` } };
    }
    return undefined;
  };

  const sig = deriveSignatureFromCall(sentence, { remember });

  assert.deepEqual(sig, [
    "be", "understand",
    "become", "name", "text",
    "fromstate", "name", "text",
    "obj", "name", "text",
    "to", "name", "text"
  ]);
});

test("deriveSignatureFromCall defaults unknown name to name num", () => {
  const sentence = {
    mood: "do",
    be: "add",
    obj: { name: "lhs" },
    to: { name: "dest" }
  };

  const sig = deriveSignatureFromCall(sentence, { remember: () => undefined });

  assert.deepEqual(sig, [
    "be", "add",
    "obj", "name", "num",
    "to", "name", "num"
  ]);
});

test("deriveSignatureFromCall throws when a case lacks type words", () => {
  const sentence = { mood: "do", be: "add", obj: {}, to: { name: "z" } };

  assert.throws(
    () => deriveSignatureFromCall(sentence),
    /Cannot derive/
  );
});

test("deriveSignatureFromCall handles add with inline number + target name", () => {
  const sentence = { mood: "do", be: "add", obj: { num: 2 }, to: { name: "acc" } };

  const sig = deriveSignatureFromCall(sentence);

  assert.deepEqual(sig, [
    "be", "add",
    "obj", "num",
    "to", "name", "num"
  ]);
});

test("deriveSignatureFromCall handles invert with named source resolved from memory", () => {
  const sentence = { mood: "do", be: "invert", obj: { name: "x" }, to: { name: "dst" } };
  const remember = name => (name === "x" ? { obj: { num: 7 } } : undefined);

  const sig = deriveSignatureFromCall(sentence, { remember });

  assert.deepEqual(sig, [
    "be", "invert",
    "obj", "name", "num",
    "to", "name", "num"
  ]);
});

test("deriveSignatureFromCall handles exponential with inline number", () => {
  const sentence = { mood: "do", be: "exponential", obj: { num: 3 }, to: { name: "dst" } };

  const sig = deriveSignatureFromCall(sentence);

  assert.deepEqual(sig, [
    "be", "exponential",
    "obj", "num",
    "to", "name", "num"
  ]);
});

test("deriveSignatureFromCall handles multiply with named operands from memory", () => {
  const sentence = { mood: "do", be: "multiply", from: { name: "lhs" }, by: { name: "rhs" }, to: { name: "dst" } };
  const remember = name => {
    if (name === "lhs" || name === "rhs") return { obj: { num: 2 } };
    if (name === "dst") return { obj: { num: 0 } };
    return undefined;
  };

  const sig = deriveSignatureFromCall(sentence, { remember });

  assert.deepEqual(sig, [
    "be", "multiply",
    "by", "name", "num",
    "from", "name", "num",
    "to", "name", "num"
  ]);
});

test("deriveSignatureFromCall handles divide with inline obj and by name", () => {
  const sentence = { mood: "do", be: "divide", obj: { num: 10 }, by: { name: "rhs" }, to: { name: "dst" } };
  const remember = name => (name === "rhs" ? { obj: { num: 2 } } : undefined);

  const sig = deriveSignatureFromCall(sentence, { remember });

  assert.deepEqual(sig, [
    "be", "divide",
    "by", "name", "num",
    "obj", "num",
    "to", "name", "num"
  ]);
});

test("deriveSignatureFromCall handles subtract with obj num and from name", () => {
  const sentence = { mood: "do", be: "subtract", obj: { num: 3 }, from: { name: "collector" } };
  const remember = name => (name === "collector" ? { obj: { num: 10 } } : undefined);

  const sig = deriveSignatureFromCall(sentence, { remember });

  assert.deepEqual(sig, [
    "be", "subtract",
    "from", "name", "num",
    "obj", "num"
  ]);
});
