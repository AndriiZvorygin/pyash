import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parse } from "../program/understand/index.mjs";
import { lowerSentence } from "../program/library/vliw/index.mjs";
import { encodePyacPack } from "../program/library/vliw/database.mjs";
import { executeRustCpuReference } from "../command/vliw_gpu_conformance.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = fs.readFileSync(path.join(root, "examples/pyash/vliw-pluk-tlas.pya"), "utf8");
const loweredProgram = source
  .split(/\n/u)
  .filter((line) => line.trim())
  .flatMap((line) => lowerSentence(parse(line)));

test("pluk tlas lowers its typed named-vector evaluation signature without JS scoring", () => {
  const lowered = loweredProgram.find((item) => item.semantic === "pluk-tlas");

  assert.equal(lowered.semantic, "pluk-tlas");
  assert.deepEqual(Array.from(lowered.words.slice(0, 15)), [
    0x4909,
    0x225e,
    0x68b1,
    0x245e,
    0x225e,
    0x327e,
    0x225e,
    0xaa90,
    0x243e,
    0x225e,
    0x4930,
    0x287e,
    0x2a64,
    0x896a,
    0x295e
  ]);
});

test("pluk tlas requires named vector references and a num output", () => {
  assert.throws(
    () => lowerSentence(parse("ob ve float32 1 by name answer to name num count be pluk tlas do")),
    (error) => error.code === "unsupported-sentence"
  );
  assert.throws(
    () => lowerSentence(parse("ob name prediction by name answer to name text count be pluk tlas do")),
    (error) => error.code === "unsupported-sentence"
  );
});

test("mutable prediction vectors require a supported float32 lane count", () => {
  assert.throws(
    () => lowerSentence(parse('exists su name prediction via state "vector float32" by num 17 be variable ya')),
    (error) => error.code === "unsupported-vector-width"
  );
  assert.throws(
    () => lowerSentence(parse("ob ve float32 1 by ve float32 1 to name prediction be kl6m psas do")),
    (error) => error.code === "unsupported-sentence"
  );
});

test("dot products write indexed lanes of a zero-initialized vector consumed by pluk tlas", async () => {
  const codelets = source
    .split(/\n/u)
    .filter((line) => line.trim())
    .flatMap((line) => lowerSentence(parse(line)).map(({ words }) => words));
  const [results] = executeRustCpuReference([encodePyacPack(codelets)]);

  assert.deepEqual(results, [
    { type: "vector", elementType: "float32", values: [0, 0, 0] },
    { type: "float32", value: 5 },
    { type: "float32", value: 4 },
    { type: "float32", value: 3 },
    { type: "vector", elementType: "float32", values: [5, 4, 3] },
    { type: "unsigned", value: 3 }
  ]);
});
