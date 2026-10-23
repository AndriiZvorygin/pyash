import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import {
  decodeCodelet,
  executeCodelets,
  lowerSentence
} from "../program/library/vliw/index.mjs";

const cases = [
  ["subtract", "ob num 9 from num 4 be subtract do", 5, 0xabd2],
  ["multiply", "ob num 3 with num 4 be multiply do", 12, 0xec90],
  ["divide", "ob num 8 with num 2 be divide do", 4, 0x8893],
  ["xor", "ob num 7 to num 3 be xor do", 4, 0xa810]
];

test("numeric arithmetic lowers with the legacy fixed-slot shape", async () => {
  for (const [verb, source, result, operatorWord] of cases) {
    const sentence = parse(source);
    const [codelet] = lowerSentence(sentence);
    assert.deepEqual(Array.from(codelet.words.slice(0, 9)), [
      0x0149, 0x881d, sentence.ob.num, 0x287e, 0x881d,
      sentence.to?.num ?? sentence.from?.num ?? sentence.with?.num, 0x245e,
      operatorWord, 0x295e
    ]);
    const decoded = decodeCodelet(codelet.words);
    assert.equal(decoded.semantic, "numeric-arithmetic");
    assert.equal(decoded.sentence.be, verb);
    const [out] = await executeCodelets([codelet]);
    assert.deepEqual(out, {
      su: { name: "result" },
      ob: { num: result },
      be: "number",
      mood: "ya"
    });
  }
});

test("numeric arithmetic preserves legacy saturation and integer division", async () => {
  const [subtraction] = lowerSentence(parse("ob num 2 from num 9 be subtract do"));
  const [division] = lowerSentence(parse("ob num 5 with num 2 be divide do"));
  assert.deepEqual(await executeCodelets([subtraction, division]), [
    { su: { name: "result" }, ob: { num: 0 }, be: "number", mood: "ya" },
    { su: { name: "result" }, ob: { num: 2 }, be: "number", mood: "ya" }
  ]);
});

test("numeric arithmetic rejects division by zero during execution", async () => {
  const [codelet] = lowerSentence(parse("ob num 8 with num 0 be divide do"));
  await assert.rejects(() => executeCodelets([codelet]), (error) => error.code === "division-by-zero");
});

test("numeric arithmetic keeps named stateful forms explicit", () => {
  assert.throws(
    () => lowerSentence(parse("ob num 2 from name total be subtract do")),
    (error) => error.code === "unsupported-sentence"
  );
});

test("vocabulary-only remains stays explicitly unsupported", () => {
  assert.throws(
    () => lowerSentence(parse("ob num 9 from num 4 be remains do")),
    (error) => error.code === "unsupported-sentence"
  );
});
