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

test("copy supports recursive directory copies", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-copy-"));
  const src = path.join(root, "src");
  const nested = path.join(src, "nest");
  const dest = path.join(root, "dest");

  await fs.mkdir(nested, { recursive: true });
  await fs.writeFile(path.join(src, "root.txt"), "root", "utf8");
  await fs.writeFile(path.join(nested, "leaf.txt"), "leaf", "utf8");

  const res = await run(`be copy ob filename "${src}" to filename "${dest}" as wo recursive do`);
  assert.equal(res?.value?.filename, dest);

  const rootOut = await fs.readFile(path.join(dest, "root.txt"), "utf8");
  const leafOut = await fs.readFile(path.join(dest, "nest", "leaf.txt"), "utf8");
  assert.equal(rootOut, "root");
  assert.equal(leafOut, "leaf");
});
