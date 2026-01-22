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

test("delete removes file", async () => {
  forget();
  const dir = await fs.mkdtemp(path.join(process.cwd(), "artifacts", "delete-"));
  const target = path.join(dir, "note.txt");
  await fs.writeFile(target, "alpha", "utf8");

  const res = await run(`be delete ob filename "${target}" do`);
  assert.equal(res?.value?.filename, target);
  await assert.rejects(() => fs.stat(target));
});

test("delete recursive removes directory tree", async () => {
  forget();
  const dir = await fs.mkdtemp(path.join(process.cwd(), "artifacts", "delete-"));
  const nested = path.join(dir, "nested");
  await fs.mkdir(nested, { recursive: true });
  await fs.writeFile(path.join(nested, "note.txt"), "alpha", "utf8");

  const res = await run(`be delete ob filename "${dir}" as wo recursive do`);
  assert.equal(res?.value?.filename, dir);
  await assert.rejects(() => fs.stat(dir));
});

test("delete removes empty directory", async () => {
  forget();
  const dir = await fs.mkdtemp(path.join(process.cwd(), "artifacts", "delete-"));
  const res = await run(`be delete ob filename "${dir}" do`);
  assert.equal(res?.value?.filename, dir);
  await assert.rejects(() => fs.stat(dir));
});

test("delete non-empty directory without recursive fails", async () => {
  forget();
  const dir = await fs.mkdtemp(path.join(process.cwd(), "artifacts", "delete-"));
  await fs.writeFile(path.join(dir, "note.txt"), "alpha", "utf8");
  await assert.rejects(() => run(`be delete ob filename "${dir}" do`));
});

test("delete file mode rejects directory", async () => {
  forget();
  const dir = await fs.mkdtemp(path.join(process.cwd(), "artifacts", "delete-"));
  await assert.rejects(() => run(`be delete ob filename "${dir}" as wo file do`));
});

test("delete directory mode rejects file", async () => {
  forget();
  const dir = await fs.mkdtemp(path.join(process.cwd(), "artifacts", "delete-"));
  const target = path.join(dir, "note.txt");
  await fs.writeFile(target, "alpha", "utf8");
  await assert.rejects(() => run(`be delete ob filename "${target}" as wo directory do`));
});
