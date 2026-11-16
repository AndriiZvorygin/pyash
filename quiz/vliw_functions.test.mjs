import test from "node:test";
import assert from "node:assert/strict";

import {
  compareVliwFitness,
  executeVliwFunction,
  normalizeVliwFunction,
  scoreVliwFunction
} from "../program/library/vliw/functions.mjs";

const numberPlus = {
  schemaVersion: 1,
  name: "number plus",
  slots: ["left", "right", "sum"],
  inputSlots: ["left", "right"],
  outputSlot: "sum",
  instructions: [{ op: "plus", target: "sum", left: "left", right: "right" }]
};

test("named-slot VLIW function uses saturating 16-bit plus semantics", () => {
  assert.equal(executeVliwFunction(numberPlus, { left: 20, right: 22 }), 42);
  assert.equal(executeVliwFunction(numberPlus, { left: 65535, right: 1 }), 65535);
});

test("named-slot VLIW function supports saturating subtract and 16-bit xor", () => {
  const subtract = {
    ...numberPlus,
    instructions: [{ op: "subtract", target: "sum", left: "left", right: "right" }]
  };
  const xor = {
    ...numberPlus,
    instructions: [{ op: "xor", target: "sum", left: "left", right: "right" }]
  };
  assert.equal(executeVliwFunction(subtract, { left: 2, right: 3 }), 0);
  assert.equal(executeVliwFunction(xor, { left: 0xffff, right: 0x00ff }), 0xff00);
});

test("function validation admits larger slot and instruction tables but enforces its step budget", () => {
  const slots = ["left", "right", "sum", ...Array.from({ length: 17 }, (_, index) => `slot ${index}`)];
  const instructions = Array(40).fill(numberPlus.instructions[0]);
  assert.equal(normalizeVliwFunction({
    ...numberPlus,
    slots,
    instructions
  }).instructions.length, 40);
  assert.throws(() => normalizeVliwFunction({
    ...numberPlus,
    stepBudget: 12,
    instructions
  }), /requires 40 steps but stepBudget is 12/u);
  assert.throws(() => normalizeVliwFunction({
    ...numberPlus,
    instructions: [{ ...numberPlus.instructions[0], right: "missing" }]
  }), /unknown slot/u);
});

test("fitness orders exact correctness before error and code size", () => {
  const cases = [
    { values: { left: 0, right: 0 }, expected: 0 },
    { values: { left: 65535, right: 1 }, expected: 65535 }
  ];
  const score = scoreVliwFunction(numberPlus, cases);
  assert.deepEqual(score, {
    incorrectCount: 0,
    totalAbsoluteError: 0,
    instructionCount: 1,
    results: [
      { actual: 0, expected: 0, absoluteError: 0 },
      { actual: 65535, expected: 65535, absoluteError: 0 }
    ]
  });
  assert.equal(compareVliwFitness(
    { incorrectCount: 1, totalAbsoluteError: 1, instructionCount: 1 },
    { incorrectCount: 0, totalAbsoluteError: 10, instructionCount: 8 }
  ), 1);
  assert.equal(compareVliwFitness(
    { incorrectCount: 0, totalAbsoluteError: 0, instructionCount: 2 },
    { incorrectCount: 0, totalAbsoluteError: 0, instructionCount: 1 }
  ), 1);
});
