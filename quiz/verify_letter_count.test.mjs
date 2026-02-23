import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, remember } from "../program/remember/index.mjs";

async function run(line) {
  return interpret(parse(line));
}

test("verify letter count from ob text stores map output in to name", async () => {
  forget();
  await run('be verify as wo letter count atleast num 10 atmost num 10 ob text "alpha beta" to name report do');
  const report = remember("report");
  assert.equal(report?.be, "map");
  assert.equal(report?.ob?.map?.pass, true);
  assert.equal(report?.ob?.map?.letters, 10);
  assert.equal(report?.ob?.map?.atleast, 10);
  assert.equal(report?.ob?.map?.atmost, 10);
  assert.equal(report?.ob?.map?.source, "ob text");
  assert.equal(report?.ob?.map?.mode, "letter count");
});

test("verify letter count from filename reads file and passes bounds", async () => {
  forget();
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "verify-letter-count-file-"));
  const filePath = path.join(tmpDir, "source.txt");
  await fs.writeFile(filePath, "one two", "utf8");
  await run(`be verify as wo letter count atleast num 7 atmost num 7 from filename "${filePath}" to name map file report do`);
  const report = remember("file report");
  assert.equal(report?.ob?.map?.pass, true);
  assert.equal(report?.ob?.map?.letters, 7);
  assert.equal(report?.ob?.map?.source, filePath);
});

test("verify letter count from name text source resolves remembered text", async () => {
  forget();
  await run('exists su name text source ob text "abc def" be text ya');
  await run("be verify as wo letter count atleast num 7 atmost num 7 from name text source to name map report do");
  const report = remember("report");
  assert.equal(report?.ob?.map?.pass, true);
  assert.equal(report?.ob?.map?.letters, 7);
  assert.equal(report?.ob?.map?.source, "source");
});

test("verify letter count from name can read filename facts", async () => {
  forget();
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "verify-letter-count-name-file-"));
  const filePath = path.join(tmpDir, "source.txt");
  await fs.writeFile(filePath, "one", "utf8");
  await run(`exists su name file source ob filename "${filePath}" be filename ya`);
  await run("be verify as wo letter count atleast num 4 atmost num 4 from name file source to name map report do");
  const report = remember("report");
  assert.equal(report?.ob?.map?.pass, false);
  assert.equal(report?.ob?.map?.letters, 3);
  assert.equal(report?.ob?.map?.source, filePath);
});

test("verify letter count rejects missing from name source value", async () => {
  forget();
  await assert.rejects(
    () => run("be verify as wo letter count atleast num 8 atmost num 9 from name missing to name map report do"),
    /verify defective: expected from filename or from name or ob text/
  );
});
