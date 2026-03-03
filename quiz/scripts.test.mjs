import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { runScript } from "./helpers/run_script.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.join(__dirname, "..");

function assertNoUnexpectedErrors(errors = []) {
  const unexpected = errors.filter(line => !String(line).startsWith("artifacts folder: "));
  assert.deepEqual(unexpected, []);
}

test("run_pya_program.mjs outputs result in gross mode", async () => {
  const { logs, errors } = await runScript("command/run_pya_program.mjs", ["--gross", "examples/pyash/evoke-registers.pya"]);
  assertNoUnexpectedErrors(errors);

  const payload = JSON.parse(logs.join(""));
  assert.ok(Array.isArray(payload.outputs));
  const result = payload.result;
  assert.equal(result.su?.name, "result");
  assert.equal(result.ob?.num, 5);
  assert.equal(result.be, "worker");
  assert.equal(result.mood, "ya");
});

test("run_pya_program.mjs prints program with --full", async () => {
  const { logs, errors } = await runScript("command/run_pya_program.mjs", ["--full", "examples/pyash/evoke-registers.pya"]);
  assertNoUnexpectedErrors(errors);
  const output = logs.join("\n");
  assert.match(output, /Program:\n/);
  assert.match(output, /Result:\n/);
  assert.match(output, /su name result ob num 5 be worker ya/);
});

test("read_pya_trace.mjs emits beautiful trace by default and has evoker first", async () => {
  const { logs, errors } = await runScript("command/read_pya_trace.mjs", ["examples/pyash/evoke-registers.pya"]);
  assert.equal(errors.join("\n"), "");
  const output = logs.join("\n");
  assert.match(output, /Beautiful Trace/);
  assert.match(output, /Sandpit 0:/);
  assert.ok(output.includes("[0] ob num 5 to name target be worker do"), "evoker should be first sandpit sentence");
});

test("read_pya_trace.mjs gross mode returns sandpit JSON", async () => {
  const { logs, errors } = await runScript("command/read_pya_trace.mjs", ["--gross", "examples/pyash/evoke-registers.pya"]);
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
    const { errors } = await runScript("command/run_pya_program.mjs", ["examples/pyash/say-piper.pya"]);
    assertNoUnexpectedErrors(errors);
    const data = await fs.readFile("artifacts/say/piper-demo.wav", "utf8");
    assert.equal(data, output);
  } finally {
    delete process.env.PYA_PIPER_FIXTURE;
    await fs.rm("artifacts/say/piper-demo.wav", { force: true });
  }
});

test("run_pya_program.mjs writes produce.txt for text results", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-produce-"));
  const programPath = path.join(tmpDir, "produce-test.pya");
  const runId = "produce-artifact-test";
  const outDir = path.join(repoRoot, "artifacts", runId);
  try {
    await fs.writeFile(programPath, 'ob text "hello produce artifact" to name text result be text do ya\n', "utf8");
    const { errors } = await runScript("command/run_pya_program.mjs", ["--run-id", runId, programPath]);
    assertNoUnexpectedErrors(errors);
    const content = await fs.readFile(path.join(outDir, "produce.txt"), "utf8");
    assert.equal(content.trim(), "hello produce artifact");
  } finally {
    await fs.rm(programPath, { force: true });
    await fs.rm(tmpDir, { recursive: true, force: true });
    await fs.rm(outDir, { recursive: true, force: true });
  }
});
