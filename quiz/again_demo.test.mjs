import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.join(__dirname, "..");

function assertNoUnexpectedErrors(errors = []) {
  const unexpected = errors.filter(line => !String(line).startsWith("artifacts folder: "));
  assert.deepEqual(unexpected, []);
}

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

test("again demo replays from newspaper", async () => {
  const examplePath = "examples/pyash/again-demo.pya";
  const runId = "again-demo";
  const script = "command/run_pya_program.mjs";

  const first = await runScript(script, ["--newspaper", "--run-id", runId, examplePath]);
  assertNoUnexpectedErrors(first.errors);

  const replay = await runScript(script, ["--again", "--run-id", runId, examplePath]);
  assertNoUnexpectedErrors(replay.errors);
});
