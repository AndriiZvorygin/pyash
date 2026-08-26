import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(".");

async function writeNewspaper(lines, runId = "identity") {
  const runRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-command-identity-replay-"));
  await fs.mkdir(path.join(runRoot, "newspaper"), { recursive: true });
  await fs.writeFile(path.join(runRoot, "newspaper", `${runId}.pya`), `${lines.join("\n")}\n`, "utf8");
  return runRoot;
}

async function replay(runRoot, runId = "identity") {
  return execFileAsync(process.execPath, [
    path.join(repoRoot, "command", "replay_newspaper.mjs"),
    "--run-id", runId,
    "--run-root", runRoot
  ], { cwd: repoRoot });
}

test("replay accepts legacy newspapers without command identity records", async () => {
  const runRoot = await writeNewspaper([
    "exists su name identity from time 2025-01-01T00:00:00Z be run ya",
    "exists su name identity be end ya"
  ]);
  await replay(runRoot);
});

test("replay rejects an orphaned command identity link", async () => {
  const runRoot = await writeNewspaper([
    "exists su name identity from time 2025-01-01T00:00:00Z be run ya",
    "exists su name command request 000001 ob la ob text \"printf ok\" be command do ko be evoke ya",
    "su name command request 000001 ob text \"ok\" be command ya",
    "exists su name artifact-001 ob name command request 000999 to filename \"out.txt\" from name command request 000999 be artifact ya",
    "exists su name identity be end ya"
  ]);
  await assert.rejects(replay(runRoot), /identity/u);
});

test("replay rejects an orphaned compiled tool result identity", async () => {
  const runRoot = await writeNewspaper([
    "exists su name identity from time 2025-01-01T00:00:00Z be run ya",
    "su name tool event 000001 ob la ob text \"printf ok\" be command do ko to la su name command request 000001 ob text \"ok\" be command ya ko be tool ya",
    "exists su name identity be end ya"
  ]);
  await assert.rejects(replay(runRoot), /identity/u);
});

test("replay rejects a request-only identity graph", async () => {
  const runRoot = await writeNewspaper([
    "exists su name identity from time 2025-01-01T00:00:00Z be run ya",
    "exists su name command request 000001 ob la ob text \"printf incomplete\" be command do ko be evoke ya",
    "exists su name identity be end ya"
  ]);
  await assert.rejects(replay(runRoot), /identity/u);
});

test("replay rejects a split resume without a resumed result", async () => {
  const runRoot = await writeNewspaper([
    "exists su name identity from time 2025-01-01T00:00:00Z be run ya",
    "exists su name command request 000001 ob la ob text \"rm -rf incomplete\" be command do ko be evoke ya",
    "exists su name command audit 000001 ob text \"rm -rf incomplete\" from name command configure to name command request 000001 as name policy accordingto name ask be command audit ya",
    "su name command approval ob text \"approve\" from name command to name command request 000001 fromtext text \"{}\" accordingto name resume token be ratify do",
    "su name command request 000001 ob bool truth be bool ya",
    "exists su name identity be end ya"
  ]);
  await assert.rejects(replay(runRoot), /identity/u);
});

test("replay accepts explicitly denied and failed command identities as terminal", async () => {
  const deniedRoot = await writeNewspaper([
    "exists su name identity from time 2025-01-01T00:00:00Z be run ya",
    "exists su name command request 000001 ob la ob text \"rm -rf denied\" be command do ko be evoke ya",
    "exists su name command audit 000001 ob text \"rm -rf denied\" from name command configure to name command request 000001 as name policy accordingto name deny be command audit ya",
    "exists su name identity be end ya"
  ], "denied");
  await replay(deniedRoot, "denied");

  const failedRoot = await writeNewspaper([
    "exists su name identity from time 2025-01-01T00:00:00Z be run ya",
    "exists su name command request 000001 ob la ob text \"printf failed\" be command do ko be evoke ya",
    "exists su name command audit 000001 ob text \"printf failed\" from name command configure to name command request 000001 as name result accordingto name error totext text \"command failed\" be command audit ya",
    "exists su name identity be end ya"
  ], "failed");
  await replay(failedRoot, "failed");
});
