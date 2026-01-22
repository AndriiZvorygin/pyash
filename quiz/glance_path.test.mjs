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

test("glance returns metadata map", async () => {
  forget();
  const dir = await fs.mkdtemp(path.join(process.cwd(), "artifacts", "glance-"));
  const file = path.join(dir, "note.txt");
  await fs.writeFile(file, "alpha", "utf8");

  const res = await run(`be glance ob filename "${file}" do`);
  const map = res?.value?.map ?? {};
  assert.equal(map.magnitude, 5);
  assert.equal(map.sort, "file");
  assert.ok(typeof map["improve time"] === "string");
});
