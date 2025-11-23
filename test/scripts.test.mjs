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
    throw new Error(`script failed: ${caught?.message}\nlogs: ${logs.join("\n")}\nerrors: ${errors.join("\n")}`);
  }

  return { logs, errors };
}

test("run_pya_program.mjs outputs result in gross mode", async () => {
  const { logs, errors } = await runScript("scripts/run_pya_program.mjs", ["--gross", "examples/pyash/evoke-registers.pya"]);
  assert.equal(errors.join("\n"), "");

  const payload = JSON.parse(logs.join(""));
  assert.ok(Array.isArray(payload.outputs));
  const result = payload.result;
  assert.equal(result.subj?.name, "result");
  assert.equal(result.obj?.num, 5);
  assert.equal(result.be, "worker");
  assert.equal(result.mood, "ya");
});

test("run_pya_program.mjs prints program with --full", async () => {
  const { logs, errors } = await runScript("scripts/run_pya_program.mjs", ["--full", "examples/pyash/evoke-registers.pya"]);
  assert.equal(errors.join("\n"), "");
  const output = logs.join("\n");
  assert.match(output, /Program:\n/);
  assert.match(output, /Result:\n/);
  assert.match(output, /subj name result obj num 5 be worker ya/);
});

test("read_pya_trace.mjs emits pretty trace by default and has evoker first", async () => {
  const { logs, errors } = await runScript("scripts/read_pya_trace.mjs", ["examples/pyash/evoke-registers.pya"]);
  assert.equal(errors.join("\n"), "");
  const output = logs.join("\n");
  assert.match(output, /Pretty Trace/);
  assert.match(output, /Sandpit 0:/);
  assert.ok(output.includes("[0] obj num 5 to name target be worker do"), "evoker should be first sandpit sentence");
});

test("read_pya_trace.mjs gross mode returns sandpit JSON", async () => {
  const { logs, errors } = await runScript("scripts/read_pya_trace.mjs", ["--gross", "examples/pyash/evoke-registers.pya"]);
  assert.equal(errors.join("\n"), "");

  const parsed = JSON.parse(logs.join(""));
  const sandpit = parsed.sandpits?.[0];
  const evoker = sandpit?.[0];

  assert.ok(evoker, "sandpit should have an evoker at index 0");
  assert.equal(evoker.be, "worker");
  assert.equal(evoker.obj?.num, 5);
});
