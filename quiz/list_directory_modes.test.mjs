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

test("list supports file/dir/recursive signatures", async () => {
  const dir = await fs.mkdtemp(path.join(process.cwd(), "artifacts", "list-"));
  await fs.mkdir(path.join(dir, "docs"));
  await fs.writeFile(path.join(dir, "a.txt"), "a", "utf8");
  await fs.writeFile(path.join(dir, "b.txt"), "b", "utf8");

  forget();
  const fileRes = await run(`from filename "${dir}" be list as wo file do`);
  assert.deepEqual(fileRes?.value?.ve?.values, ["a.txt", "b.txt"]);

  forget();
  const dirRes = await run(`from filename "${dir}" be list as wo dir do`);
  assert.deepEqual(dirRes?.value?.ve?.values, ["docs"]);

  forget();
  const recRes = await run(`from filename "${dir}" be list as wo recursive do`);
  assert.deepEqual(recRes?.value?.ve?.values, ["a.txt", "b.txt", "docs"]);
});
