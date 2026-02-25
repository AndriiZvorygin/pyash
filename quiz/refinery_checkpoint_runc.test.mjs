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

test("runc refinery reruns stage when checkpoint output file is missing", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-refinery-checkpoint-c-"));
  const programPath = path.join(tmpDir, "program.pya");
  await fs.writeFile(programPath, [
    "su name line be refinery def",
    "su name writeout ob text \"alpha\" to filename \"out.txt\" be write do",
    "prah",
    ""
  ].join("\n"), "utf8");

  const runcPath = path.join(repoRoot, "runc");
  await execFileAsync(runcPath, [
    "--newspaper",
    "--refinery", "line",
    "--run-id", "run-checkpoint-c",
    "--run-time", "2025-01-01T00:00:00Z",
    programPath
  ], { cwd: tmpDir, timeout: 120000 });

  const firstOut = path.join(tmpDir, "out.txt");
  await fs.access(firstOut);
  await fs.unlink(firstOut);

  await execFileAsync(runcPath, [
    "--newspaper",
    "--refinery", "line",
    "--run-id", "run-checkpoint-c",
    "--run-time", "2025-01-01T00:00:01Z",
    programPath
  ], { cwd: tmpDir, timeout: 120000 });

  let recreated = true;
  try {
    await fs.access(firstOut);
  } catch {
    recreated = false;
  }
  assert.equal(recreated, true);
});
