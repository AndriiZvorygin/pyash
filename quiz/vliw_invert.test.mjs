import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import {
  decodeCodelet,
  executeCodelets,
  lowerSentence
} from "../program/library/vliw/index.mjs";

// The legacy invert codelet carries the value in the accusative phrase and
// the bound it is inverted about in the dative phrase:
//   0149 881D 3333 245E EA30 225E 207E AAD2 295E
// Pyash inverts a number by negating it, so the bound is fixed at zero and
// the legacy phrase shape is kept.
const LEGACY_INVERT_WORDS = [
  0x0149, 0x881d, 0x3333, 0x245e, 0x881d, 0x0000, 0x207e, 0xaad2, 0x295e
];

test("invert lowers with the legacy invert codelet shape", async () => {
  const sentence = parse("ob num 5 be invert do");
  const [codelet] = lowerSentence(sentence);

  assert.deepEqual(Array.from(codelet.words.slice(0, 9)), [
    ...LEGACY_INVERT_WORDS.slice(0, 2),
    5,
    ...LEGACY_INVERT_WORDS.slice(3)
  ]);
  assert.equal(codelet.usedWords, 9);

  const decoded = decodeCodelet(codelet.words);
  assert.equal(decoded.semantic, "numeric-invert");
  assert.deepEqual(decoded.sentence, {
    mood: "do",
    be: "invert",
    ob: { num: 5 }
  });

  const [out] = await executeCodelets([codelet]);
  assert.deepEqual(out, {
    su: { name: "result" },
    ob: { num: -5 },
    be: "number",
    mood: "ya"
  });
});

test("invert keeps the zero tail and rejects a non-zero bound", () => {
  const [codelet] = lowerSentence(parse("ob num 7 be invert do"));
  assert.deepEqual(Array.from(codelet.words.slice(9)), new Array(7).fill(0));

  const bounded = Uint16Array.from(codelet.words);
  bounded[5] = 0x0009;
  assert.throws(
    () => decodeCodelet(bounded),
    (error) => error.code === "unsupported-sentence"
  );
});

test("invert rejects a named bound the legacy supports but Pyash does not", () => {
  const named = Uint16Array.from([
    0x0149, 0x881d, 0x3333, 0x245e, 0xea30, 0x225e, 0x207e, 0xaad2, 0x295e,
    0x0000, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000
  ]);
  assert.throws(
    () => decodeCodelet(named),
    (error) => error.code === "unsupported-sentence"
  );
});

test("invert rejects named stateful forms explicit", () => {
  assert.throws(
    () => lowerSentence(parse("ob name total be invert do")),
    (error) => error.code === "unsupported-sentence"
  );
});
