import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { execFile, spawnSync } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const canCaptureNodeChildStdout = (() => {
  const { stdout } = spawnSync(process.execPath, ["-e", "console.log('ok')"], { encoding: "utf8" });
  return String(stdout ?? "").trim() === "ok";
})();

test("refinery reruns stage when checkpoint output file is missing", async (t) => {
  if (!canCaptureNodeChildStdout) t.skip("environment cannot capture node child stdout");
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
  assert.equal(recreated, true);

  const newspaperPath = path.join(tmpDir, "newspaper", "run-checkpoint.pya");
  const newspaper = await fs.readFile(newspaperPath, "utf8");
  assert.ok(newspaper.includes("be checkpoint ya"));
});

test("refinery checkpoint replay preserves series payload in result", async (t) => {
  if (!canCaptureNodeChildStdout) t.skip("environment cannot capture node child stdout");
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-refinery-checkpoint-series-"));
  const programPath = path.join(tmpDir, "program.pya");
  await fs.writeFile(programPath, [
    "su name items be series def",
    "su name item 1 ob text \"alpha\" be text ya",
    "prah",
    "su name line be refinery def",
    "su name copy from name items by name text to name text mapped be series map do",
    "prah",
    "from name line be refinery do",
    ""
  ].join("\n"), "utf8");

  const __filename = fileURLToPath(import.meta.url);
  const repoRoot = path.join(path.dirname(__filename), "..");
  const runPath = path.join(repoRoot, "command", "run_pya_program.mjs");

  await execFileAsync("node", [
    runPath,
    "--gross",
    "--run-id", "run-checkpoint-series",
    "--run-time", "2025-01-01T00:00:00Z",
    programPath
  ], { cwd: tmpDir, timeout: 120000 });

  const second = await execFileAsync("node", [
    runPath,
    "--gross",
    "--run-id", "run-checkpoint-series",
    "--run-time", "2025-01-01T00:00:01Z",
    programPath
  ], { cwd: tmpDir, timeout: 120000 });

  const parsed = JSON.parse(second.stdout.trim());
  assert.equal(parsed?.result?.be, "series");
  const entries = parsed?.result?.ob?.series ?? [];
  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.ob?.text, "alpha");
});
