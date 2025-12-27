import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";

test("pyash csv map writes csv and reads back to pyash", async () => {
  forget();

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-csv-"));
  const csvPath = path.join(tmpDir, "roundtrip.csv");
  const pyashPath = path.join(tmpDir, "roundtrip.pya");

  const lines = [
    "su name people be csv map def",
    "su name header raw ob ve text Name Age ya",
    "su name header ob ve text name age ya",
    "su name name ob ve text Ada Turing ya",
    "su name age ob ve text 36 41 ya",
    "prah",
    `ob name people to state csv to filename "${csvPath}" be write do`,
    `from filename "${csvPath}" from state csv to name round be read do`,
    `ob name round be write to filename "${pyashPath}" do`
  ];

  for (const line of lines) {
    await interpret(parse(line));
  }

  const pyash = await fs.readFile(pyashPath, "utf8");
  const expected = [
    "su name round be csv map def",
    "su name header raw ob ve text Name Age ya",
    "su name header ob ve text name age ya",
    "su name name ob ve text Ada Turing ya",
    "su name age ob ve text 36 41 ya",
    "prah"
  ].join("\n");

  assert.equal(pyash.trim(), expected);
});
