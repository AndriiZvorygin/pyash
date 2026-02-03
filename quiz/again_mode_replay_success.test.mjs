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

test("replay succeeds when hashes match", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-replay-ok-"));
  const programPath = path.join(tmpDir, "program.pya");
  await fs.writeFile(programPath, "ob text \"alpha\" to filename \"out.txt\" be write do\n", "utf8");

  const runPath = path.join(repoRoot, "command", "run_pya_program.mjs");
  await execFileAsync("node", [
    runPath,
    "--again",
    "--run-id", "run-replay-ok",
    "--run-time", "2025-01-01T00:00:00Z",
    programPath
  ], { cwd: tmpDir, timeout: 120000 });

  const replayPath = path.join(repoRoot, "command", "replay_newspaper.mjs");
  await execFileAsync("node", [
    replayPath,
    "--run-id", "run-replay-ok",
    "--run-root", tmpDir
  ], { cwd: tmpDir, timeout: 120000 });
  assert.ok(true);
});
