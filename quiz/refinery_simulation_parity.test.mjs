import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { buildProgram } from "../program/program.mjs";
import { transpileProgram } from "../program/verbs/exchange/compile.mjs";
import { parse } from "../program/understand/index.mjs";
import { interpret } from "../program/bridge/index.mjs";
import { clearRefineries } from "../program/bridge/refinery.mjs";
import { clearExchangeRecorder, setExchangeRecorder } from "../program/bridge/exchange.mjs";
import { forget } from "../program/remember/index.mjs";

const execFileAsync = promisify(execFile);

function concurrencyTrace(output) {
  return String(output ?? "")
    .split(/\r?\n/u)
    .map(line => line.startsWith("PYA_NEWSPAPER:") ? line.slice("PYA_NEWSPAPER:".length) : line)
    .filter(line => line.startsWith("su name ") && (
      line.includes(" be schedule admission ya")
      || line.includes(" be schedule start ya")
      || line.includes(" be schedule finish ya")
      || line.includes(" be schedule crowded ya")
      || line.includes('ob text "platform timebox"')
      || line.includes('ob text "platform cancel"')
    ));
}

function normalizedTrace(records) {
  return records.map(record => {
    const sentence = typeof record === "string" ? parse(record) : record;
    return {
      be: sentence?.be ?? null,
      platform: sentence?.su?.name ?? null,
      refinery: sentence?.from?.name ?? null,
      tick: sentence?.during?.num ?? null,
      ordinal: sentence?.by?.num ?? null,
      text: sentence?.ob?.text ?? null
    };
  });
}

async function interpreterRecords(source) {
  forget();
  clearRefineries();
  clearExchangeRecorder();
  const records = [];
  setExchangeRecorder({ record: sentence => records.push(sentence) });
  try {
    for (const sentence of buildProgram(source).sentences) await interpret(sentence);
  } finally {
    clearExchangeRecorder();
  }
  return records;
}

async function interpreterTrace(source) {
  return normalizedTrace(await interpreterRecords(source));
}

function ordinaryWriteNames(records) {
  return records
    .filter(record => record?.be === "evoke" && ["first", "second"].includes(record?.ob?.la?.su?.name))
    .map(record => record.ob.la.su.name);
}

function compiledWriteNames(output) {
  return String(output ?? "")
    .split(/\r?\n/u)
    .filter(line => line.startsWith("PYA_NEWSPAPER:su name ") && line.endsWith(" be write do"))
    .map(line => parse(line.slice("PYA_NEWSPAPER:".length)).su.name);
}

async function cliTrace(scriptName, sourcePath, cwd, runId, again = false) {
  const args = ["--newspaper", "--no-checkpoint", "--run-id", runId, "--run-time", "2025-01-01T00:00:00Z"];
  if (again) args.unshift("--again");
  args.push(sourcePath);
  await execFileAsync(path.resolve(scriptName), args, { cwd, timeout: 120000 });
  const newspaper = await fs.readFile(path.join(cwd, "newspaper", `${runId}.pya`), "utf8");
  return normalizedTrace(concurrencyTrace(newspaper));
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

test("interpreter, compiled JS, and C replay the complete trace identically", async () => {
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
    const interpreterFirst = await interpreterTrace(source);
    const interpreterReplay = await interpreterTrace(source);
    const jsFirst = await execFileAsync(process.execPath, [jsPath], { env, timeout: 120000 });
    const jsSecond = await execFileAsync(process.execPath, [jsPath], { env, timeout: 120000 });
    const cFirst = await execFileAsync(binaryPath, [], { env, timeout: 120000 });
    const cSecond = await execFileAsync(binaryPath, [], { env, timeout: 120000 });
    const jsTraceFirst = normalizedTrace(concurrencyTrace(jsFirst.stdout));
    const jsTraceSecond = normalizedTrace(concurrencyTrace(jsSecond.stdout));
    const cTraceFirst = normalizedTrace(concurrencyTrace(cFirst.stdout));
    const cTraceSecond = normalizedTrace(concurrencyTrace(cSecond.stdout));
    assert.deepEqual(interpreterFirst, interpreterReplay);
    assert.deepEqual(jsTraceFirst, jsTraceSecond);
    assert.deepEqual(cTraceFirst, cTraceSecond);
    assert.deepEqual(interpreterFirst, jsTraceFirst);
    assert.deepEqual(jsTraceFirst, cTraceFirst);
    assert.ok(jsTraceFirst.some(record => record.text === "platform timebox"));
    assert.ok(jsTraceFirst.some(record => record.text === "platform cancel"));
    assert.ok(jsTraceFirst.some(record => record.text === "schedule crowded"));
    const alternateInterpreter = await interpreterTrace(source.replace("seed ob num 2025", "seed ob num 12345"));
    const startNames = trace => trace.filter(record => record.be === "schedule start").map(record => record.platform);
    assert.notDeepEqual(startNames(interpreterFirst), startNames(alternateInterpreter));
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("artificial lie uses the ordinary sequential refinery on every backend", async () => {
  const source = [
    "su name ordinary conduct be map def",
    "su name artificial ob bool lie ya",
    "prah",
    "su name flow be refinery def",
    `su name first from ve name ob text "first" be write do`,
    `su name second ob text "second" be write do`,
    "prah",
    "from name flow to name text consequence under name ordinary conduct be refinery do"
  ].join("\n");
  const sentences = buildProgram(source).sentences;
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-refinery-sequential-parity-"));
  const jsPath = path.join(tempDir, "sequential.mjs");
  const cPath = path.join(tempDir, "sequential.c");
  const binaryPath = path.join(tempDir, "sequential");
  try {
    await fs.writeFile(jsPath, transpileProgram(sentences, { lang: "javascript" }), "utf8");
    await fs.writeFile(cPath, transpileProgram(sentences, { lang: "c" }), "utf8");
    await execFileAsync("gcc", ["-std=c11", cPath, "-o", binaryPath], { timeout: 120000 });
    const env = { ...process.env, PYA_NEWSPAPER: "1", PYA_NO_CHECKPOINT: "1" };
    const interpreterNames = ordinaryWriteNames(await interpreterRecords(source));
    const jsResult = await execFileAsync(process.execPath, [jsPath], { env, timeout: 120000 });
    const cResult = await execFileAsync(binaryPath, [], { env, timeout: 120000 });
    assert.deepEqual(interpreterNames, ["first", "second"]);
    assert.deepEqual(compiledWriteNames(jsResult.stdout), ["first", "second"]);
    assert.deepEqual(compiledWriteNames(cResult.stdout), ["first", "second"]);
    assert.deepEqual(normalizedTrace(concurrencyTrace(jsResult.stdout)), []);
    assert.deepEqual(normalizedTrace(concurrencyTrace(cResult.stdout)), []);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("runjs and runc again invocations preserve the seeded trace", async () => {
  const sourcePath = path.resolve("examples/pyash/refinery-concurrency-simulation.pya");
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-refinery-simulation-again-"));
  try {
    const jsFirst = await cliTrace("runjs", sourcePath, tempDir, "js-first");
    const jsAgain = await cliTrace("runjs", sourcePath, tempDir, "js-again", true);
    const cFirst = await cliTrace("runc", sourcePath, tempDir, "c-first");
    const cAgain = await cliTrace("runc", sourcePath, tempDir, "c-again", true);
    assert.deepEqual(jsFirst, jsAgain);
    assert.deepEqual(cFirst, cAgain);
    assert.deepEqual(jsFirst, cFirst);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
