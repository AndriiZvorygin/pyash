import test from "node:test";
import assert from "node:assert/strict";

import { parse } from "../program/understand/index.mjs";
import { lowerSentence } from "../program/library/vliw/index.mjs";
import { encodePyacPack } from "../program/library/vliw/database.mjs";
import { scoreVliwFunction } from "../program/library/vliw/functions.mjs";
import { executeNumericArithmeticCodelet } from "../program/library/vliw/arithmetic.mjs";
import { executeNumericPyacPackThroughHousekeeper } from "../program/library/vliw/cuda_batch.mjs";

const sourceSentences = [
  "ob num 65535 with num 65535 be multiply do",
  "ob num 9 with num 4 be divide do",
  "ob num 9 from num 4 be remains do",
  "ob num 2 from num 20 be exponential do",
  "ob num 65535 to num 1 be plus do",
  "ob num 2 from num 9 be subtract do",
  "ob num 7 to num 3 be xor do"
];

function fakeHousekeeper(batch) {
  const candidate = batch.candidates[0];
  const score = scoreVliwFunction({
    schemaVersion: 1,
    name: candidate.id,
    slots: batch.slots,
    inputSlots: batch.inputSlots,
    outputSlot: batch.outputSlot,
    instructions: candidate.instructions
  }, batch.cases);
  return [{ id: candidate.id, ...score, outputs: score.results.map(({ actual }) => actual) }];
}

test("decoded scalar arithmetic PyAC codelets execute through Housekeeper with CPU parity", async () => {
  const codelets = sourceSentences.flatMap((source) => lowerSentence(parse(source)))
    .map((codelet) => codelet.words);
  const pack = encodePyacPack(codelets);
  const submitted = [];
  const result = await executeNumericPyacPackThroughHousekeeper(pack, {
    async evaluateBatch(batch) {
      submitted.push(batch);
      return fakeHousekeeper(batch);
    }
  });

  assert.equal(result.backend, "housekeeper-cuda");
  assert.equal(result.values.length, sourceSentences.length);
  assert.equal(submitted.length, new Set(sourceSentences.map((source) => parse(source).be)).size);
  for (const [index, words] of codelets.entries()) {
    const expected = await executeNumericArithmeticCodelet(words);
    assert.deepEqual(result.values[index], expected);
  }
  assert.ok(submitted.every((batch) => batch.candidates.length === 1));
  assert.ok(submitted.every((batch) => batch.candidates[0].instructions.length === 1));
});

test("PyAC packs with unsupported codelets fail before any Housekeeper submission", async () => {
  const literal = lowerSentence(parse("ob num 7 be number ya"))[0];
  const pack = encodePyacPack([literal.words]);
  let submissions = 0;
  await assert.rejects(
    executeNumericPyacPackThroughHousekeeper(pack, {
      async evaluateBatch() {
        submissions += 1;
        return [];
      }
    }),
    /only supports scalar numeric arithmetic codelets/u
  );
  assert.equal(submissions, 0);
});

test("PyAC division-by-zero fails on the CPU contract before queue submission", async () => {
  const division = lowerSentence(parse("ob num 8 with num 0 be divide do"))[0];
  const pack = encodePyacPack([division.words]);
  let submissions = 0;
  await assert.rejects(
    executeNumericPyacPackThroughHousekeeper(pack, {
      async evaluateBatch() {
        submissions += 1;
        return [];
      }
    }),
    (error) => error.code === "division-by-zero"
  );
  assert.equal(submissions, 0);
});
