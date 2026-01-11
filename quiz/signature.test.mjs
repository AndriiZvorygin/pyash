import test from "node:test";
import assert from "node:assert/strict";

import { deriveSignatureFromCall, joinSignatureWords, makeSignatureWords } from "../program/bridge/signature.mjs";
import { parse } from "../program/understand/index.mjs";

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
      { case: "ob", typeWords: [" num "] }
    ]
  });

  assert.deepEqual(words, ["be", "twice crescent", "ob", "num"]);
});

test("joinSignatureWords renders a space-joined key", () => {
  const words = ["be", "add", "ob", "num", "to", "name", "num"];
  assert.equal(joinSignatureWords(words), "be plus ob num to name num");
});

test("missing type words throws", () => {
  assert.throws(
    () => makeSignatureWords({ be: "add", cases: [{ case: "ob", typeWords: [] }] }),
    /needs at least one type word/
  );
});

test("deriveSignatureFromCall builds inline produce signature (vec ob + by)", () => {
  const sentence = {
    mood: "do",
    be: "produce",
    ob: { ve: { type: "num", values: [1, 2, 3] } },
    by: { ve: { type: "num", values: [4, 5, 6] } },
    to: { name: "z" }
  };

  const sig = deriveSignatureFromCall(sentence);

  assert.deepEqual(sig, [
    "be", "produce",
    "by", "vec", "num",
    "ob", "vec", "num",
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
      return { ob: { ve: { type: "num", values: [1, 2, 3] } } };
    }
    if (name === "z") {
      return { ob: { num: 0 } };
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
    ob: { name: "input" },
    fromstate: { name: "pyash" },
    become: { name: "JSON" },
    to: { name: "output" }
  };

  const remember = name => {
    if (name === "input" || name === "pyash" || name === "JSON" || name === "output") {
      return { ob: { text: `${name}-text` } };
    }
    return undefined;
  };

  const sig = deriveSignatureFromCall(sentence, { remember });

  assert.deepEqual(sig, [
    "be", "understand",
    "become", "name", "JSON",
    "fromstate", "name", "pyash",
    "ob", "name", "text",
    "to", "name", "text"
  ]);
});

test("deriveSignatureFromCall defaults unknown name to name num", () => {
  const sentence = {
    mood: "do",
    be: "add",
    ob: { name: "lhs" },
    to: { name: "dest" }
  };

  const sig = deriveSignatureFromCall(sentence, { remember: () => undefined });

  assert.deepEqual(sig, [
    "be", "add",
    "ob", "name", "num",
    "to", "name", "num"
  ]);
});

test("deriveSignatureFromCall infers mind and text for write with literal prompt", () => {
  const sentence = {
    mood: "do",
    be: "write",
    ob: { name: "do you like life?" },
    for: { name: "generator" },
    to: { name: "output" }
  };

  const remember = name => (name === "generator" ? { be: "mind" } : undefined);

  const sig = deriveSignatureFromCall(sentence, { remember });

  assert.deepEqual(sig, [
    "be", "write",
    "for", "name", "mind",
    "ob", "text",
    "to", "text"
  ]);
});

test("deriveSignatureFromCall throws when a case lacks type words", () => {
  const sentence = { mood: "do", be: "add", ob: {}, to: { name: "z" } };

  assert.throws(
    () => deriveSignatureFromCall(sentence),
    /Cannot derive/
  );
});

test("deriveSignatureFromCall handles add with inline number + target name", () => {
  const sentence = { mood: "do", be: "add", ob: { num: 2 }, to: { name: "acc" } };

  const sig = deriveSignatureFromCall(sentence);

  assert.deepEqual(sig, [
    "be", "add",
    "ob", "num",
    "to", "name", "num"
  ]);
});

test("deriveSignatureFromCall handles invert with named source resolved from memory", () => {
  const sentence = { mood: "do", be: "invert", ob: { name: "x" }, to: { name: "dst" } };
  const remember = name => (name === "x" ? { ob: { num: 7 } } : undefined);

  const sig = deriveSignatureFromCall(sentence, { remember });

  assert.deepEqual(sig, [
    "be", "invert",
    "ob", "name", "num",
    "to", "name", "num"
  ]);
});

test("deriveSignatureFromCall handles exponential with inline base/exponent", () => {
  const sentence = { mood: "do", be: "exponential", ob: { num: 2 }, from: { num: 3 }, to: { name: "dst" } };

  const sig = deriveSignatureFromCall(sentence);

  assert.deepEqual(sig, [
    "be", "exponential",
    "from", "num",
    "ob", "num",
    "to", "name", "num"
  ]);
});

test("deriveSignatureFromCall includes at-case for vector element read", () => {
  const sentence = parse("ob name doors via space num 2 be read to name picked do");
  const sig = deriveSignatureFromCall(sentence, { remember: () => null });
  assert.deepEqual(sig, [
    "be", "read",
    "at", "num",
    "ob", "name", "num",
    "to", "name", "num"
  ]);
});

test("deriveSignatureFromCall infers vec type for at-case when vector exists", () => {
  const remember = name => (name === "doors" ? { be: "vector", ob: { ve: { type: "text", values: [0, 1, 0] } } } : null);
  const sentence = parse("ob name doors via space num 2 be read to name picked do");
  const sig = deriveSignatureFromCall(sentence, { remember });
  assert.deepEqual(sig, [
    "be", "read",
    "at", "num",
    "ob", "name", "vec", "text",
    "to", "name", "num"
  ]);
});

test("deriveSignatureFromCall skips undefined cases", () => {
  const sentence = {
    mood: "do",
    be: "espeak say",
    ob: { text: "hello" },
    to: { name: "result", nameTypeWords: ["text"] },
    from: undefined
  };
  assert.doesNotThrow(() => deriveSignatureFromCall(sentence));
});

test("deriveSignatureFromCall handles multiply with named operands from memory", () => {
  const sentence = { mood: "do", be: "multiply", from: { name: "lhs" }, by: { name: "rhs" }, to: { name: "dst" } };
  const remember = name => {
    if (name === "lhs" || name === "rhs") return { ob: { num: 2 } };
    if (name === "dst") return { ob: { num: 0 } };
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

test("deriveSignatureFromCall handles divide with inline ob and by name", () => {
  const sentence = { mood: "do", be: "divide", ob: { num: 10 }, by: { name: "rhs" }, to: { name: "dst" } };
  const remember = name => (name === "rhs" ? { ob: { num: 2 } } : undefined);

  const sig = deriveSignatureFromCall(sentence, { remember });

  assert.deepEqual(sig, [
    "be", "divide",
    "by", "name", "num",
    "ob", "num",
    "to", "name", "num"
  ]);
});

test("deriveSignatureFromCall handles subtract with ob num and from name", () => {
  const sentence = { mood: "do", be: "subtract", ob: { num: 3 }, from: { name: "collector" } };
  const remember = name => (name === "collector" ? { ob: { num: 10 } } : undefined);

  const sig = deriveSignatureFromCall(sentence, { remember });

  assert.deepEqual(sig, [
    "be", "subtract",
    "from", "name", "num",
    "ob", "num"
  ]);
});
