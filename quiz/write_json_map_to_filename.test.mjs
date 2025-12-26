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

test("write json map to filename writes json", async () => {
  forget();

  await run("su name profile be json map def");
  await run('su name name ob text "Ada" ya');
  await run("su name profile be json map prah");

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-write-json-"));
  const outPath = path.join(tmp, "profile.json");

  await run(`ob name profile to state beautiful json to filename ${outPath} be write do`);

  const saved = await fs.readFile(outPath, "utf8");
  assert.equal(saved.trim(), '{\n  "name": "Ada"\n}');
});
