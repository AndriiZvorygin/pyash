import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
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
  const { logs, errors } = await runScript("program/command/run_pya_program.mjs", ["--gross", "examples/pyash/evoke-registers.pya"]);
  assert.equal(errors.join("\n"), "");

  const payload = JSON.parse(logs.join(""));
  assert.ok(Array.isArray(payload.outputs));
  const result = payload.result;
  assert.equal(result.su?.name, "result");
  assert.equal(result.ob?.num, 5);
  assert.equal(result.be, "worker");
  assert.equal(result.mood, "ya");
});

test("run_pya_program.mjs prints program with --full", async () => {
  const { logs, errors } = await runScript("program/command/run_pya_program.mjs", ["--full", "examples/pyash/evoke-registers.pya"]);
  assert.equal(errors.join("\n"), "");
  const output = logs.join("\n");
  assert.match(output, /Program:\n/);
  assert.match(output, /Result:\n/);
  assert.match(output, /su name result ob num 5 be worker ya/);
});

test("read_pya_trace.mjs emits beautiful trace by default and has evoker first", async () => {
  const { logs, errors } = await runScript("program/command/read_pya_trace.mjs", ["examples/pyash/evoke-registers.pya"]);
  assert.equal(errors.join("\n"), "");
  const output = logs.join("\n");
  assert.match(output, /Beautiful Trace/);
  assert.match(output, /Sandpit 0:/);
  assert.ok(output.includes("[0] ob num 5 to name target be worker do"), "evoker should be first sandpit sentence");
});

test("read_pya_trace.mjs gross mode returns sandpit JSON", async () => {
  const { logs, errors } = await runScript("program/command/read_pya_trace.mjs", ["--gross", "examples/pyash/evoke-registers.pya"]);
  assert.equal(errors.join("\n"), "");

  const parsed = JSON.parse(logs.join(""));
  const sandpit = parsed.sandpits?.[0];
  const evoker = sandpit?.[0];

  assert.ok(evoker, "sandpit should have an evoker at index 0");
  assert.equal(evoker.be, "worker");
  assert.equal(evoker.ob?.num, 5);
});

test("run_pya_program.mjs uses default say mapping", async () => {
  const output = "fixture-audio";
  process.env.PYA_PIPER_FIXTURE = output;
  try {
    const { errors } = await runScript("program/command/run_pya_program.mjs", ["examples/pyash/say-piper.pya"]);
    assert.equal(errors.join("\n"), "");
    const data = await fs.readFile("artifacts/say/piper-demo.wav", "utf8");
    assert.equal(data, output);
  } finally {
    delete process.env.PYA_PIPER_FIXTURE;
    await fs.rm("artifacts/say/piper-demo.wav", { force: true });
  }
});
