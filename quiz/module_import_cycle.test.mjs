import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";
import { setEntryModulePath } from "../program/bridge/modules.mjs";

test("module import cycle throws", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-module-"));
  const aPath = path.join(tmpDir, "a.pya");
  const bPath = path.join(tmpDir, "b.pya");
  const entryPath = path.join(tmpDir, "entry.pya");

  await fs.writeFile(aPath, `from name ${bPath} to name b be import do\n`, "utf8");
  await fs.writeFile(bPath, `from name ${aPath} to name a be import do\n`, "utf8");
  await fs.writeFile(entryPath, `from name ${aPath} to name a be import do\n`, "utf8");

  setEntryModulePath(entryPath);
  forget();

  const sentence = parse(`from name ${aPath} to name a be import do`);
  await assert.rejects(() => interpret(sentence), /module import cycle detected/);
});
