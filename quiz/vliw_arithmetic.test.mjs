import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parse } from "../program/understand/index.mjs";
import {
  decodeCodelet,
  executeCodelets,
  lowerSentence,
  renderPyashCodelet
} from "../program/library/vliw/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, remember } from "../program/remember/index.mjs";
import { lookupLegacyName } from "../program/library/vliw/quotes.mjs";

const cases = [
  ["subtract", "ob num 9 from num 4 be subtract do", 5, 0xabd2],
  ["multiply", "ob num 3 with num 4 be multiply do", 12, 0xec90],
  ["divide", "ob num 8 with num 2 be divide do", 4, 0x8893],
  ["xor", "ob num 7 to num 3 be xor do", 4, 0xa810]
];

test("numeric arithmetic preserves its operand case in the codelet", async () => {
  for (const [verb, source, result, operatorWord] of cases) {
    const sentence = parse(source);
    const [codelet] = lowerSentence(sentence);
    assert.deepEqual(Array.from(codelet.words.slice(0, 9)), [
      0x0149, 0x881d, sentence.ob.num, 0x245e, 0x881d,
      sentence.to?.num ?? sentence.from?.num ?? sentence.with?.num, roleWord(sentence),
      operatorWord, 0x295e
    ]);
    const decoded = decodeCodelet(codelet.words);
    assert.equal(decoded.semantic, "numeric-arithmetic");
    assert.equal(decoded.sentence.be, verb);
    assert.deepEqual(decoded.sentence, sentence);
    const [out] = await executeCodelets([codelet]);
    assert.deepEqual(out, {
      su: { name: "result" },
      ob: { num: result },
      be: "number",
      mood: "ya"
    });
  }
});

test("scalar f32 arithmetic lowers, decodes, and executes with binary32 rounding", async () => {
  for (const [source, expected, operatorWord] of [
    ["ob num 0.1 to num 0.2 be plus do", Math.fround(Math.fround(0.1) + Math.fround(0.2)), 0x8a64],
    ["ob num 5.5 from num 2 be subtract do", Math.fround(Math.fround(5.5) - Math.fround(2)), 0xabd2],
    ["ob num 1.5 with num 2 be multiply do", Math.fround(Math.fround(1.5) * Math.fround(2)), 0xec90],
    ["ob num 1.5 with num 4 be divide do", Math.fround(Math.fround(1.5) / Math.fround(4)), 0x8893]
  ]) {
    const sentence = parse(source);
    const [codelet] = lowerSentence(sentence);
    const decoded = decodeCodelet(codelet.words);
    assert.equal(decoded.semantic, "numeric-arithmetic");
    assert.equal(decoded.sentence.be, sentence.be);
    assert.equal(decoded.sentence.ob.num, Math.fround(sentence.ob.num));
    assert.equal(codelet.words[1], 0xd01d, "float ob uses legacy float sort, f32 width");
    assert.equal(codelet.words[5], 0xd01d, "mixed operands are promoted to f32");
    assert.equal(codelet.words[9], operatorWord);
    const [result] = await executeCodelets([codelet]);
    assert.deepEqual(result, {
      su: { name: "result" },
      ob: { num: expected },
      be: "number",
      mood: "ya"
    });
  }
});

