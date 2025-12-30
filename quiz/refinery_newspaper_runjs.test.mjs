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

test("runjs refinery newspaper records platform evoke/result", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-refinery-news-js-"));
  const programPath = path.join(repoRoot, "examples", "pyash", "refinery-pass.pya");
  const scriptPath = path.join(repoRoot, "runjs");

  await execFileAsync(scriptPath, [
    "--newspaper",
    "--refinery", "line",
    "--run-id", "run-refinery-js",
    "--run-time", "2025-01-01T00:00:00Z",
    programPath
  ], { cwd: tmpDir, timeout: 120000 });

  const newspaperPath = path.join(tmpDir, "newspaper", "run-refinery-js.pya");
  const newspaper = await fs.readFile(newspaperPath, "utf8");
  const lines = normalizeLines(newspaper);
  const evokes = lines.filter(line => line.includes("be evoke ya"));
  const results = lines.filter(line => line.includes("be write do"));

  const evokeA = "ob la ob text \"a\" be write do ko be evoke ya";
  const evokeB = "ob la ob text \"b\" be write do ko be evoke ya";
  assert.ok(evokes.includes(evokeA));
  assert.ok(evokes.includes(evokeB));
  assert.ok(results.includes("ob text \"a\" be write do"));
  assert.ok(results.includes("ob text \"b\" be write do"));

  assert.ok(lines.indexOf(evokeA) < lines.indexOf(evokeB));
});
