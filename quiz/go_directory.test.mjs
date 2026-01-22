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

test("go changes working directory for relative filenames", async () => {
  forget();
  const original = process.cwd();
  const tmp = await fs.mkdtemp(path.join(process.cwd(), "artifacts", "go-"));
  const markerPath = path.join(tmp, "marker.txt");
  await fs.writeFile(markerPath, "ok", "utf8");
  try {
    await run(`be go to filename "${tmp}" do`);
    const res = await run('from filename "marker.txt" be read do');
    assert.equal(res?.value?.text, "ok");
  } finally {
    process.chdir(original);
  }
});

test("go rejects missing directory", async () => {
  forget();
  await assert.rejects(() => run('be go to filename "/no/such/dir" do'));
});

test("go rejects file path", async () => {
  forget();
  const dir = await fs.mkdtemp(path.join(process.cwd(), "artifacts", "go-"));
  const target = path.join(dir, "note.txt");
  await fs.writeFile(target, "alpha", "utf8");
  await assert.rejects(() => run(`be go to filename "${target}" do`));
});
