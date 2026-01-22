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

test("list returns vector with entries", async () => {
  forget();
  const dir = await fs.mkdtemp(path.join(process.cwd(), "artifacts", "list-"));
  await fs.writeFile(path.join(dir, "alpha.txt"), "a", "utf8");
  await fs.writeFile(path.join(dir, "beta.txt"), "b", "utf8");
  const result = await run(`from filename "${dir}" be list do`);
  assert.deepEqual(result?.value?.ve?.values, ["alpha.txt", "beta.txt"]);
});
