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

test("rename moves file to new path", async () => {
  forget();
  const dir = await fs.mkdtemp(path.join(process.cwd(), "artifacts", "rename-"));
  const src = path.join(dir, "note.txt");
  const dest = path.join(dir, "moved", "note.txt");
  await fs.writeFile(src, "alpha", "utf8");

  const res = await run(`be rename ob filename "${src}" to filename "${dest}" do`);
  assert.equal(res?.value?.filename, dest);
  await assert.rejects(() => fs.stat(src));
  const contents = await fs.readFile(dest, "utf8");
  assert.equal(contents, "alpha");
});

test("rename overwrites destination", async () => {
  forget();
  const dir = await fs.mkdtemp(path.join(process.cwd(), "artifacts", "rename-"));
  const src = path.join(dir, "source.txt");
  const dest = path.join(dir, "dest.txt");
  await fs.writeFile(src, "alpha", "utf8");
  await fs.writeFile(dest, "beta", "utf8");

  await run(`be rename ob filename "${src}" to filename "${dest}" do`);
  await assert.rejects(() => fs.stat(src));
  const contents = await fs.readFile(dest, "utf8");
  assert.equal(contents, "alpha");
});

test("rename fails for missing source", async () => {
  forget();
  const dir = await fs.mkdtemp(path.join(process.cwd(), "artifacts", "rename-"));
  const src = path.join(dir, "missing.txt");
  const dest = path.join(dir, "dest.txt");
  await assert.rejects(() => run(`be rename ob filename "${src}" to filename "${dest}" do`));
});
