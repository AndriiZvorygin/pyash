import test from "node:test";
import assert from "node:assert/strict";

import { scoreVliwFunction } from "../program/library/vliw/functions.mjs";
import { evolveVliwFunction } from "../program/library/vliw/evolution.mjs";

const template = {
  schemaVersion: 1,
  name: "number plus",
  slots: ["left", "right", "sum"],
  inputSlots: ["left", "right"],
  outputSlot: "sum"
};
const trainingCases = [
  { values: { left: 0, right: 0 }, expected: 0 },
  { values: { left: 2, right: 3 }, expected: 5 },
  { values: { left: 65535, right: 1 }, expected: 65535 }
];
const heldoutCases = [
  { values: { left: 12000, right: 50000 }, expected: 62000 },
  { values: { left: 40000, right: 40000 }, expected: 65535 }
];

function cpuBatchEvaluator(batch) {
  return batch.candidates.map((candidate) => ({
    id: candidate.id,
    ...scoreVliwFunction({ ...template, instructions: candidate.instructions }, batch.cases)
  }));
}

test("evolution submits bounded candidate batches and validates the winner on held-out cases", async () => {
  const batches = [];
  const result = await evolveVliwFunction({
    template,
    trainingCases,
    heldoutCases,
    populationSize: 8,
    generations: 4,
    seed: 17,
    async evaluateBatch(batch) {
      batches.push(batch);
      return cpuBatchEvaluator(batch);
    }
  });

  assert.equal(result.validated, true);
  assert.equal(result.trainingFitness.incorrectCount, 0);
  assert.equal(result.heldoutFitness.incorrectCount, 0);
  assert.equal(result.candidate.instructions[0].op, "plus");
  assert.ok(batches.every((batch) => batch.candidates.length <= 8));
  assert.equal(batches.at(-1).candidates.length, 1);
  assert.deepEqual(batches.at(-1).cases, heldoutCases);
});

test("evolution is deterministic for the same seed and evaluator results", async () => {
  const options = {
    template,
    trainingCases,
    heldoutCases,
    populationSize: 12,
    generations: 5,
    seed: 101,
    evaluateBatch: async (batch) => cpuBatchEvaluator(batch)
  };
  const first = await evolveVliwFunction(options);
  const second = await evolveVliwFunction(options);
  assert.deepEqual(first, second);
});

test("evolution requires an evaluator callback and rejects malformed evaluator results", async () => {
  await assert.rejects(evolveVliwFunction({
    template, trainingCases, heldoutCases
  }), /Housekeeper-backed evaluateBatch/u);
  await assert.rejects(evolveVliwFunction({
    template,
    trainingCases,
    heldoutCases,
    populationSize: 4,
    generations: 1,
    evaluateBatch: async () => []
  }), /omitted candidate/u);
});
