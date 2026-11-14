import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parse } from "../program/understand/index.mjs";
import { lowerPyashProgram, decodePyashProgram } from "../program/library/vliw/sentence.mjs";
import { encodePyacPack, decodePyacPack } from "../program/library/vliw/database.mjs";
import {
  compilePyashProgramSource,
  decodePyashProgramPack,
  executePyashProgramPack,
  evolvePyashProgramSource,
  mutatePyashProgramSource
} from "../program/library/vliw/index.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = await fs.readFile(path.join(root, "examples/pyash/vliw-is-even.pya"), "utf8");

test("ordinary Pyash ceremony source round-trips through the fixed-width PyAC pack", () => {
  const sentences = source.split(/\n/u).filter((line) => line.trim()).map(parse);
  const lowered = lowerPyashProgram(sentences);
  const decoded = decodePyashProgram(decodePyacPack(encodePyacPack(lowered.vectors)).codelets);

  assert.deepEqual(decoded, sentences);
  assert.ok(lowered.vectors.length > sentences.length);
  assert.ok(lowered.vectors.every((vector) => vector.length === 16));
});

test("ordinary Pyash is-even program executes from its compiled PyAC pack", async () => {
  for (const [input, expected] of [[0, true], [1, false], [2, true], [17, false], [65534, true]]) {
    const invocation = `ob num ${input} to name bool answer be equally number do`;
    const compiled = compilePyashProgramSource(source, { invocation });
    const result = await executePyashProgramPack(compiled.pack);
    assert.equal(result.output.boolean, expected, `input ${input}`);
    assert.equal(result.execution.invoked, "equally number");
    assert.ok(compiled.vectorCount > 0);
  }
});

test("programlet mutations are deterministic and evolution validates held-out cases", async () => {
  const left = mutatePyashProgramSource(source, { seed: 41 });
  const right = mutatePyashProgramSource(source, { seed: 41 });
  assert.equal(left, right);
  assert.notEqual(left, source);
  assert.match(left, /ob num 0 to name bool answer be ceremony def/u);
  assert.match(left, /else su name lie/u);

  const result = await evolvePyashProgramSource({
    sourceText: source,
    functionName: "equally number",
    trainingCases: [{ input: 4, expected: true }, { input: 7, expected: false }],
    heldoutCases: [{ input: 0, expected: true }, { input: 65535, expected: false }],
    populationSize: 4,
    generations: 2,
    seed: 7
  });
  assert.equal(result.validated, true);
  assert.equal(result.trainingFitness.incorrectCount, 0);
  assert.equal(result.heldoutFitness.incorrectCount, 0);
  assert.ok(result.candidatePack instanceof Uint8Array);
  assert.equal(decodePyashProgramPack(result.candidatePack).length, source.split(/\n/u).filter(Boolean).length);
});

test("programlet admission rejects effectful and recursive bodies", () => {
  assert.throws(
    () => compilePyashProgramSource(source.replace("be remains do", "be say do")),
    /rejects effectful or unknown verb/u
  );
  assert.throws(
    () => compilePyashProgramSource(source, { invocation: "be equally number do" }),
    /requires one typed bool or num output name/u
  );
  const incompatibleCall = source.replace(
    "su name truth to name bool answer be truth",
    "su name truth to name num answer be truth"
  );
  assert.throws(() => compilePyashProgramSource(incompatibleCall), /incompatible output signature/u);
  const missingReturn = source.replace("su name answer ret\n", "");
  assert.throws(() => compilePyashProgramSource(missingReturn), /must return a value/u);
  const recursive = source.replace(
    "su name answer ret",
    "ob num 3 to name bool answer be equally number do\nsu name answer ret"
  );
  assert.throws(() => compilePyashProgramSource(recursive), /recursive ceremony calls/u);
});
