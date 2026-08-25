import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(".");

async function writeNewspaper(lines) {
  const runRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-command-identity-replay-"));
  await fs.mkdir(path.join(runRoot, "newspaper"), { recursive: true });
  await fs.writeFile(path.join(runRoot, "newspaper", "identity.pya"), `${lines.join("\n")}\n`, "utf8");
  return runRoot;
}

test("replay accepts legacy newspapers without command identity records", async () => {
  const runRoot = await writeNewspaper([
    "exists su name identity from time 2025-01-01T00:00:00Z be run ya",
    "exists su name identity be end ya"
  ]);
  await execFileAsync(process.execPath, [
    path.join(repoRoot, "command", "replay_newspaper.mjs"),
    "--run-id", "identity",
    "--run-root", runRoot
  ], { cwd: repoRoot });
});

test("replay rejects an orphaned command identity link", async () => {
  const runRoot = await writeNewspaper([
    "exists su name identity from time 2025-01-01T00:00:00Z be run ya",
    "exists su name command request 000001 ob la ob text \"printf ok\" be command do ko be evoke ya",
    "su name command request 000001 ob text \"ok\" be command ya",
    "exists su name artifact-001 ob name command request 000999 to filename \"out.txt\" from name command request 000999 be artifact ya",
    "exists su name identity be end ya"
  ]);
  await assert.rejects(
    execFileAsync(process.execPath, [
      path.join(repoRoot, "command", "replay_newspaper.mjs"),
      "--run-id", "identity",
      "--run-root", runRoot
    ], { cwd: repoRoot }),
    /identity/u
  );
});

test("replay rejects an orphaned compiled tool result identity", async () => {
  const runRoot = await writeNewspaper([
    "exists su name identity from time 2025-01-01T00:00:00Z be run ya",
    "su name tool event 000001 ob la ob text \"printf ok\" be command do ko to la su name command request 000001 ob text \"ok\" be command ya ko be tool ya",
    "exists su name identity be end ya"
  ]);
  await assert.rejects(
    execFileAsync(process.execPath, [
      path.join(repoRoot, "command", "replay_newspaper.mjs"),
      "--run-id", "identity",
      "--run-root", runRoot
    ], { cwd: repoRoot }),
    /identity/u
  );
});
