import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget } from "../program/remember/index.mjs";

test("csv roundtrip from filename with spaces", async () => {
  forget();

  const csvPath = path.resolve("quiz/fixtures/Bank Transaction.csv");
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-csv-"));
  const outPath = path.join(tmpDir, "roundtrip.csv");

  await interpret(parse(`from filename "${csvPath}" from state csv to name people be read do`));
  await interpret(parse(`ob name people to state csv to filename "${outPath}" be write do`));

  const written = await fs.readFile(outPath, "utf8");
  assert.equal(written, "Name,Age\nAda,36\nTuring,\n");
});
