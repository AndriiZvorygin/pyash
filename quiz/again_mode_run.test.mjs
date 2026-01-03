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

test("--again forces newspaper and records again marker", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-again-"));
  const programPath = path.join(tmpDir, "program.pya");
  await fs.writeFile(programPath, "ob text \"alpha\" to filename \"out.txt\" be write do\n", "utf8");

  const runPath = path.join(repoRoot, "program", "command", "run_pya_program.mjs");
  await execFileAsync("node", [
    runPath,
    "--again",
    "--run-id", "run-again",
    "--run-time", "2025-01-01T00:00:00Z",
    programPath
  ], { cwd: tmpDir, timeout: 120000 });

  const newspaperPath = path.join(tmpDir, "newspaper", "run-again.pya");
  const newspaper = await fs.readFile(newspaperPath, "utf8");
  const lines = normalizeLines(newspaper);

  assert.ok(lines.some(line => line === "su name run-again as name again be run ya"));
  assert.ok(lines.some(line => line.includes("be run ya") && line.includes("su name run-again")), "expected run start record");
  assert.ok(lines.some(line => line.includes("be run root ya")), "expected run root record");
  assert.ok(lines.some(line => line.includes("be artifact") && line.includes("out.txt")));
});
