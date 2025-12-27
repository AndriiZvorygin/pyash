import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs/promises";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, remember } from "../program/remember/index.mjs";
import { setEntryModulePath } from "../program/bridge/modules.mjs";
import { splitSentences } from "../program/library/sentenceSplitter.mjs";

test("module import allows multiple aliases for same module", async () => {
  forget();
  const entryPath = path.resolve("examples/pyash/module-import-aliases.pya");
  setEntryModulePath(entryPath);

  const source = await fs.readFile(entryPath, "utf8");
  const lines = splitSentences(source);

  for (const line of lines) {
    if (!line.trim()) continue;
    const sentence = parse(line);
    await interpret(sentence);
  }

  const firstCounter = remember("first counter");
  const secondCounter = remember("second counter");
  const firstNamespace = remember("first");
  const secondNamespace = remember("second");

  assert.equal(firstCounter?.ob?.num, 1);
  assert.equal(secondCounter?.ob?.num, 1);
  assert.equal(firstNamespace?.ob?.map?.counter?.name, "first counter");
  assert.equal(secondNamespace?.ob?.map?.counter?.name, "second counter");
});
