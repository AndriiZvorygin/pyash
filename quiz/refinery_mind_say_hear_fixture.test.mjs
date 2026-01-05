import test from "node:test";
import assert from "node:assert/strict";
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
    const message = caught?.message ?? String(caught);
    if (!message.startsWith("process.exit")) throw caught;
  }

  return { logs, errors };
}

test("refinery mind -> say -> hear fixture loop emits transcript", async () => {
  process.env.PYA_MIND_RESPONSE = "Fixture prompt response.";
  process.env.PYA_PIPER_FIXTURE = "fixture-audio";
  process.env.PYA_HEAR_FIXTURE = "Fixture transcript.";
  try {
    const { logs, errors } = await runScript("program/command/run_pya_program.mjs", [
      "--refinery",
      "loop",
      "examples/pyash/refinery-mind-say-hear-fixture.pya"
    ]);
    assert.equal(errors.join("\n"), "");
    assert.ok(logs.join("\n").includes("Fixture transcript."), "transcript should print");
  } finally {
    delete process.env.PYA_MIND_RESPONSE;
    delete process.env.PYA_PIPER_FIXTURE;
    delete process.env.PYA_HEAR_FIXTURE;
  }
});
