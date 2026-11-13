import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  evolveVliwFunctionSourceThroughHousekeeper,
  parseVliwFunctionSource,
  renderVliwFunctionSource
} from "../program/library/vliw/index.mjs";
import { normalizeVliwFunction, scoreVliwFunction } from "../program/library/vliw/functions.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixturePath = path.join(root, "examples/pyash/vliw-u16-addition.pya");
const fixtureText = await fs.readFile(fixturePath, "utf8");

function housekeeperFor({ batches, corruptOutputs = false }) {
  const payloads = new Map();
  let sequence = 0;
  return {
    makeHandleId: () => `source-evolution-${sequence++}`,
    async submitDuty(call) {
      const job = JSON.parse(call.ob.text);
      assert.equal(call.be, "gpu vliw");
      assert.equal(job.kind, "vliw-batch-evaluate");
      batches.push(job.payload);
      payloads.set(call.su.name, job.payload);
    },
    async readStatus(_worldRoot, handleId) {
      const batch = payloads.get(handleId);
      const scores = batch.candidates.map((candidate) => {
        const score = scoreVliwFunction({
          schemaVersion: 1,
          name: "source fixture",
          slots: batch.slots,
          inputSlots: batch.inputSlots,
          outputSlot: batch.outputSlot,
          instructions: candidate.instructions
        }, batch.cases);
        const outputs = score.results.map(({ actual }) => actual);
        return {
          id: candidate.id,
          incorrectCount: score.incorrectCount,
          totalAbsoluteError: score.totalAbsoluteError,
          instructionCount: score.instructionCount,
          outputs: corruptOutputs ? outputs.map((value) => (value + 1) & 0xffff) : outputs
        };
      });
      return { status: "success", result: JSON.stringify({ schemaVersion: 1, scores }) };
    }
  };
}

test("Pyash VLIW source lowers named maps and series to the normalized function contract", () => {
  const source = parseVliwFunctionSource(fixtureText);
  assert.deepEqual(source.definition, {
    schemaVersion: 1,
    name: "u16 addition",
    slots: ["left", "right", "sum"],
    inputSlots: ["left", "right"],
    outputSlot: "sum",
    instructions: [{ op: "plus", target: "sum", left: "left", right: "right" }]
  });
  assert.deepEqual(source.trainingCases, [
    { values: { left: 2, right: 3 }, expected: 5 },
    { values: { left: 17, right: 25 }, expected: 42 }
  ]);
  assert.deepEqual(source.heldoutCases, [
    { values: { left: 64000, right: 2000 }, expected: 65535 }
  ]);
});

test("Pyash VLIW source cases score through the CPU reference implementation", () => {
  const source = parseVliwFunctionSource(fixtureText);
  assert.equal(scoreVliwFunction(source.definition, source.trainingCases).incorrectCount, 0);
  assert.equal(scoreVliwFunction(source.definition, source.heldoutCases).incorrectCount, 0);
});

test("Pyash VLIW source rejects unsupported instruction records and dangling references", () => {
  assert.throws(
    () => parseVliwFunctionSource(fixtureText.replace('ob text "plus"', 'ob text "multiply"')),
    /unsupported VLIW operation: multiply/u
  );
  assert.throws(
    () => parseVliwFunctionSource(fixtureText.replace("su name addition instruction 001 ya", "su name missing instruction ya")),
    /unknown instruction map reference: missing instruction/u
  );
});

test("Pyash VLIW source rejects executable arithmetic sentences in the declarative instruction series", () => {
  const invalid = fixtureText.replace(
    "su name addition instruction 001 ya\nprah",
    "ob num 2 to num 3 be plus do\nprah"
  );
  assert.throws(() => parseVliwFunctionSource(invalid), /series entries must reference named maps/u);
});

test("Pyash VLIW source rejects case values outside the U16 contract", () => {
  assert.throws(
    () => parseVliwFunctionSource(fixtureText.replace("ob num 2 ya", "ob num 65536 ya")),
    /case addition training 001 input left must be an unsigned 16-bit integer/u
  );
});

test("Pyash VLIW source evolves through Housekeeper, CPU-checks outputs, and round-trips the winner", async () => {
  const batches = [];
  const result = await evolveVliwFunctionSourceThroughHousekeeper({
    sourceText: fixtureText,
    populationSize: 3,
    generations: 1,
    seed: 17,
    housekeeper: housekeeperFor({ batches })
  });

  assert.equal(result.validated, true);
  assert.equal(result.candidate.instructions[0].op, "plus");
  assert.deepEqual(result.trainingOutputs, [5, 42]);
  assert.deepEqual(result.heldoutOutputs, [65535]);
  assert.deepEqual(result.cpuReference.trainingOutputs, result.trainingOutputs);
  assert.deepEqual(result.cpuReference.heldoutOutputs, result.heldoutOutputs);
  assert.equal(batches.length, 2);
  assert.deepEqual(batches.at(-1).cases, parseVliwFunctionSource(fixtureText).heldoutCases);

  const savedSource = parseVliwFunctionSource(result.candidateSourcePya);
  assert.deepEqual(savedSource.definition, normalizeVliwFunction(result.candidate));
  assert.deepEqual(savedSource.trainingCases, parseVliwFunctionSource(fixtureText).trainingCases);
  assert.deepEqual(savedSource.heldoutCases, parseVliwFunctionSource(fixtureText).heldoutCases);
});

test("Pyash VLIW source evolution fails when Housekeeper outputs disagree with the CPU reference", async () => {
  await assert.rejects(evolveVliwFunctionSourceThroughHousekeeper({
    sourceText: fixtureText,
    populationSize: 3,
    generations: 1,
    seed: 17,
    housekeeper: housekeeperFor({ batches: [], corruptOutputs: true })
  }), /Housekeeper training outputs disagree with the CPU reference/u);
});

test("Pyash VLIW source does not mark a training-inaccurate winner validated", async () => {
  const notFullyLearnable = fixtureText.replace("ob num 5 ya", "ob num 100 ya");
  const result = await evolveVliwFunctionSourceThroughHousekeeper({
    sourceText: notFullyLearnable,
    populationSize: 3,
    generations: 1,
    seed: 17,
    housekeeper: housekeeperFor({ batches: [] })
  });
  assert.equal(result.trainingFitness.incorrectCount, 1);
  assert.equal(result.heldoutFitness.incorrectCount, 0);
  assert.equal(result.validated, false);
});
