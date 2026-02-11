import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);

test("refinery under conduct can override retry attempts", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-refinery-conduct-"));
  const configureDir = path.join(tmpDir, "configure");
  await fs.mkdir(configureDir, { recursive: true });
  await fs.writeFile(path.join(configureDir, "default.pya"), [
    "exists su name reiterate delay ob num 0 be number ya",
    "exists su name reiterate backoff ob num 2 be number ya",
    "exists su name reiterate attempts ob num 3 be number ya",
    "exists su name reiterate cap ob num 0 be number ya",
    ""
  ].join("\n"), "utf8");

  const programPath = path.join(tmpDir, "program.pya");
  await fs.writeFile(programPath, [
    "su name line be refinery def",
    "su name flaky ob text \"\" be command do",
    "prah",
    "su name tight conduct be map def",
    "su name reiterate attempts ob num 1 ya",
    "prah",
    "ob text \"x\" from name line under name tight conduct to name text out be refinery do",
    ""
  ].join("\n"), "utf8");

  const __filename = fileURLToPath(import.meta.url);
  const repoRoot = path.join(path.dirname(__filename), "..");
  const runPath = path.join(repoRoot, "command", "run_pya_program.mjs");

  await execFileAsync("node", [
    runPath,
    "--newspaper",
    "--run-id", "run-conduct",
    "--run-time", "2025-01-01T00:00:00Z",
    programPath
  ], { cwd: tmpDir, timeout: 120000 }).catch(() => {});

  const newspaperPath = path.join(tmpDir, "newspaper", "run-conduct.pya");
  const newspaper = await fs.readFile(newspaperPath, "utf8");
  assert.equal(newspaper.includes("be reiterate ya"), false);
});

