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

test("refinery runner respects depend ordering", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-refinery-deps-"));
  const programPath = path.join(tmpDir, "program.pya");
  await fs.writeFile(programPath, [
    "su name build be refinery def",
    "su name alpha ob text \"alpha\" be write do",
    "su name beta from ve name alpha ob text \"beta\" be write do",
    "su name gamma from ve name alpha ob text \"gamma\" be write do",
    "su name zeta from ve name beta gamma ob text \"zeta\" be write do",
    "prah",
    ""
  ].join("\n"), "utf8");

  const runPath = path.join(repoRoot, "command", "run_pya_program.mjs");
  await execFileAsync("node", [
    runPath,
    "--refinery", "build",
    "--newspaper",
    "--run-id", "run-refinery-deps",
    "--run-time", "2025-01-01T00:00:00Z",
    programPath
  ], { cwd: tmpDir, timeout: 120000 });

  const newspaperPath = path.join(tmpDir, "newspaper", "run-refinery-deps.pya");
  const newspaper = await fs.readFile(newspaperPath, "utf8");
  const lines = normalizeLines(newspaper);
  const evokes = lines.filter(line => line.startsWith("ob la su name") && line.includes("be write do ko be evoke ya"));
  const order = evokes.map(line => {
    if (line.includes("\"alpha\"")) return "alpha";
    if (line.includes("\"beta\"")) return "beta";
    if (line.includes("\"gamma\"")) return "gamma";
    if (line.includes("\"zeta\"")) return "zeta";
    return null;
  }).filter(Boolean);

  assert.deepStrictEqual(order, ["alpha", "beta", "gamma", "zeta"]);
});
