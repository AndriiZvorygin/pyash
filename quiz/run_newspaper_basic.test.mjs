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

function normalizeLines(text) {
  return String(text)
    .split(/\r?\n/)
    .map(line => line.trimEnd())
    .filter(line => line.length > 0);
}

test("run writes run newspaper with evoke/result", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-newspaper-"));
  const programPath = path.join(tmpDir, "program.pya");
  await fs.writeFile(programPath, "exists su name alpha ob num 1 be number ya\n", "utf8");

  const scriptPath = path.join(repoRoot, "command/run_pya_program.mjs");
  await execFileAsync(process.execPath, [
    scriptPath,
    "--newspaper",
    "--run-id", "run-1",
    "--run-time", "2025-01-01T00:00:00Z",
    programPath
  ], { cwd: tmpDir, timeout: 120000 });

  const newspaperPath = path.join(tmpDir, "newspaper", "run-1.pya");
  const newspaper = await fs.readFile(newspaperPath, "utf8");
  const lines = normalizeLines(newspaper);

  assert.equal(lines[0], "exists su name run-1 from time 2025-01-01T00:00:00Z be run ya");
  assert.ok(lines[1].startsWith("ob filename "));
  assert.equal(lines[2], "exists su name evoke-0 ob la exists su name alpha ob num 1 be number ya ko be evoke ya");
  assert.equal(lines[3], "exists su name alpha ob num 1 be number ya");
  assert.equal(lines[4], "exists su name run-1 be end ya");
});
