import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.join(__dirname, "..");

async function writeProgram(text) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-run-input-"));
  const file = path.join(dir, "program.pya");
  await fs.writeFile(file, text, "utf8");
  return file;
}

async function writeInputFixture() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-run-fixture-"));
  const file = path.join(dir, "input.txt");
  await fs.writeFile(file, "fixture input text\n", "utf8");
  return file;
}

test("run_pya_program binds shorthand filename when one filename input is declared", async () => {
  const runPath = path.join(repoRoot, "command", "run_pya_program.mjs");
  const inputFile = await writeInputFixture();
  const program = await writeProgram([
    "ob filename text manuscript be input ya",
    "from filename of ob of manuscript become wo text to name text out be read do"
  ].join("\n"));

  const missing = spawnSync(process.execPath, [runPath, program], {
    cwd: repoRoot,
    encoding: "utf8"
  });
  assert.notEqual(missing.status, 0, "expected missing binding to fail");

  const withBinding = spawnSync(process.execPath, [runPath, program, inputFile], {
    cwd: repoRoot,
    encoding: "utf8"
  });
  assert.equal(withBinding.status, 0, `expected shorthand binding to satisfy runtime input\nstderr:\n${withBinding.stderr || ""}`);
});

test("run_pya_program rejects shorthand when multiple filename inputs exist", async () => {
  const runPath = path.join(repoRoot, "command", "run_pya_program.mjs");
  const inputFile = await writeInputFixture();
  const program = await writeProgram([
    "ob ve filename text manuscript filename text outline be input ya",
    "ob text \"ok\" be write do"
  ].join("\n"));
  const out = spawnSync(process.execPath, [runPath, program, inputFile], {
    cwd: repoRoot,
    encoding: "utf8"
  });
  assert.notEqual(out.status, 0, "expected ambiguous shorthand to fail");
});

test("run_pya_program accepts explicit ob...to name binding tail", async () => {
  const runPath = path.join(repoRoot, "command", "run_pya_program.mjs");
  const inputFile = await writeInputFixture();
  const program = await writeProgram([
    "ob filename text manuscript be input ya",
    "from filename of ob of manuscript become wo text to name text out be read do"
  ].join("\n"));
  const out = spawnSync(
    process.execPath,
    [runPath, program, "ob", "filename", inputFile, "to", "name", "manuscript"],
    { cwd: repoRoot, encoding: "utf8" }
  );
  assert.equal(out.status, 0, `expected explicit binding to satisfy runtime input\nstderr:\n${out.stderr || ""}`);
});
