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

test("copy duplicates file contents", async () => {
  forget();
  const dir = await fs.mkdtemp(path.join(process.cwd(), "artifacts", "copy-"));
  const src = path.join(dir, "source.txt");
  const dest = path.join(dir, "out", "copy.txt");
  await fs.writeFile(src, "alpha", "utf8");

  const res = await run(`be copy ob filename "${src}" to filename "${dest}" do`);
  assert.equal(res?.value?.filename, dest);
  const data = await fs.readFile(dest, "utf8");
  assert.equal(data, "alpha");
});
