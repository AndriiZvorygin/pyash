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

test("runjs can emit a newspaper when requested", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-newspaper-js-"));
  const programPath = path.join(tmpDir, "program.pya");
  await fs.writeFile(programPath, "exists su name alpha ob num 1 be number ya\n", "utf8");

  const scriptPath = path.join(repoRoot, "runjs");
  await execFileAsync(scriptPath, [
    "--newspaper",
    "--run-id", "run-js",
    "--run-time", "2025-01-01T00:00:00Z",
    programPath
  ], { cwd: tmpDir, timeout: 120000 });

  const newspaperPath = path.join(tmpDir, "newspaper", "run-js.pya");
  const newspaper = await fs.readFile(newspaperPath, "utf8");
  const lines = normalizeLines(newspaper);

  assert.equal(lines[0], "exists su name run-js from time 2025-01-01T00:00:00Z be run ya");
  assert.ok(lines.some(line => line.includes("be evoke ya")));
  assert.equal(lines.at(-1), "exists su name run-js be end ya");
});
