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

test("directory creates nested path", async () => {
  forget();
  const root = await fs.mkdtemp(path.join(process.cwd(), "artifacts", "dir-"));
  const target = path.join(root, "nested", "child");

  const res = await run(`be directory ob filename "${target}" do`);
  assert.equal(res?.value?.filename, target);
  const stats = await fs.stat(target);
  assert.equal(stats.isDirectory(), true);
});

test("directory rejects file target", async () => {
  forget();
  const root = await fs.mkdtemp(path.join(process.cwd(), "artifacts", "dir-"));
  const file = path.join(root, "note.txt");
  await fs.writeFile(file, "alpha", "utf8");
  await assert.rejects(() => run(`be directory ob filename "${file}" do`));
});
