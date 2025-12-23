import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

import { buildProgram } from "../program/program.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { remember, forget } from "../program/remember/index.mjs";

test("insertion sort sorts numeric vector in interpreter", async () => {
  forget();
  const source = await fs.readFile("examples/pyash/insertion-sort.pya", "utf8");
  const program = buildProgram(source);
  for (const sentence of program.sentences) {
    await interpret(sentence);
  }

  const values = remember("values");
  assert.deepEqual(values?.ob?.ve?.values, [1, 2, 3, 4, 5, 6]);
});
