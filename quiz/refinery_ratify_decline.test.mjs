import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { PassThrough } from "node:stream";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.join(__dirname, "..");

async function runScriptWithInput(scriptRelPath, args, inputText) {
  const originalArgv = process.argv;
  const originalLog = console.log;
  const originalError = console.error;
  const originalExit = process.exit;
  const originalStdin = process.stdin;
  const originalStdout = process.stdout;
  const originalEnv = process.env.PYA_FORCE_INTERACTIVE;

  const logs = [];
  const errors = [];

  const inputStream = new PassThrough();
  const outputStream = new PassThrough();
  inputStream.isTTY = true;
  outputStream.isTTY = true;

  Object.defineProperty(process, "stdin", { value: inputStream, configurable: true });
  Object.defineProperty(process, "stdout", { value: outputStream, configurable: true });

  console.log = (...msgs) => logs.push(msgs.join(" "));
  console.error = (...msgs) => errors.push(msgs.join(" "));
  process.exit = code => { throw new Error(`process.exit(${code})`); };
  process.env.PYA_FORCE_INTERACTIVE = "1";

  inputStream.write(inputText);
  inputStream.end();

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
    if (originalEnv === undefined) {
      delete process.env.PYA_FORCE_INTERACTIVE;
    } else {
      process.env.PYA_FORCE_INTERACTIVE = originalEnv;
    }
    Object.defineProperty(process, "stdin", { value: originalStdin, configurable: true });
    Object.defineProperty(process, "stdout", { value: originalStdout, configurable: true });
  }

  if (caught) {
    throw new Error(`script failed: ${caught?.message}\nlogs: ${logs.join("\n")}\nerrors: ${errors.join("\n")}`);
  }

  return { logs, errors };
}

test("declined ratify records decision and exits refinery without aborting program", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-ratify-"));
  const programPath = path.join(tempDir, "ratify-decline.pya");
  const program = [
    "su name flow be refinery def",
    "su name gate ob text \"Approve?\" be command propose",
    "prah",
    "from name flow be refinery do",
    "su name result ob num 9 be number ya"
  ].join("\n");
  await fs.writeFile(programPath, `${program}\n`, "utf8");

  const { logs, errors } = await runScriptWithInput(
    "program/command/run_pya_program.mjs",
    ["--gross", programPath],
    "n\n"
  );

  assert.equal(errors.join("\n"), "");
  const payload = JSON.parse(logs.join(""));
  assert.equal(payload.result?.be, "number");
  assert.equal(payload.result?.ob?.num, 9);
});
