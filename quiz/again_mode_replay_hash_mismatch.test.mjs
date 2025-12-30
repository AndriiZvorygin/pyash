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

test("replay rejects hash mismatch", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-replay-"));
  const programPath = path.join(tmpDir, "program.pya");
  await fs.writeFile(programPath, "ob text \"alpha\" to filename \"out.txt\" be write do\n", "utf8");

  const runPath = path.join(repoRoot, "program", "command", "run_pya_program.mjs");
  await execFileAsync("node", [
    runPath,
    "--again",
    "--run-id", "run-replay",
    "--run-time", "2025-01-01T00:00:00Z",
    programPath
  ], { cwd: tmpDir, timeout: 120000 });

  await fs.writeFile(path.join(tmpDir, "out.txt"), "tampered\n", "utf8");

  const replayPath = path.join(repoRoot, "program", "command", "replay_newspaper.mjs");
  let failed = false;
  try {
    await execFileAsync("node", [
      replayPath,
      "--run-id", "run-replay",
      "--run-root", tmpDir
    ], { cwd: tmpDir, timeout: 120000 });
  } catch (err) {
    failed = true;
  }
  assert.ok(failed);
});
