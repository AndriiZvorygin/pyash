import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import {
  decodeCodelet,
  executeCodelets,
  lowerSentence
} from "../program/library/vliw/index.mjs";

test("anonymous paragraph text literals lower and replay", async () => {
  const sentence = parse('ob text "Pyash" be text ya');
  const [codelet] = lowerSentence(sentence);
  assert.deepEqual(Array.from(codelet.words.slice(0, 9)), [
    0x0019, 0x0e1d, 5, 0x0050, 0x0079, 0x0061, 0x0073, 0x0068, 0x245e
  ]);
  assert.equal(decodeCodelet(codelet.words).sentence.ob.text, "Pyash");
  assert.deepEqual(await executeCodelets([codelet]), [sentence]);
});

test("named paragraph text literals preserve name and value", async () => {
  const sentence = parse('su name collector ob text "Pyash" be text ya');
  const [codelet] = lowerSentence(sentence);
  assert.equal(codelet.usedWords, 12);
  assert.deepEqual(await executeCodelets([codelet]), [sentence]);
});

test("text lowering preserves UTF-16 code-unit offsets", async () => {
  const sentence = parse('ob text "😀" be text ya');
  const [codelet] = lowerSentence(sentence);
  assert.deepEqual(Array.from(codelet.words.slice(0, 6)), [
    0x0019, 0x0e1d, 2, 0xd83d, 0xde00, 0x245e
  ]);
  assert.deepEqual(await executeCodelets([codelet]), [sentence]);
});

test("text width stays within one fixed codelet", () => {
  assert.throws(
    () => lowerSentence(parse('ob text "12345678901" be text ya')),
    (error) => error.code === "literal-width"
  );
  assert.throws(
    () => lowerSentence(parse('su name collector ob text "1234567890" be text ya')),
    (error) => error.code === "literal-width"
  );
});
