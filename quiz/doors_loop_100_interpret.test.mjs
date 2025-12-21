import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, remember } from "../program/remember/index.mjs";
import { doorsExpectedLiteral } from "./doors_loop_expected.mjs";

test("interpret 100 doors loop produces expected vector", async () => {
  forget();

  const source = await fs.readFile("examples/pyash/doors-loop-100.pya", "utf8");
  const lines = source.split("\n").map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    await interpret(parse(line));
  }

  const doors = remember("doors");
  const values = doors?.obj?.ve?.values ?? [];
  const literal = `ve bool ${values.join(" ")}`;
  assert.equal(literal, doorsExpectedLiteral(100));
});
