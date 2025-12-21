import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

import { buildProgram } from "../program/program.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { remember, forget } from "../program/remember/index.mjs";

test("sieve 100 builds primes list text", async () => {
  forget();
  const source = await fs.readFile("examples/pyash/sieve-100.pya", "utf8");
  const program = buildProgram(source);
  for (const sentence of program.sentences) {
    await interpret(sentence);
  }

  const primes = remember("primes");
  assert.deepEqual(primes?.obj?.ve?.values, [
    2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47,
    53, 59, 61, 67, 71, 73, 79, 83, 89, 97
  ]);
});
