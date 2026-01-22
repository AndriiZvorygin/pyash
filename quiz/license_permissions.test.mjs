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

const skipWindows = process.platform === "win32";

test("license sets numeric mode", { skip: skipWindows }, async () => {
  forget();
  const dir = await fs.mkdtemp(path.join(process.cwd(), "artifacts", "license-"));
  const file = path.join(dir, "note.txt");
  await fs.writeFile(file, "alpha", "utf8");

  await run(`be license ob filename "${file}" as num 644 do`);
  const stats = await fs.stat(file);
  assert.equal(stats.mode & 0o777, 0o644);
});

test("license sets vector mode", { skip: skipWindows }, async () => {
  forget();
  const dir = await fs.mkdtemp(path.join(process.cwd(), "artifacts", "license-"));
  const file = path.join(dir, "note.txt");
  await fs.writeFile(file, "alpha", "utf8");

  await run(`be license ob filename "${file}" as ve owner read write interpret flock read hollow hollow all read hollow hollow do`);
  const stats = await fs.stat(file);
  assert.equal(stats.mode & 0o777, 0o744);
});
