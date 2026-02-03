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

  const runPath = path.join(repoRoot, "command", "run_pya_program.mjs");
  await execFileAsync("node", [
    runPath,
    "--again",
    "--run-id", "run-replay",
    "--run-time", "2025-01-01T00:00:00Z",
    programPath
  ], { cwd: tmpDir, timeout: 120000 });

  const newspaperPath = path.join(tmpDir, "newspaper", "run-replay.pya");
  const newspaper = await fs.readFile(newspaperPath, "utf8");
  const artifactLine = newspaper.split(/\r?\n/).find(line => line.includes("be artifact"));
  const hashMatch = artifactLine?.match(/fromtext text \"([a-f0-9]+)\"/);
  const locatorMatch = artifactLine?.match(/to filename (\"([^\"]+)\"|([^ ]+))/);
  const hash = hashMatch?.[1];
  const locator = locatorMatch?.[2] || locatorMatch?.[3];
  assert.ok(hash);
  assert.ok(locator);
  const ext = path.extname(locator);
  const caRel = path.join("artifacts", "sha256", hash.slice(0, 2), hash.slice(2, 4), `${hash}${ext}`);
  await fs.writeFile(path.join(tmpDir, caRel), "tampered\n", "utf8");

  const replayPath = path.join(repoRoot, "command", "replay_newspaper.mjs");
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
