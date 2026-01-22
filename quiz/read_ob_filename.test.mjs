import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";

async function run(line) {
  const sentence = parse(line);
  return interpret(sentence);
}

test("read accepts ob filename", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-read-"));
  const filePath = path.join(dir, "sample.txt");
  await fs.writeFile(filePath, "cpuinfo", "utf8");

  const res = await run(`be read ob filename "${filePath}" do`);
  assert.equal(res?.ob?.text, "cpuinfo");
});
