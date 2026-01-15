import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, remember } from "../program/remember/index.mjs";
import { setEntryModulePath } from "../program/bridge/modules.mjs";

test("forget clears module cache so re-import reloads module", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-module-"));
  const modulePath = path.join(tmpDir, "value_tools.pya");
  const entryPath = path.join(tmpDir, "entry.pya");

  await fs.writeFile(
    modulePath,
    [
      "exists su name value ob num 1 ya",
      "exists su name value be export ya"
    ].join("\n"),
    "utf8"
  );

  await fs.writeFile(
    entryPath,
    `from name ${modulePath} to name first be import do`,
    "utf8"
  );

  setEntryModulePath(entryPath);
  forget();

  await interpret(parse(`from name ${modulePath} to name first be import do`));
  assert.equal(remember("first value")?.ob?.num, 1);

  await fs.writeFile(
    modulePath,
    [
      "exists su name value ob num 2 ya",
      "exists su name value be export ya"
    ].join("\n"),
    "utf8"
  );

  forget();
  setEntryModulePath(entryPath);

  await interpret(parse(`from name ${modulePath} to name first be import do`));
  assert.equal(remember("first value")?.ob?.num, 2);
});
