import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";

import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { forget, remember } from "../program/remember/index.mjs";

async function run(line) {
  return interpret(parse(line));
}

async function withTempDir(fn) {
  const prevCwd = process.cwd();
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-repair-"));
  process.chdir(tempRoot);
  try {
    await fn(tempRoot);
  } finally {
    process.chdir(prevCwd);
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

test("repair check validates patch and does not write files", async () => {
  await withTempDir(async () => {
    forget();
    await fs.writeFile("note.txt", "alpha\n", "utf8");
    const patch = [
      "--- a/note.txt",
      "+++ b/note.txt",
      "@@ -1,1 +1,1 @@",
      "-alpha",
      "+beta"
    ].join("\n");
    await run(`ob text quoted.text.${patch}.text.quoted as wo check to name map outcome be repair do`);
    const text = await fs.readFile("note.txt", "utf8");
    assert.equal(text, "alpha\n");
    assert.equal(remember("outcome")?.ob?.map?.mode?.text, "check");
    assert.equal(remember("outcome")?.ob?.map?.files_total?.num, 1);
  });
});

test("repair apply updates file content", async () => {
  await withTempDir(async () => {
    forget();
    await fs.writeFile("note.txt", "alpha\n", "utf8");
    const patch = [
      "--- a/note.txt",
      "+++ b/note.txt",
      "@@ -1,1 +1,1 @@",
      "-alpha",
      "+beta"
    ].join("\n");
    await run(`ob text quoted.text.${patch}.text.quoted to name map outcome be repair do`);
    const text = await fs.readFile("note.txt", "utf8");
    assert.equal(text, "beta\n");
    assert.equal(remember("outcome")?.ob?.map?.mode?.text, "apply");
    assert.equal(remember("outcome")?.ob?.map?.files_changed?.num, 1);
    assert.equal(remember("outcome")?.ob?.map?.files?.map?.["note.txt"]?.map?.status?.text, "updated");
  });
});

test("repair rejects unsafe paths", async () => {
  await withTempDir(async () => {
    forget();
    const patch = [
      "--- /dev/null",
      "+++ ../../escape.txt",
      "@@ -0,0 +1,1 @@",
      "+bad"
    ].join("\n");
    await assert.rejects(
      async () => run(`ob text quoted.text.${patch}.text.quoted be repair do`),
      (err) => err?.sentence?.su?.name === "repair path defective"
    );
  });
});

test("repair is atomic on validation failure", async () => {
  await withTempDir(async () => {
    forget();
    await fs.writeFile("first.txt", "one\n", "utf8");
    await fs.writeFile("second.txt", "two\n", "utf8");
    const patch = [
      "--- a/first.txt",
      "+++ b/first.txt",
      "@@ -1,1 +1,1 @@",
      "-one",
      "+uno",
      "--- a/second.txt",
      "+++ b/second.txt",
      "@@ -1,1 +1,1 @@",
      "-missing",
      "+dos"
    ].join("\n");
    await assert.rejects(
      async () => run(`ob text quoted.text.${patch}.text.quoted be repair do`),
      (err) => err?.sentence?.su?.name === "repair hunk defective"
    );
    assert.equal(await fs.readFile("first.txt", "utf8"), "one\n");
    assert.equal(await fs.readFile("second.txt", "utf8"), "two\n");
  });
});
