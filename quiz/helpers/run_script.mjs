import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { PassThrough } from "node:stream";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.join(__dirname, "..", "..");

async function runScriptWithOverrides(scriptRelPath, args, overrides) {
  const originalArgv = process.argv;
  const originalLog = console.log;
  const originalError = console.error;
  const originalExit = process.exit;
  const originalStdin = process.stdin;
  const originalStdout = process.stdout;

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
    await overrides?.before?.();
    await import(scriptUrl);
    await new Promise(resolve => setTimeout(resolve, 20));
  } catch (err) {
    caught = err;
  } finally {
    await overrides?.after?.();
    process.argv = originalArgv;
    console.log = originalLog;
    console.error = originalError;
    process.exit = originalExit;
    Object.defineProperty(process, "stdin", { value: originalStdin, configurable: true });
    Object.defineProperty(process, "stdout", { value: originalStdout, configurable: true });
  }

  if (caught) {
    throw new Error(`script failed: ${caught?.message}\nlogs: ${logs.join("\n")}\nerrors: ${errors.join("\n")}`);
  }

  return { logs, errors };
}

export async function runScript(scriptRelPath, args) {
  return runScriptWithOverrides(scriptRelPath, args, null);
}

export async function runScriptWithInput(scriptRelPath, args, inputText) {
  const originalEnv = process.env.PYA_FORCE_INTERACTIVE;

  const inputStream = new PassThrough();
  const outputStream = new PassThrough();
  inputStream.isTTY = true;
  outputStream.isTTY = true;

  return runScriptWithOverrides(scriptRelPath, args, {
    before: () => {
      Object.defineProperty(process, "stdin", { value: inputStream, configurable: true });
      Object.defineProperty(process, "stdout", { value: outputStream, configurable: true });
      process.env.PYA_FORCE_INTERACTIVE = "1";
      inputStream.write(inputText);
      inputStream.end();
    },
    after: () => {
      if (originalEnv === undefined) {
        delete process.env.PYA_FORCE_INTERACTIVE;
      } else {
        process.env.PYA_FORCE_INTERACTIVE = originalEnv;
      }
    }
  });
}
