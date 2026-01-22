import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";

async function run(line) {
  const sentence = parse(line);
  return interpret(sentence);
}

test("not inverts a boolean sentence", async () => {
  forget();
  const dir = await fs.mkdtemp(path.join(process.cwd(), "artifacts", "bool-"));
  const file = path.join(dir, "note.txt");
  await fs.writeFile(file, "alpha", "utf8");
  const res = await run(`be not ob la be exists ob filename "${file}" do ko do`);
  assert.equal(res?.value?.boolean ?? res?.ob?.boolean, false);
});

test("and/or combine boolean sentences", async () => {
  forget();
  const dir = await fs.mkdtemp(path.join(process.cwd(), "artifacts", "bool-"));
  const file = path.join(dir, "note.txt");
  await fs.writeFile(file, "alpha", "utf8");
  const missing = path.join(dir, "missing.txt");

  const andRes = await run(`be and ob la be exists ob filename "${file}" do ko with la be exists ob filename "${missing}" do ko do`);
  assert.equal(andRes?.value?.boolean ?? andRes?.ob?.boolean, false);

  const orRes = await run(`be or ob la be exists ob filename "${file}" do ko with la be exists ob filename "${missing}" do ko do`);
  assert.equal(orRes?.value?.boolean ?? orRes?.ob?.boolean, true);
});
