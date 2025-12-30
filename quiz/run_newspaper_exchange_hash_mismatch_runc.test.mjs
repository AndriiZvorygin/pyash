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

test("runc hash mismatch surfaces be error ya", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-exchange-hash-c-"));
  const programPath = path.join(tmpDir, "program.pya");
  await fs.writeFile(programPath, [
    "ob text \"alpha\" to filename \"out.txt\" be write do",
    "ob text \"beta\" to filename \"out.txt\" be write do",
    ""
  ].join("\n"), "utf8");

  const scriptPath = path.join(repoRoot, "runc");
  await execFileAsync(scriptPath, [
    "--newspaper",
    "--run-id", "run-exchange-hash-c",
    "--run-time", "2025-01-01T00:00:00Z",
    programPath
  ], { cwd: tmpDir, timeout: 120000 }).catch(() => {});

  const newspaperPath = path.join(tmpDir, "newspaper", "run-exchange-hash-c.pya");
  const newspaper = await fs.readFile(newspaperPath, "utf8");
  const lines = normalizeLines(newspaper);
  const hashError = lines.find(line => line.includes("hash inconsistency") && line.includes("be error"));
  assert.ok(hashError);
});
