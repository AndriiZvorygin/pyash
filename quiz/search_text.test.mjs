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

test("search finds matches in files", async () => {
  forget();
  const root = await fs.mkdtemp(path.join(process.cwd(), "artifacts", "search-"));
  const fileA = path.join(root, "a.txt");
  const fileB = path.join(root, "b.txt");
  await fs.writeFile(fileA, "Alpha\nBeta\nGamma\n", "utf8");
  await fs.writeFile(fileB, "alpha line\nother\n", "utf8");

  const res = await run(`be search ob text "alpha" in filename "${root}" do`);
  const output = res?.value?.text ?? "";
  assert.ok(output.includes(`${fileA}:1:Alpha`));
  assert.ok(output.includes(`${fileB}:1:alpha line`));
});
