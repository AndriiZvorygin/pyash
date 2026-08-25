import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(".");
const examplePath = path.join(repoRoot, "examples", "pyash", "command-result-identity.pya");

function cleanEnv() {
  const env = { ...process.env };
  for (const key of [
    "PYA_COMMAND_RESPONSE",
    "PYA_DRAW_FIXTURE_FILE",
    "PYA_HEAR_FIXTURE",
    "PYA_KATAGO_FIXTURE",
    "PYA_MIND_RESPONSE",
    "PYA_MUSIC_COMFYUI_FIXTURE_FILE",
    "PYA_PIPER_FIXTURE",
    "PYA_SAY_COMFYUI_FIXTURE_FILE",
    "PYA_SEE_VL_FIXTURE",
    "PYA_SEE_VL_FIXTURE_FILE",
    "PYA_WEB_SEARCH_FIXTURE",
    "PYA_WHISPER_FIXTURE"
  ]) delete env[key];
  return env;
}

async function commandAvailable(name) {
  try {
    await execFileAsync(name, ["--version"]);
    return true;
  } catch {
    return false;
  }
}

async function runRunner(name, tmpDir) {
  const runId = `command-identity-${name}`;
  await execFileAsync(name === "run" ? path.join(repoRoot, "run") : path.join(repoRoot, name), [
    "--newspaper",
    "--run-id", runId,
    "--run-time", "2025-01-01T00:00:00Z",
    examplePath
  ], { cwd: tmpDir, env: cleanEnv(), timeout: 120000 });
  const newspaperPath = path.join(tmpDir, "newspaper", `${runId}.pya`);
  const newspaper = await fs.readFile(newspaperPath, "utf8");
  assert.match(newspaper, /su name command request 000001/u);
  assert.match(newspaper, /su name command request 000002/u);
  assert.match(newspaper, /be command ya/u);
  assert.match(newspaper, /be artifact ya/u);
  return { runId, newspaperPath };
}

test("run, runjs, and runc preserve command result identity", async t => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-command-identity-parity-"));
  for (const runner of ["run", "runjs", "runc"]) {
    if (runner === "runc" && !(await commandAvailable("gcc"))) {
      t.assert.skip("gcc toolchain unavailable");
      continue;
    }
    await runRunner(runner, tmpDir);
    await execFileAsync(process.execPath, [
      path.join(repoRoot, "command", "replay_newspaper.mjs"),
      "--run-id", `command-identity-${runner}`,
      "--run-root", tmpDir
    ], { cwd: repoRoot, env: cleanEnv(), timeout: 120000 });
  }
});
