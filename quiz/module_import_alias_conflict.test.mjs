import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";
import { setEntryModulePath } from "../program/bridge/modules.mjs";

test("module import rejects alias shadowing by different modules", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-module-"));
  const onePath = path.join(tmpDir, "one.pya");
  const twoPath = path.join(tmpDir, "two.pya");
  const entryPath = path.join(tmpDir, "entry.pya");

  await fs.writeFile(onePath, "su name value ob num 1 ya\nsu name value be export ya\n", "utf8");
  await fs.writeFile(twoPath, "su name value ob num 2 ya\nsu name value be export ya\n", "utf8");

  await fs.writeFile(
    entryPath,
    [
      `from name ${onePath} to name shared be import do`,
      `from name ${twoPath} to name shared be import do`
    ].join("\n"),
    "utf8"
  );

  setEntryModulePath(entryPath);
  forget();

  const lines = (await fs.readFile(entryPath, "utf8")).split(/\r?\n/);
  const first = parse(lines[0]);
  await interpret(first);

  const second = parse(lines[1]);
  await assert.rejects(() => interpret(second), /module alias already used/);
});
