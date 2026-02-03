import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);

test("refinery checkpoints reuse prior results", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-refinery-checkpoint-"));
  const programPath = path.join(tmpDir, "program.pya");
  await fs.writeFile(programPath, [
    "su name line be refinery def",
    "su name writeout ob text \"alpha\" to filename \"out.txt\" be write do",
    "prah",
    ""
  ].join("\n"), "utf8");

  const __filename = fileURLToPath(import.meta.url);
  const repoRoot = path.join(path.dirname(__filename), "..");
  const runPath = path.join(repoRoot, "command", "run_pya_program.mjs");
  await execFileAsync("node", [
    runPath,
    "--refinery", "line",
    "--newspaper",
    "--run-id", "run-checkpoint",
    "--run-time", "2025-01-01T00:00:00Z",
    programPath
  ], { cwd: tmpDir, timeout: 120000 });

  const firstOut = path.join(tmpDir, "out.txt");
  await fs.access(firstOut);
  await fs.unlink(firstOut);

  await execFileAsync("node", [
    runPath,
    "--refinery", "line",
    "--newspaper",
    "--run-id", "run-checkpoint",
    "--run-time", "2025-01-01T00:00:01Z",
    programPath
  ], { cwd: tmpDir, timeout: 120000 });

  let recreated = true;
  try {
    await fs.access(firstOut);
  } catch {
    recreated = false;
  }
  assert.equal(recreated, false);

  const newspaperPath = path.join(tmpDir, "newspaper", "run-checkpoint.pya");
  const newspaper = await fs.readFile(newspaperPath, "utf8");
  assert.ok(newspaper.includes("be checkpoint ya"));
});
