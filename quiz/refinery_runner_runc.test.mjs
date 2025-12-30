import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.join(path.dirname(__filename), "..");

function normalizeLines(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map(line => line.trimEnd())
    .filter(line => line.length > 0);
}

test("runc refinery runner executes platforms in deterministic order", async () => {
  const scriptPath = path.join(repoRoot, "runc");
  const programPath = path.join(repoRoot, "examples", "pyash", "refinery-pass.pya");
  const { stdout } = await execFileAsync(scriptPath, ["--refinery", "line", programPath], {
    cwd: repoRoot,
    timeout: 120000
  });
  const lines = normalizeLines(stdout).filter(line => line === "a" || line === "b");
  assert.deepEqual(lines, ["a", "b"]);
});
