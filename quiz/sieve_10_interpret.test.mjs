import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

import { buildProgram } from "../program/program.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { remember, forget } from "../program/remember/index.mjs";

test("sieve 10 marks composites in bool vector", async () => {
  forget();
  const source = await fs.readFile("examples/pyash/sieve-10.pya", "utf8");
  const program = buildProgram(source);
  for (const sentence of program.sentences) {
    await interpret(sentence);
  }

  const composite = remember("composite");
  assert.deepEqual(composite?.obj?.ve?.values, [
    "lie",
    "lie",
    "lie",
    "lie",
    "truth",
    "lie",
    "truth",
    "lie",
    "truth",
    "truth"
  ]);

  const primes = remember("primes");
  assert.deepEqual(primes?.obj?.ve?.values, [2, 3, 5, 7]);
});
