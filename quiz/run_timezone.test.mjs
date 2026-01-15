import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.join(__dirname, "..");

async function runScript(scriptRelPath, args) {
  const originalArgv = process.argv;
  const originalLog = console.log;
  const originalError = console.error;
  const originalExit = process.exit;

  const logs = [];
  const errors = [];

  console.log = (...msgs) => logs.push(msgs.join(" "));
  console.error = (...msgs) => errors.push(msgs.join(" "));
  process.exit = code => { throw new Error(`process.exit(${code})`); };

  const scriptPath = path.join(repoRoot, scriptRelPath);
  const scriptUrl = `${pathToFileURL(scriptPath).href}?test=${Date.now()}`;
  process.argv = ["node", scriptPath, ...args];

  let caught = null;
  try {
    await import(scriptUrl);
    await new Promise(resolve => setTimeout(resolve, 20));
  } catch (err) {
    caught = err;
  } finally {
    process.argv = originalArgv;
    console.log = originalLog;
    console.error = originalError;
    process.exit = originalExit;
  }

  if (caught) {
    throw new Error(`script failed: ${caught?.message}\nlogs: ${logs.join("\n")}\nerrors: ${errors.join("\n")}`);
  }

  return { logs, errors };
}

test("run uses timezone from config when writing run start", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-tz-"));
  const originalCwd = process.cwd();
  try {
    await fs.mkdir(path.join(tmpDir, "configure"), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, "configure", "default.pya"),
      [
        'exists su name timezone ob text "America/Toronto" be text ya',
        ""
      ].join("\n"),
      "utf8"
    );
    const programPath = path.join(tmpDir, "program.pya");
    await fs.writeFile(programPath, "su name ok ob text \"done\" be write do\n", "utf8");
    process.chdir(tmpDir);
    const { errors } = await runScript("program/command/run_pya_program.mjs", ["--newspaper", "--run-id", "tz-run", programPath]);
    assert.equal(errors.join("\n"), "");
    const newspaperPath = path.join(tmpDir, "newspaper", "tz-run.pya");
    const output = await fs.readFile(newspaperPath, "utf8");
    const runLine = output.split("\n").find(line => line.includes(" be run ya"));
    assert.ok(runLine && /from time \d{4}-\d{2}-\d{2}T/.test(runLine), "expected run line with ISO timestamp");
    assert.ok(/[-+]\d{2}:\d{2}/.test(runLine), "expected timezone offset in run line");
  } finally {
    process.chdir(originalCwd);
  }
});
