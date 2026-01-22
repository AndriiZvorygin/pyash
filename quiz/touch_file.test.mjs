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

test("touch creates file and updates timestamp", async () => {
  forget();
  const dir = await fs.mkdtemp(path.join(process.cwd(), "artifacts", "touch-"));
  const target = path.join(dir, "note.txt");

  await run(`be touch ob filename "${target}" do`);
  const first = await fs.stat(target);
  assert.ok(first.isFile());

  await new Promise(resolve => setTimeout(resolve, 10));
  await run(`be touch ob filename "${target}" do`);
  const second = await fs.stat(target);
  assert.ok(second.mtimeMs >= first.mtimeMs);
});
