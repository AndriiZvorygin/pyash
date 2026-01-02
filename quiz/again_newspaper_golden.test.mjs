import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.join(path.dirname(__filename), "..");

test("again can replay from newspaper", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-again-newspaper-"));
  const runPath = path.join(repoRoot, "program", "command", "run_pya_program.mjs");
  const replayPath = path.join(repoRoot, "program", "command", "replay_newspaper.mjs");
  const programPath = path.join(repoRoot, "examples", "pyash", "again-newspaper.pya");
  const runId = "again-newspaper";
  await fs.mkdir(path.join(tmpDir, "examples", "out"), { recursive: true });

  const runScript = async (scriptPath, args) => {
    const originalArgv = process.argv;
    const originalCwd = process.cwd();
    const originalLog = console.log;
    const originalError = console.error;
    const originalExit = process.exit;
    const logs = [];
    const errors = [];

    console.log = (...msgs) => logs.push(msgs.join(" "));
    console.error = (...msgs) => errors.push(msgs.join(" "));
    process.exit = code => { throw new Error(`process.exit(${code})`); };
    process.argv = ["node", scriptPath, ...args];
    process.chdir(tmpDir);

    try {
      const scriptUrl = `${pathToFileURL(scriptPath).href}?test=${Date.now()}`;
      await import(scriptUrl);
      await new Promise(resolve => setTimeout(resolve, 20));
    } finally {
      process.argv = originalArgv;
      process.chdir(originalCwd);
      console.log = originalLog;
      console.error = originalError;
      process.exit = originalExit;
    }

    return { logs, errors };
  };

  await runScript(runPath, [
    "--newspaper",
    "--run-id", runId,
    "--run-time", "2025-01-01T00:00:00Z",
    programPath
  ]);

  const replay = await runScript(replayPath, [
    "--run-id", runId,
    "--run-root", tmpDir
  ]);

  assert.match(replay.logs.join("\n"), new RegExp(`su name ${runId} be replay ya`));
});
