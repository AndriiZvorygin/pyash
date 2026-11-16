import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import {
  decodeCodelet,
  executeCodelets,
  lowerSentence
} from "../program/library/vliw/index.mjs";

test("numeric vector arithmetic reuses the legacy vector quote and operand case", async () => {
  const sentence = parse("ob ve num 1 2 3 4 to num 2 be plus do");
  const [codelet] = lowerSentence(sentence);

  assert.deepEqual(Array.from(codelet.words.slice(0, codelet.usedWords)), [
    0x0a41, 0x8a1d, 1, 2, 3, 4, 0x245e, 0x881d, 2, 0x243e, 0x8a64, 0x295e
  ]);
  assert.deepEqual(decodeCodelet(codelet.words).sentence, sentence);
  assert.deepEqual(await executeCodelets([codelet]), [{
    su: { name: "result" },
    ob: { ve: { type: "num", values: [3, 4, 5, 6] } },
    be: "vector",
    mood: "ya"
  }]);
});

test("numeric vector operations preserve scalar arithmetic semantics elementwise", async () => {
  const sources = [
    ["ob ve num 9 4 to num 2 be subtract do", [7, 2]],
    ["ob ve num 3 4 to num 5 be multiply do", [15, 20]],
    ["ob ve num 8 9 with num 2 be divide do", [4, 4]],
    ["ob ve num 7 9 to num 3 be xor do", [4, 10]],
    ["ob ve num 2 3 from num 3 be exponential do", [8, 27]],
    ["ob ve num 9 10 from num 4 be remains do", [1, 2]]
  ];

  for (const [source, values] of sources) {
    const [codelet] = lowerSentence(parse(source));
    const [result] = await executeCodelets([codelet]);
    assert.deepEqual(result.ob.ve.values, values, source);
  }

  const [saturated] = lowerSentence(parse("ob ve num 65535 3 to num 2 be plus do"));
  const [saturatedResult] = await executeCodelets([saturated]);
  assert.deepEqual(saturatedResult.ob.ve.values, [0xffff, 5]);

  const [wideProduct] = lowerSentence(parse("ob ve num 65535 3 to num 65535 be multiply do"));
  const [wideProductResult] = await executeCodelets([wideProduct]);
  assert.deepEqual(wideProductResult.ob.ve.values, [4294836225, 196605]);
});

test("numeric vector arithmetic applies the existing operand case elementwise", async () => {
  const cases = [
    ["ob ve num 1 2 3 4 to ve num 5 6 7 8 be plus do", [6, 8, 10, 12]],
    ["ob ve num 9 8 7 from ve num 2 3 4 be subtract do", [7, 5, 3]],
    ["ob ve num 3 4 with ve num 5 6 be multiply do", [15, 24]],
    ["ob ve num 8 9 with ve num 2 3 be divide do", [4, 3]],
    ["ob ve num 7 9 to ve num 3 4 be xor do", [4, 13]],
    ["ob ve num 2 3 from ve num 3 2 be exponential do", [8, 9]],
    ["ob ve num 20 21 by ve num 4 5 be remains do", [0, 1]]
  ];

  for (const [source, values] of cases) {
    const [codelet] = lowerSentence(parse(source));
    assert.deepEqual(decodeCodelet(codelet.words).sentence, parse(source), source);
    if (source === cases[0][0]) {
      assert.deepEqual(Array.from(codelet.words.slice(0, codelet.usedWords)), [
        0x5041, 0x8a1d, 1, 2, 3, 4, 0x245e, 0x8a1d, 5, 6, 7, 8, 0x243e, 0x8a64, 0x295e
      ]);
    }
    const [result] = await executeCodelets([codelet]);
    assert.deepEqual(result.ob.ve.values, values, source);
  }

  const [wideProduct] = lowerSentence(parse(
    "ob ve num 65535 3 to ve num 65535 65535 be multiply do"
  ));
  const [wideProductResult] = await executeCodelets([wideProduct]);
  assert.deepEqual(wideProductResult.ob.ve.values, [4294836225, 196605]);
});

test("numeric vector-vector arithmetic rejects mismatched or unencodable widths", async () => {
  assert.throws(
    () => lowerSentence(parse("ob ve num 1 2 to ve num 3 4 5 be plus do")),
    (error) => error.code === "unsupported-vector-width"
  );
  assert.throws(
    () => lowerSentence(parse("ob ve num 1 2 3 4 5 to ve num 6 7 8 9 10 be plus do")),
    (error) => error.code === "codelet-overflow"
  );
});

test("numeric vector arithmetic respects fixed and explicit quote widths", async () => {
  const [eight] = lowerSentence(parse("ob ve num 1 2 3 4 5 6 7 8 to num 1 be plus do"));
  assert.equal(eight.usedWords, 16);
  const [eightResult] = await executeCodelets([eight]);
  assert.deepEqual(eightResult.ob.ve.values, [2, 3, 4, 5, 6, 7, 8, 9]);

  const [five] = lowerSentence(parse("ob ve num 1 2 3 4 5 to num 1 be plus do"));
  assert.equal(five.words[1], 0x8e1d);
  assert.equal(five.words[2], 5);
});

test("numeric vector arithmetic rejects widths that cannot fit its sentence", () => {
  assert.throws(
    () => lowerSentence(parse("ob ve num 1 2 3 4 5 6 7 8 9 to num 1 be plus do")),
    (error) => error.code === "codelet-overflow"
  );
});

test("numeric vector division by zero fails instead of returning partial output", async () => {
  const [codelet] = lowerSentence(parse("ob ve num 8 9 with num 0 be divide do"));
  await assert.rejects(
    () => executeCodelets([codelet]),
    (error) => error.code === "division-by-zero"
  );
});
