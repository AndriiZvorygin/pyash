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

test("verify sentence complete accepts full text and appends period when missing", async () => {
  forget();
  await run('be verify as wo sentence complete ob text "Families lost homes to debt traps" to name map report do');
  const report = remember("report");
  assert.equal(report?.be, "map");
  assert.equal(report?.ob?.map?.pass, true);
  assert.equal(report?.ob?.map?.reason, "missing terminal punctuation");
  assert.equal(report?.ob?.map?.fixed, "Families lost homes to debt traps.");
  assert.equal(report?.ob?.map?.mode, "sentence complete");
  assert.equal(report?.ob?.map?.source, "ob text");
});

test("verify sentence complete keeps existing punctuation", async () => {
  forget();
  await run('be verify as wo sentence complete ob text "Families lost homes to debt traps." to name map report do');
  const report = remember("report");
  assert.equal(report?.ob?.map?.pass, true);
  assert.equal(report?.ob?.map?.reason, "ok");
  assert.equal(report?.ob?.map?.fixed, "Families lost homes to debt traps.");
  assert.equal(report?.ob?.map?.terminal, true);
});

test("verify sentence complete rejects ending connector", async () => {
  forget();
  await run('be verify as wo sentence complete ob text "Families lost homes and" to name map report do');
  const report = remember("report");
  assert.equal(report?.ob?.map?.pass, false);
  assert.equal(report?.ob?.map?.reason, "ending connector");
  assert.equal(report?.ob?.map?.fixed, "Families lost homes and");
});

test("verify sentence complete can read from filename and from name", async () => {
  forget();
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "verify-sentence-complete-file-"));
  const filePath = path.join(tmpDir, "source.txt");
  await fs.writeFile(filePath, "Restore shared ownership now", "utf8");
  await run(`exists su name file source ob filename "${filePath}" be filename ya`);
  await run("be verify as wo sentence complete from name file source to name map report do");
  const report = remember("report");
  assert.equal(report?.ob?.map?.pass, true);
  assert.equal(report?.ob?.map?.fixed, "Restore shared ownership now.");
  assert.equal(report?.ob?.map?.source, filePath);
});

test("verify sentence complete rejects missing from name source value", async () => {
  forget();
  await assert.rejects(
    () => run("be verify as wo sentence complete from name missing to name map report do"),
    /verify defective: expected from filename or from name or ob text/
  );
});
