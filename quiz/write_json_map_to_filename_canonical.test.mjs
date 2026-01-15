import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";

async function run(line) {
  const s = parse(line);
  return interpret(s);
}

test("write json map to filename writes canonical json", async () => {
  forget();

  await run("su name sample be json map def");
  await run("exists su name b ob num 3 ya");
  await run("exists su name a ob num 1 ya");
  await run("prah");

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-write-json-"));
  const outPath = path.join(tmp, "sample.json");

  await run(`ob name sample to state json to filename ${outPath} be write do`);

  const saved = await fs.readFile(outPath, "utf8");
  assert.equal(saved.trim(), "{\"a\":1,\"b\":3}");
});
