import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, remember } from "../program/remember/index.mjs";

test("refinery keeps non-dependency from fields when from ve name is also present", async () => {
  forget();
  const dir = await fs.mkdtemp(path.join(process.cwd(), "artifacts", "refinery-from-"));
  const inputPath = path.join(dir, "input.txt");
  const program = [
    "su name flow be refinery def",
    `su name prepare ob text \"alpha\" to filename \"${inputPath}\" be write do`,
    `su name read back from ve name prepare from filename \"${inputPath}\" be read do`,
    "prah"
  ];
  for (const line of program) {
    await interpret(parse(line));
  }
  await interpret(parse("from name flow be refinery do"));
  const fact = remember("read back");
  assert.equal(fact?.be, "read");
  assert.equal(fact?.ob?.text, "alpha");
});

test("refinery accepts genitive from filename without treating it as depend list", async () => {
  forget();
  const dir = await fs.mkdtemp(path.join(process.cwd(), "artifacts", "refinery-from-genitive-"));
  const inputPath = path.join(dir, "input.txt");
  const program = [
    "su name flow be refinery def",
    `su name source ob text \"beta\" to filename \"${inputPath}\" be write do`,
    "su name read back from filename of to of source be read do",
    "prah"
  ];
  for (const line of program) {
    await interpret(parse(line));
  }
  await interpret(parse("from name flow be refinery do"));
  const fact = remember("read back");
  assert.equal(fact?.be, "read");
  assert.equal(fact?.ob?.text, "beta");
});