test("numeric literals retain f32 values and reject non-finite float arithmetic", async () => {
  const inline = lowerSentence(parse("ob num 0.125 be number ya"))[0];
  assert.deepEqual(decodeCodelet(inline.words).sentence.ob, { num: 0.125 });

  const literal = lowerSentence(parse("su name weight ob num 0.125 be number ya"))[0];
  const decodedLiteral = decodeCodelet(literal.words);
  assert.equal(decodedLiteral.semantic, "named-literal");
  assert.deepEqual(decodedLiteral.sentence.ob, { num: 0.125 });
  assert.deepEqual(await executeCodelets([literal]), [
    { mood: "ya", su: { name: "weight" }, ob: { num: 0.125 }, be: "number" }
  ]);

  const negativeZero = lowerSentence(parse("ob num -0 be number ya"))[0];
  assert.equal(negativeZero.words[1], 0xd01d);
  assert.ok(Object.is(decodeCodelet(negativeZero.words).sentence.ob.num, -0));

  const [division] = lowerSentence(parse("ob num 1.5 with num 0 be divide do"));
  await assert.rejects(
    () => executeCodelets([division]),
    (error) => error.code === "division-by-zero"
  );
  assert.throws(
    () => lowerSentence(parse("ob num 1e100 with num 2 be multiply do")),
    (error) => error.code === "non-finite-float"
  );
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

test("numeric exponential and remainder preserve their source operand case", async () => {
  const cases = [
    ["exponential", "ob num 2 from num 10 be exponential do", 1024, 0x8c29],
    ["remains", "ob num 9 from num 4 be remains do", 1, 0xe82a]
  ];

  for (const [verb, source, result, operatorWord] of cases) {
    const sentence = parse(source);
    const [codelet] = lowerSentence(sentence);
    assert.deepEqual(Array.from(codelet.words.slice(0, 9)), [
      0x0149, 0x881d, sentence.ob.num, 0x245e, 0x881d,
      sentence.from?.num, roleWord(sentence),
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

test("numeric arithmetic saturates exponential and rejects a zero remainder", async () => {
  const [exponential] = lowerSentence(parse("ob num 2 from num 20 be exponential do"));
  const [remainder] = lowerSentence(parse("ob num 9 from num 0 be remains do"));

  assert.deepEqual(await executeCodelets([exponential]), [
    { su: { name: "result" }, ob: { num: 0xffff }, be: "number", mood: "ya" }
  ]);
  await assert.rejects(
    () => executeCodelets([remainder]),
    (error) => error.code === "division-by-zero"
  );
});

test("numeric arithmetic keeps named stateful forms explicit", () => {
  const sentence = parse("ob num 2 from name collector be subtract do");
  const [codelet] = lowerSentence(sentence);
  const collector = Number.parseInt(lookupLegacyName("collector").hnuc, 16);
  assert.deepEqual(Array.from(codelet.words.slice(0, 9)), [
    0x0149, 0x881d, 2, 0x245e, 0x225e, collector, 0x313e, 0xabd2, 0x295e
  ]);
  assert.equal(codelet.words[3], 0x245e, "ob is encoded as accusative_case_");
  assert.deepEqual(Array.from(codelet.words.slice(4, 7)), [
    0x225e,
    collector,
    0x313e
  ], "from operand is encoded as name type, value, source case");
  assert.deepEqual(decodeCodelet(codelet.words).sentence, sentence);
});

test("vocabulary-only remains stays explicitly unsupported", () => {
  assert.throws(
    () => lowerSentence(parse("ob num 9 from name total be remains do")),
    (error) => error.code === "unsupported-sentence"
  );
});

function roleWord(sentence) {
  if (sentence.from !== undefined) return 0x313e;
  if (sentence.to !== undefined) return 0x243e;
  if (sentence.with !== undefined) return 0x490f;
  if (sentence.by !== undefined) return 0x287e;
  assert.fail("test sentence has no operand case");
}

test("the existing subtract example lowers and interprets its from-case state flow", async () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const source = await fs.readFile(path.join(here, "../examples/pyash/subtract.pya"), "utf8");
  const sentences = source.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean).slice(0, 3).map(parse);
  const codelets = sentences.flatMap((sentence) => lowerSentence(sentence));
  const subtract = decodeCodelet(codelets[1].words);
  const collector = Number.parseInt(lookupLegacyName("collector").hnuc, 16);

  assert.equal(codelets[1].words[3], 0x245e, "ob must be encoded as accusative_case_");
  assert.deepEqual(Array.from(codelets[1].words.slice(4, 7)), [
    0x225e,
    collector,
    0x313e
  ], "from name phrase preserves type, value, and source case");
  assert.deepEqual(subtract.sentence, sentences[1]);
  assert.match(renderPyashCodelet(codelets[1].words), /from name collector/u);
  assert.equal(decodeCodelet(codelets[2].words).semantic, "named-query");

  await assert.rejects(
    () => executeCodelets([codelets[1]]),
    (error) => error.code === "unfulfilled-dependency"
  );
  const results = await executeCodelets(codelets);
  assert.equal(results[1].ob.num, 7);
  assert.equal(results[2].su.name, "collector");
  assert.equal(results[2].ob.num, 7);

  forget();
  for (const sentence of sentences) await interpret(sentence);
  assert.equal(remember("collector").ob.num, results[2].ob.num);
  forget();
});
