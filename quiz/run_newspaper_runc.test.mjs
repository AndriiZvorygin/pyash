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

test("runc can emit a newspaper when requested", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-newspaper-c-"));
  const programPath = path.join(tmpDir, "program.pya");
  await fs.writeFile(programPath, "exists su name alpha ob num 1 be number ya\n", "utf8");

  const scriptPath = path.join(repoRoot, "runc");
  await execFileAsync(scriptPath, [
    "--newspaper",
    "--run-id", "run-c",
    "--run-time", "2025-01-01T00:00:00Z",
    programPath
  ], { cwd: tmpDir, timeout: 120000 });

  const newspaperPath = path.join(tmpDir, "newspaper", "run-c.pya");
  const newspaper = await fs.readFile(newspaperPath, "utf8");
  const lines = normalizeLines(newspaper);

  assert.equal(lines[0], "su name run-c from time 2025-01-01T00:00:00Z be run ya");
  assert.ok(lines.some(line => line.includes("be evoke ya")));
  assert.equal(lines.at(-1), "su name run-c be end ya");
});
