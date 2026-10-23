import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import {
  decodeCodelet,
  executeCodelets,
  lowerSentence
} from "../program/library/vliw/index.mjs";

test("anonymous boolean facts preserve the legacy result layout", async () => {
  const sentence = parse("ob bool truth ya");
  const [codelet] = lowerSentence(sentence);
  assert.deepEqual(Array.from(codelet.words.slice(0, 5)), [
    0x0019, 0x6909, 0x538f, 0x245e, 0x217e
  ]);
  assert.deepEqual(decodeCodelet(codelet.words).sentence, sentence);
  assert.deepEqual(await executeCodelets([codelet]), [sentence]);
});

test("named boolean facts preserve the legacy name and result layout", async () => {
  const sentence = parse("su name collector ob bool lie ya");
  const [codelet] = lowerSentence(sentence);
  assert.deepEqual(Array.from(codelet.words.slice(0, 7)), [
    0x0065, 0xab02, 0x24de, 0x680d, 0x538f, 0x245e, 0x217e
  ]);
  assert.deepEqual(await executeCodelets([codelet]), [sentence]);
});

test("named boolean facts preserve multi-word legacy names", async () => {
  const sentence = parse("su name collector answer ob bool truth ya");
  const [codelet] = lowerSentence(sentence);
  assert.deepEqual(Array.from(codelet.words.slice(0, 8)), [
    0x0065, 0xab02, 0x4930, 0x24de, 0x6909, 0x538f, 0x245e, 0x217e
  ]);
  assert.deepEqual(await executeCodelets([codelet]), [sentence]);
});

test("boolean literals reject non-boolean payloads", () => {
  assert.throws(
    () => lowerSentence({ mood: "ya", ob: { boolean: "truth" } }),
    (error) => error.code === "boolean-value"
  );
});
