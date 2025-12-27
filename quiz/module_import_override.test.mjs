import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";
import { setEntryModulePath } from "../program/bridge/modules.mjs";
import { splitSentences } from "../program/library/sentenceSplitter.mjs";

test("imported ceremonies with same name stay isolated by alias", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-module-"));
  const leftPath = path.join(tmpDir, "left.pya");
  const rightPath = path.join(tmpDir, "right.pya");
  const entryPath = path.join(tmpDir, "entry.pya");

  await fs.writeFile(
    leftPath,
    [
      "su name bump be ceremony def",
      "  ob num 1 be write do",
      "prah",
      "su name bump be export ya"
    ].join("\n"),
    "utf8"
  );

  await fs.writeFile(
    rightPath,
    [
      "su name bump be ceremony def",
      "  ob num 2 be write do",
      "prah",
      "su name bump be export ya"
    ].join("\n"),
    "utf8"
  );

  await fs.writeFile(
    entryPath,
    [
      `from name ${leftPath} to name left be import do`,
      `from name ${rightPath} to name right be import do`,
      "be left bump do",
      "be right bump do"
    ].join("\n"),
    "utf8"
  );

  setEntryModulePath(entryPath);
  forget();

  const source = await fs.readFile(entryPath, "utf8");
  const lines = splitSentences(source);

  const logs = [];
  const originalLog = console.log;
  // eslint-disable-next-line no-console
  console.log = (...args) => logs.push(args.join(" "));
  try {
    for (const line of lines) {
      if (!line.trim()) continue;
      const sentence = parse(line);
      await interpret(sentence);
    }
  } finally {
    // eslint-disable-next-line no-console
    console.log = originalLog;
  }

  assert.deepEqual(logs, ["1", "2"]);
});
