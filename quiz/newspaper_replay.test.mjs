import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.join(path.dirname(__filename), "..");

async function writeContentAddressedArtifact(tmpDir, locator, content) {
  const hash = crypto.createHash("sha256").update(content).digest("hex");
  const artifactPath = path.join(tmpDir, "artifacts", "sha256", hash.slice(0, 2), hash.slice(2, 4), `${hash}${path.extname(locator)}`);
  await fs.mkdir(path.dirname(artifactPath), { recursive: true });
  await fs.writeFile(artifactPath, content, "utf8");
  return hash;
}

async function runReplay(tmpDir, runId) {
  const replayPath = path.join(repoRoot, "command", "replay_newspaper.mjs");
  return execFileAsync("node", [replayPath, "--run-id", runId, "--run-root", tmpDir], {
    cwd: tmpDir,
    timeout: 120000
  });
}

test("newspaper replay parses multiline artifact records", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-replay-multiline-"));
  const hash = await writeContentAddressedArtifact(tmpDir, "source.html", "line one\nline two\n");
  await fs.mkdir(path.join(tmpDir, "newspaper"), { recursive: true });
  await fs.writeFile(path.join(tmpDir, "newspaper", "run-multiline.pya"), [
    "su name tool ob text quoted.text.line one",
    "line two.text.quoted be text ya",
    `exists su name source.html-${hash} to filename "artifacts/sha256/${hash.slice(0, 2)}/${hash.slice(2, 4)}/${hash}.html" fromtext text "${hash}" be artifact ya`
  ].join("\n"), "utf8");

  const replay = await runReplay(tmpDir, "run-multiline");
  assert.match(replay.stdout, /be replay ya/);
});

test("newspaper replay rejects malformed artifact records", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-replay-malformed-"));
  await fs.mkdir(path.join(tmpDir, "newspaper"), { recursive: true });
  await fs.writeFile(path.join(tmpDir, "newspaper", "run-malformed.pya"),
    "be artifact fromtext text \"missing locator hash\" ya\n",
    "utf8");

  await assert.rejects(
    () => runReplay(tmpDir, "run-malformed"),
    /malformed artifact event/
  );
});

test("newspaper replay succeeds when hashes match", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-replay-ok-"));
  const programPath = path.join(tmpDir, "program.pya");
  await fs.writeFile(programPath, "ob text \"alpha\" to filename \"out.txt\" be write do\n", "utf8");

  const runPath = path.join(repoRoot, "command", "run_pya_program.mjs");
  await execFileAsync("node", [
    runPath,
    "--newspaper",
    "--run-id", "run-replay-ok",
    "--run-time", "2025-01-01T00:00:00Z",
    programPath
  ], { cwd: tmpDir, timeout: 120000 });

  const replayPath = path.join(repoRoot, "command", "replay_newspaper.mjs");
  await execFileAsync("node", [
    replayPath,
    "--run-id", "run-replay-ok",
    "--run-root", tmpDir
  ], { cwd: tmpDir, timeout: 120000 });
  assert.ok(true);
});

test("newspaper replay rejects hash mismatch", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-replay-"));
  const programPath = path.join(tmpDir, "program.pya");
  await fs.writeFile(programPath, "ob text \"alpha\" to filename \"out.txt\" be write do\n", "utf8");

  const runPath = path.join(repoRoot, "command", "run_pya_program.mjs");
  await execFileAsync("node", [
    runPath,
    "--newspaper",
    "--run-id", "run-replay",
    "--run-time", "2025-01-01T00:00:00Z",
    programPath
  ], { cwd: tmpDir, timeout: 120000 });

  const newspaperPath = path.join(tmpDir, "newspaper", "run-replay.pya");
  const newspaper = await fs.readFile(newspaperPath, "utf8");
  const artifactLine = newspaper.split(/\r?\n/).find(line => line.includes("be artifact"));
  const hashMatch = artifactLine?.match(/fromtext text \"([a-f0-9]+)\"/);
  const locatorMatch = artifactLine?.match(/to filename (\"([^\"]+)\"|([^ ]+))/);
  const hash = hashMatch?.[1];
  const locator = locatorMatch?.[2] || locatorMatch?.[3];
  assert.ok(hash);
  assert.ok(locator);
  const ext = path.extname(locator);
  const caRel = path.join("artifacts", "sha256", hash.slice(0, 2), hash.slice(2, 4), `${hash}${ext}`);
  await fs.writeFile(path.join(tmpDir, caRel), "tampered\n", "utf8");

  const replayPath = path.join(repoRoot, "command", "replay_newspaper.mjs");
  let failed = false;
  try {
    await execFileAsync("node", [
      replayPath,
      "--run-id", "run-replay",
      "--run-root", tmpDir
    ], { cwd: tmpDir, timeout: 120000 });
  } catch {
    failed = true;
  }
  assert.ok(failed);
});
