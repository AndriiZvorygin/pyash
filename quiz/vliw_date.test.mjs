import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import {
  decodeCodelet,
  executeCodelets,
  lowerSentence
} from "../program/library/vliw/index.mjs";

// A date is a uint64 count of milliseconds since the Unix epoch. The legacy
// quote format reserves the 64-bit scalar thickness, so the value travels in a
// uint quote with four payload words.
test("date literals lower to a uint64 quote codelet", async () => {
  const sentence = parse("ob date 2025-05-01 be date ya");
  const [codelet] = lowerSentence(sentence);
  assert.deepEqual(Array.from(codelet.words.slice(0, codelet.usedWords)), [
    0x00c1, 0x981d, 0x9c00, 0x8924, 0x0196, 0x0000, 0x245e, 0x217e
  ]);
  assert.equal(codelet.usedWords, 8);
  assert.deepEqual(decodeCodelet(codelet.words).sentence, sentence);
  assert.deepEqual(await executeCodelets([codelet]), [sentence]);
});

test("named date literals carry the name phrase and its nominative case", async () => {
  const sentence = parse("su name collector ob date 2025-05-01 be date ya");
  const [codelet] = lowerSentence(sentence);
  assert.deepEqual(Array.from(codelet.words.slice(0, codelet.usedWords)), [
    0x0305, 0xab02, 0x24de, 0x981d, 0x9c00, 0x8924, 0x0196, 0x0000, 0x245e, 0x217e
  ]);
  assert.deepEqual(decodeCodelet(codelet.words).sentence, sentence);
});

test("date literals keep the epoch value in the payload", () => {
  const [codelet] = lowerSentence(parse("ob date 2025-05-01T10:00:00Z be date ya"));
  const words = codelet.words;
  let epoch = 0n;
  for (let index = 5; index >= 2; index -= 1) {
    epoch = (epoch << 16n) | BigInt(words[index]);
  }
  assert.equal(epoch, 1746093600000n);
});

test("date literals reject values that would not lower reproducibly", () => {
  assert.throws(
    () => lowerSentence(parse("ob date now be date ya")),
    (error) => error.code === "unsupported-date"
  );
  assert.throws(
    () => lowerSentence(parse("ob date 2025-05-01T10:00:00 be date ya")),
    (error) => error.code === "unsupported-date"
  );
  assert.throws(
    () => lowerSentence(parse("ob date 2025-02-30 be date ya")),
    (error) => error.code === "unsupported-date"
  );
});

test("date literals reject names outside the legacy vocabulary", () => {
  assert.throws(
    () => lowerSentence(parse("su name start ob date 2025-05-01 be date ya")),
    (error) => error.code === "unrepresentable-name"
  );
});
