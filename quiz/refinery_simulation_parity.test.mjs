import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { buildProgram } from "../program/program.mjs";
import { transpileProgram } from "../program/verbs/exchange/compile.mjs";

const execFileAsync = promisify(execFile);

function concurrencyTrace(output) {
  return String(output ?? "")
    .split(/\r?\n/u)
    .filter(line => line.startsWith("PYA_NEWSPAPER:su name "))
    .map(line => line.slice("PYA_NEWSPAPER:".length));
}

test("compiled refinery keeps an explicit empty dependency vector as a root", () => {
  const source = [
    "su name flow be refinery def",
    "su name first ob text \"first\" during num 1 be write do",
    "su name second from ve name ob text \"second\" during num 1 be write do",
    "prah",
    "from name flow be refinery do"
  ].join("\n");
  const javascript = transpileProgram(buildProgram(source).sentences, { lang: "javascript" });
  assert.equal(javascript.includes('platforms["second"] = { deps: []'), true);
});

test("compiled JS and C expose the same deterministic simulation contract", () => {
  const source = [
    "su name simulation conduct be map def",
    "su name artificial ob bool truth ya",
    "su name seed ob num 12345 ya",
    "su name start tick ob num 0 ya",
    "su name parallel capacity ob num 1 ya",
    "su name waiting capacity ob num 1 ya",
    "su name schedule newspaper ob bool truth ya",
    "prah",
    "su name flow be refinery def",
    "su name alpha from ve name ob text \"a\" during num 1 be write do",
    "su name beta from ve name ob text \"b\" during num 2 atmost num 2 be write do",
    "prah",
    "from name flow to name text result under name simulation conduct be refinery do"
  ].join("\n");
  const sentences = buildProgram(source).sentences;
  const javascript = transpileProgram(sentences, { lang: "javascript" });
  const c = transpileProgram(sentences, { lang: "c" });
  assert.match(javascript, /__pyaSourceRefineryCalls = \[\{"refineryName":"flow","conduct":\{/u);
  assert.match(c, /pya_refinery_flow_run/u);
  assert.match(javascript, /schedule newspaper/u);
  assert.match(c, /schedule newspaper/u);
});

test("compiled JS and C replay the complete concurrency trace identically", async () => {
  const source = await fs.readFile("examples/pyash/refinery-concurrency-simulation.pya", "utf8");
  const sentences = buildProgram(source).sentences;
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-refinery-simulation-parity-"));
  const jsPath = path.join(tempDir, "simulation.mjs");
  const cPath = path.join(tempDir, "simulation.c");
  const binaryPath = path.join(tempDir, "simulation");
  try {
    await fs.writeFile(jsPath, transpileProgram(sentences, { lang: "javascript" }), "utf8");
    await fs.writeFile(cPath, transpileProgram(sentences, { lang: "c" }), "utf8");
    await execFileAsync("gcc", ["-std=c11", cPath, "-o", binaryPath], { timeout: 120000 });
    const env = { ...process.env, PYA_NEWSPAPER: "1", PYA_NO_CHECKPOINT: "1" };
    const [jsResult, cResult] = await Promise.all([
      execFileAsync(process.execPath, [jsPath], { env, timeout: 120000 }),
      execFileAsync(binaryPath, [], { env, timeout: 120000 })
    ]);
    assert.deepEqual(concurrencyTrace(jsResult.stdout), concurrencyTrace(cResult.stdout));
    assert.ok(concurrencyTrace(jsResult.stdout).some(line => line.includes('ob text "platform timebox"')));
    assert.ok(concurrencyTrace(jsResult.stdout).some(line => line.includes('ob text "platform cancel"')));
    assert.ok(concurrencyTrace(jsResult.stdout).some(line => line.includes('ob text "schedule crowded"')));
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
