import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parse } from "../program/understand/index.mjs";
import { runScriptWithInput } from "./helpers/run_script.mjs";

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

function normalizeLines(text) {
  return String(text)
    .split(/\r?\n/)
    .map(line => line.trimEnd())
    .filter(line => line.length > 0);
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

test("runner ratify resume carries one identity through approval, result, audits, and artifact", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-command-identity-ratify-"));
  const programPath = path.join(tmpDir, "ratified-command.pya");
  await fs.writeFile(
    programPath,
    "fromtext text \"approval stdin\" ob text \"rm -rf artifacts/command-result-identity/ratified.txt; cat\" to filename \"artifacts/command-result-identity/ratified.txt\" be command do\n",
    "utf8"
  );
  const runId = "command-identity-ratify";
  const originalCwd = process.cwd();
  const fixtureKeys = Object.keys(cleanEnv()).filter(key => key.startsWith("PYA_") && key.includes("FIXTURE"))
    .concat(["PYA_COMMAND_RESPONSE", "PYA_MIND_RESPONSE"]);
  const savedFixtureValues = new Map(fixtureKeys.map(key => [key, process.env[key]]));
  const originalShell = process.env.SHELL;
  try {
    for (const key of fixtureKeys) delete process.env[key];
    process.env.SHELL = "/bin/sh";
    process.chdir(tmpDir);
    await runScriptWithInput("command/run_pya_program.mjs", [
      "--newspaper",
      "--run-id", runId,
      "--run-time", "2025-01-01T00:00:00Z",
      programPath
    ], "y\n");
  } finally {
    process.chdir(originalCwd);
    for (const [key, value] of savedFixtureValues) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    if (originalShell === undefined) delete process.env.SHELL;
    else process.env.SHELL = originalShell;
  }

  const newspaper = await fs.readFile(path.join(tmpDir, "newspaper", `${runId}.pya`), "utf8");
  const lines = normalizeLines(newspaper);
  const records = lines.map(line => {
    try {
      return parse(line);
    } catch {
      return null;
    }
  }).filter(Boolean);
  const identity = "command request 000001";
  const request = records.find(record => record?.be === "evoke" && record?.su?.name === identity);
  const approval = records.find(record => record?.be === "ratify" && record?.mood === "do" && record?.to?.name === identity);
  const auditLines = lines.filter(line => line.includes("su name command audit"));
  const artifact = records.find(record => record?.be === "artifact");
  const exchanges = records.filter(record => record?.be === "exchange");

  assert.ok(request);
  assert.ok(approval);
  assert.equal(JSON.parse(approval.fromtext.text).requestIdentity, identity);
  assert.match(newspaper, new RegExp(`su name ${identity} ob text[\\s\\S]*?be command ya`));
  assert.ok(newspaper.includes("approval stdin"));
  assert.ok(auditLines.length >= 2);
  assert.ok(auditLines.every(line => line.includes(`to name ${identity}`)));
  assert.equal(artifact?.ob?.name, identity);
  assert.ok(exchanges.length >= 1);
  assert.ok(exchanges.every(record => record.ob?.name === identity));
});
