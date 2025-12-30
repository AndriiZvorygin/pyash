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

test("refinery runner ordering, fail-fast, newspaper entries", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-refinery-"));
  const programPath = path.join(tmpDir, "program.pya");
  await fs.writeFile(programPath, [
    "su name line be refinery def",
    "su name beta ob la ob text \"b\" be write do ko be platform ya",
    "su name alpha ob la ob text \"a\" be write do ko be platform ya",
    "su name crash ob la ob text \"boom\" be unknown do ko be platform ya",
    "su name delta ob la ob text \"d\" be write do ko be platform ya",
    "prah",
    ""
  ].join("\n"), "utf8");

  const runPath = path.join(repoRoot, "program", "command", "run_pya_program.mjs");
  await execFileAsync("node", [
    runPath,
    "--refinery", "line",
    "--newspaper",
    "--run-id", "run-refinery",
    "--run-time", "2025-01-01T00:00:00Z",
    programPath
  ], { cwd: tmpDir, timeout: 120000 });

  const newspaperPath = path.join(tmpDir, "newspaper", "run-refinery.pya");
  const newspaper = await fs.readFile(newspaperPath, "utf8");
  const lines = normalizeLines(newspaper);
  const evokeLines = lines.filter(line => line.includes("be evoke ya"));
  const actionEvokes = evokeLines.filter(line => line.startsWith("ob la ob text"));

  assert.ok(actionEvokes.some(line => line.includes("ob text \"a\"")));
  assert.ok(actionEvokes.some(line => line.includes("ob text \"b\"")));
  assert.ok(actionEvokes.some(line => line.includes("ob text \"boom\"")));
  assert.ok(!actionEvokes.some(line => line.includes("ob text \"d\"")));

  const alphaIndex = actionEvokes.findIndex(line => line.includes("ob text \"a\""));
  const betaIndex = actionEvokes.findIndex(line => line.includes("ob text \"b\""));
  assert.ok(alphaIndex !== -1 && betaIndex !== -1);
  assert.ok(alphaIndex < betaIndex);

  assert.ok(lines.some(line => line.includes("be error") && line.endsWith("ya")));
});
