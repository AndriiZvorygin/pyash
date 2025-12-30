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

test("runjs reuses artifact name for repeated writes to same locator", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-exchange-reuse-js-"));
  const programPath = path.join(tmpDir, "program.pya");
  await fs.writeFile(programPath, [
    "ob text \"alpha\" to filename \"out.txt\" be write do",
    "ob text \"alpha\" to filename \"out.txt\" be write do",
    ""
  ].join("\n"), "utf8");

  const scriptPath = path.join(repoRoot, "runjs");
  await execFileAsync(scriptPath, [
    "--newspaper",
    "--run-id", "run-exchange-reuse-js",
    "--run-time", "2025-01-01T00:00:00Z",
    programPath
  ], { cwd: tmpDir, timeout: 120000 });

  const newspaperPath = path.join(tmpDir, "newspaper", "run-exchange-reuse-js.pya");
  const newspaper = await fs.readFile(newspaperPath, "utf8");
  const lines = normalizeLines(newspaper);
  const artifactLines = lines.filter(line => line.includes("be artifact") && line.includes("out.txt"));
  const exchangeLines = lines.filter(line => line.includes("be exchange") && line.includes("as name write"));

  assert.equal(artifactLines.length, 1);
  assert.equal(exchangeLines.length, 2);
});
