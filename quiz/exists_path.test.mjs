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

test("exists returns true for present path", async () => {
  forget();
  const dir = await fs.mkdtemp(path.join(process.cwd(), "artifacts", "exists-"));
  const res = await run(`be exists ob filename "${dir}" do`);
  assert.equal(res?.value?.bool, true);
});

test("exists returns false for missing path", async () => {
  forget();
  const missing = path.join(process.cwd(), "artifacts", "missing-exists.txt");
  const res = await run(`be exists ob filename "${missing}" do`);
  assert.equal(res?.value?.bool, false);
});
