import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.join(path.dirname(__filename), "..");

test("run prints timing summary with artifacts folder at the end", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-run-duration-"));
  const programPath = path.join(tmpDir, "program.pya");
  await fs.writeFile(programPath, "exists su name alpha ob num 1 be number ya\n", "utf8");

  const scriptPath = path.join(repoRoot, "command/run_pya_program.mjs");
  const { stderr } = await execFileAsync(process.execPath, [
    scriptPath,
    "--run-id", "run-duration",
    "--run-time", "2025-01-01T00:00:00Z",
    programPath
  ], { cwd: tmpDir, timeout: 120000 });

  assert.match(stderr, /run start: 2025-01-01T00:00:00Z/);
  assert.match(stderr, /run end: .+/);
  assert.match(stderr, /run duration: \d{2}:\d{2}\.\d{3}(?:\r?\n|$)/);
  assert.match(stderr, /artifacts folder: .+artifacts[\\/]+run-duration/);
});

test("run writes nested artifact folders when run id contains hierarchy", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-run-duration-nested-"));
  const programPath = path.join(tmpDir, "program.pya");
  await fs.writeFile(programPath, 'ob text "nested" to name text result be text do ya\n', "utf8");

  const scriptPath = path.join(repoRoot, "command/run_pya_program.mjs");
  const { stderr } = await execFileAsync(process.execPath, [
    scriptPath,
    "--run-id", "parent-run/learn-pipeline/direct",
    "--run-time", "2025-01-01T00:00:00Z",
    programPath
  ], { cwd: tmpDir, timeout: 120000 });

  assert.match(stderr, /artifacts folder: .+artifacts[\\/]parent-run[\\/]learn-pipeline[\\/]direct/);
  const nestedProduce = path.join(tmpDir, "artifacts", "parent-run", "learn-pipeline", "direct", "produce.txt");
  const text = await fs.readFile(nestedProduce, "utf8");
  assert.equal(text.trim(), "nested");
});
