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

test("directory tools flow: directory, touch, copy, delete", async () => {
  forget();
  const root = await fs.mkdtemp(path.join(process.cwd(), "artifacts", "flow-"));
  const dir = path.join(root, "nested");
  const original = path.join(dir, "note.txt");
  const copy = path.join(dir, "note-copy.txt");

  await run(`be directory ob filename "${dir}" do`);
  await run(`be touch ob filename "${original}" do`);
  await run(`be copy ob filename "${original}" to filename "${copy}" do`);

  const originalStats = await fs.stat(original);
  const copyStats = await fs.stat(copy);
  assert.equal(originalStats.isFile(), true);
  assert.equal(copyStats.isFile(), true);

  await run(`be delete ob filename "${original}" do`);
  await run(`be delete ob filename "${copy}" do`);
  await run(`be delete ob filename "${dir}" do`);
  await run(`be delete ob filename "${root}" as wo recursive do`);
});
