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

test("run can emit tool event for command", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-newspaper-command-"));
  const programPath = path.join(tmpDir, "program.pya");
  await fs.writeFile(programPath, "ob text \"noop\" to name text output be command do\n", "utf8");

  const scriptPath = path.join(repoRoot, "program", "command", "run_pya_program.mjs");
  await execFileAsync("node", [
    scriptPath,
    "--newspaper",
    "--run-id", "run-command",
    "--run-time", "2025-01-01T00:00:00Z",
    programPath
  ], {
    cwd: tmpDir,
    timeout: 120000,
    env: { ...process.env, PYA_COMMAND_RESPONSE: "ok" }
  });

  const newspaperPath = path.join(tmpDir, "newspaper", "run-command.pya");
  const newspaper = await fs.readFile(newspaperPath, "utf8");
  const lines = normalizeLines(newspaper);
  const toolEvent = lines.find(line => line.includes("be tool ya"));
  assert.ok(toolEvent, "expected tool event record");
});
