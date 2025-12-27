import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { remember, forget } from "../program/remember/index.mjs";
import { setEntryModulePath } from "../program/bridge/modules.mjs";

const fixturesDir = path.resolve("quiz/fixtures/modules");
const entryPath = path.join(fixturesDir, "entry.pya");

async function run(line) {
  const s = parse(line);
  return interpret(s);
}

test("module import binds namespace and ceremonies", async () => {
  forget();
  setEntryModulePath(entryPath);

  await run("from name math tools to name math be import do");

  const math = remember("math");
  assert.equal(math?.be, "map");
  assert.equal(math?.ob?.map?.pi?.num, 3.14);

  await run("to name out be math add two do");
  const out = remember("out");
  assert.equal(out?.ob?.num, 2);
});

test("module import rejects top-level do in imported module", async () => {
  forget();
  setEntryModulePath(entryPath);

  await assert.rejects(
    () => run("from name bad module to name trouble be import do"),
    /top-level do is forbidden/
  );
});
