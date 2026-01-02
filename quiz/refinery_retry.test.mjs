import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);

test("refinery retries on error and records reiterate", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-refinery-retry-"));
  const configureDir = path.join(tmpDir, "configure");
  await fs.mkdir(configureDir, { recursive: true });
  await fs.writeFile(path.join(configureDir, "default.pya"), [
    "su name reiterate delay ob num 0 be number ya",
    "su name reiterate backoff ob num 2 be number ya",
    "su name reiterate attempts ob num 2 be number ya",
    "su name reiterate cap ob num 0 be number ya",
    ""
  ].join("\n"), "utf8");

  const programPath = path.join(tmpDir, "program.pya");
  await fs.writeFile(programPath, [
    "su name line be refinery def",
    "su name flaky ob la ob text \"\" be command do ko be platform ya",
    "prah",
    ""
  ].join("\n"), "utf8");

  const __filename = fileURLToPath(import.meta.url);
  const repoRoot = path.join(path.dirname(__filename), "..");
  const runPath = path.join(repoRoot, "program", "command", "run_pya_program.mjs");

  await execFileAsync("node", [
    runPath,
    "--refinery", "line",
    "--newspaper",
    "--run-id", "run-retry",
    "--run-time", "2025-01-01T00:00:00Z",
    programPath
  ], { cwd: tmpDir, timeout: 120000 }).catch(() => {});

  const newspaperPath = path.join(tmpDir, "newspaper", "run-retry.pya");
  const newspaper = await fs.readFile(newspaperPath, "utf8");
  assert.ok(newspaper.includes("be reiterate ya"));
  assert.ok(newspaper.includes("by num 2"));
});
