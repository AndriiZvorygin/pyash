import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import {
  decodeCodelet,
  executeCodelets,
  lowerSentence
} from "../program/library/vliw/index.mjs";

// A numeric vector travels as a uint quote whose vector thickness states how
// many 16-bit elements it holds.
test("numeric vector literals lower to a vector-width quote codelet", async () => {
  const sentence = parse("ob ve num 1 2 3 be vector ya");
  const [codelet] = lowerSentence(sentence);
  assert.deepEqual(Array.from(codelet.words.slice(0, codelet.usedWords)), [
    0x0061, 0x8f1d, 0x0001, 0x0002, 0x0003, 0x245e, 0x217e
  ]);
  assert.equal(codelet.usedWords, 7);
  assert.deepEqual(decodeCodelet(codelet.words).sentence, sentence);
  assert.deepEqual(await executeCodelets([codelet]), [sentence]);
});

test("vector widths use the legacy thickness and explicit length forms", () => {
  const [pair] = lowerSentence(parse("ob ve num 7 8 be vector ya"));
  assert.equal(pair.words[1], 0x891d);
  assert.equal(pair.words[0], 0x0031);

  const [five] = lowerSentence(parse("ob ve num 1 2 3 4 5 be vector ya"));
  assert.equal(five.words[1], 0x8e1d);
  assert.equal(five.words[2], 5);
  assert.deepEqual(
    Array.from(five.words.slice(0, five.usedWords)),
    [0x0301, 0x8e1d, 0x0005, 0x0001, 0x0002, 0x0003, 0x0004, 0x0005, 0x245e, 0x217e]
  );
  assert.deepEqual(decodeCodelet(five.words).sentence.ob.ve.values, [1, 2, 3, 4, 5]);
});

test("named vector literals carry the name phrase and its nominative case", async () => {
  const sentence = parse("su name collector ob ve num 1 2 3 be vector ya");
  const [codelet] = lowerSentence(sentence);
  assert.deepEqual(Array.from(codelet.words.slice(0, codelet.usedWords)), [
    0x0185, 0xab02, 0x24de, 0x8f1d, 0x0001, 0x0002, 0x0003, 0x245e, 0x217e
  ]);
  assert.deepEqual(decodeCodelet(codelet.words).sentence, sentence);
});

test("vector elements that look like case words stay payload", () => {
  const [codelet] = lowerSentence(parse("ob ve num 9438 9310 8574 be vector ya"));
  assert.deepEqual(decodeCodelet(codelet.words).sentence.ob.ve.values, [9438, 9310, 8574]);
});

test("boolean vector literals lower to a signed integer quote", async () => {
  const sentence = parse("ob ve bool truth lie truth be vector ya");
  const [codelet] = lowerSentence(sentence);
  assert.deepEqual(Array.from(codelet.words.slice(0, codelet.usedWords)), [
    0x0061, 0xaf1d, 0x0001, 0x0000, 0x0001, 0x245e, 0x217e
  ]);
  assert.deepEqual(decodeCodelet(codelet.words).sentence, sentence);
  assert.deepEqual(await executeCodelets([codelet]), [sentence]);
});

test("text vector literals keep every element and its case", async () => {
  const sentence = parse('ob ve text Name Age be vector ya');
  const [codelet] = lowerSentence(sentence);
  assert.deepEqual(Array.from(codelet.words.slice(0, codelet.usedWords)), [
    0x3001, 0x0e1d, 0x0004, 0x004e, 0x0061, 0x006d, 0x0065,
    0x0e1d, 0x0003, 0x0041, 0x0067, 0x0065,
    0x245e, 0x217e
  ]);
  assert.deepEqual(decodeCodelet(codelet.words).sentence, sentence);
  assert.deepEqual(await executeCodelets([codelet]), [sentence]);

  const longer = parse('ob ve text Ada Turing be vector ya');
  const [longerCodelet] = lowerSentence(longer);
  assert.deepEqual(decodeCodelet(longerCodelet.words).sentence.ob.ve.values, ["Ada", "Turing"]);
});

test("vector literals reject widths the format cannot state", () => {
  assert.throws(
    () => lowerSentence(parse("ob ve num 7 be vector ya")),
    (error) => error.code === "unsupported-vector-width"
  );
  assert.throws(
    () => lowerSentence(parse("ob ve num 1 2 3 4 5 6 7 8 9 10 11 12 be vector ya")),
    (error) => error.code === "unsupported-vector-width"
  );
  assert.throws(
    () => lowerSentence(parse("ob ve text hello world be vector ya")),
    (error) => error.code === "literal-width"
  );
});

test("vector literals reject element types and values without a proven encoding", () => {
  assert.throws(
    () => lowerSentence(parse("ob ve hollow be vector ya")),
    (error) => error.code === "unsupported-vector-type"
  );
  assert.throws(
    () => lowerSentence(parse('ob ve raw "a" "b" be vector ya')),
    (error) => error.code === "unsupported-vector-type"
  );
  assert.throws(
    () => lowerSentence(parse("ob ve num 1 70000 be vector ya")),
    (error) => error.code === "numeric-range"
  );
  assert.throws(
    () => lowerSentence(parse("ob ve bool maybe lie be vector ya")),
    (error) => error.code === "unsupported-vector-type"
  );
});

test("vector literals reject an object that carries more than one value", () => {
  assert.throws(
    () => lowerSentence(parse('ob ve hollow "a" "b" be vector ya')),
    (error) => error.code === "unsupported-sentence"
  );
});
