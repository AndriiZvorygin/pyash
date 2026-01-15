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

test("run newspaper records surfaced error", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-newspaper-"));
  const programPath = path.join(tmpDir, "program.pya");
  await fs.writeFile(programPath, "be blorp do\n", "utf8");

  const scriptPath = path.join(repoRoot, "program/command/run_pya_program.mjs");
  let failed = false;
  try {
    await execFileAsync(process.execPath, [
      scriptPath,
      "--newspaper",
      "--run-id", "run-err",
      "--run-time", "2025-01-01T00:00:00Z",
      programPath
    ], { cwd: tmpDir, timeout: 120000 });
  } catch {
    failed = true;
  }
  assert.equal(failed, true);

  const newspaperPath = path.join(tmpDir, "newspaper", "run-err.pya");
  const newspaper = await fs.readFile(newspaperPath, "utf8");
  const lines = normalizeLines(newspaper);

  assert.equal(lines[0], "exists su name run-err from time 2025-01-01T00:00:00Z be run ya");
  assert.ok(lines[1].startsWith("ob filename "));
  assert.ok(lines.some(line => line.includes("be error") && line.endsWith(" ya")));
  assert.equal(lines.at(-1), "exists su name run-err be end ya");
});
