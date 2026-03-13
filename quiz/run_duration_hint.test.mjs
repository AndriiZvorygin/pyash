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
  assert.match(stderr, /run duration: .+/);
  assert.match(stderr, /artifacts folder: .+artifacts[\\/]+run-duration/);
});
