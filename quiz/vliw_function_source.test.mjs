import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseVliwFunctionSource } from "../program/library/vliw/index.mjs";
import { scoreVliwFunction } from "../program/library/vliw/functions.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixturePath = path.join(root, "examples/pyash/vliw-u16-addition.pya");
const fixtureText = await fs.readFile(fixturePath, "utf8");

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
