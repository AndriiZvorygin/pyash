#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
process.chdir(root);

const DEFAULT_TIMEOUT_MS = 30_000;

function parseArgValue(flag) {
  const idx = process.argv.findIndex((arg) => arg === flag);
  return idx >= 0 ? process.argv[idx + 1] : null;
}

const statusPath = parseArgValue("--status") || path.join("documentation", "parity", "status.json");
const timeoutArg = parseArgValue("--timeout-ms");
const timeoutMs = timeoutArg ? Number(timeoutArg) : DEFAULT_TIMEOUT_MS;

const passthroughArgs = [];
for (let i = 2; i < process.argv.length; i += 1) {
  const arg = process.argv[i];
  if (arg === "--status" || arg === "--timeout-ms") {
    i += 1;
    continue;
  }
  if (arg === "--parallel") {
    const value = process.argv[i + 1];
    if (value) {
      passthroughArgs.push(arg, value);
      i += 1;
    }
    continue;
  }
  if (arg.startsWith("--include-") || arg === "--parallel-all") {
    passthroughArgs.push(arg);
  }
}

function parseQuotedValues(line = "") {
  return Array.from(line.matchAll(/"([^"]*)"/g)).map((m) => m[1]);
}

function parseMeta(block) {
  const meta = { mode: null, requires: [], inputs: [] };
  if (!block) return meta;
  const modeLine = block.find((line) => line.startsWith("su name mode ob text "));
  if (modeLine) {
    const [value] = parseQuotedValues(modeLine);
    if (value) meta.mode = value;
  }
  const requiresLine = block.find((line) => line.startsWith("su name requires ob ve text "));
  if (requiresLine) meta.requires = parseQuotedValues(requiresLine);
  const inputsLine = block.find((line) => line.startsWith("su name inputs ob ve text "));
  if (inputsLine) meta.inputs = parseQuotedValues(inputsLine);
  return meta;
}

async function extractMeta(file) {
  const text = await fs.readFile(file, "utf8");
  const lines = text.split(/\r?\n/).slice(0, 120);
  const start = lines.findIndex((line) => line.trim() === "su name example meta be map def");
  if (start < 0) return null;
  const block = [];
  for (let i = start; i < lines.length; i += 1) {
    block.push(lines[i].trim());
    if (lines[i].trim() === "prah") break;
  }
  return parseMeta(block);
}

function runWithTimeout(cmd, args, { timeoutMs, inputLines }) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    child.stdout.on("data", (buf) => { stdout += buf.toString(); });
    child.stderr.on("data", (buf) => { stderr += buf.toString(); });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });

    if (inputLines && inputLines.length) {
      child.stdin.write(inputLines.join("\n") + "\n");
    }
    child.stdin.end();
  });
}

function normalizeOutcome(result) {
  if (result.timedOut) return { status: "timeout" };
  if (result.code !== 0) {
    const tail = (result.stderr || result.stdout || "").trim().split("\n").slice(-8).join("\n");
    return { status: "failed", tail };
  }
  return { status: "success" };
}

async function main() {
  const tempDir = path.join(os.tmpdir(), "pyash-parity");
  await fs.mkdir(tempDir, { recursive: true });
  const reportPath = path.join(tempDir, "run-report.json");

  const runArgs = ["command/run_examples.mjs", "--report", reportPath, ...passthroughArgs];
  const runResult = await runWithTimeout("node", runArgs, { timeoutMs, inputLines: [] });
  if (runResult.timedOut) {
    console.error("run_examples.mjs timed out.");
  }

  let runReport = null;
  try {
    runReport = JSON.parse(await fs.readFile(reportPath, "utf8"));
  } catch (err) {
    console.error("Could not read run_examples report:", err?.message || err);
    runReport = { successes: [], failures: [], missing: [], timeouts: [], skipped: [] };
  }

  const runjs = { successes: [], failures: [], timeouts: [] };
  const runc = { successes: [], failures: [], timeouts: [] };
  const details = {};

  for (const file of runReport.successes || []) {
    const meta = await extractMeta(file);
    const isSession = meta?.mode === "session";
    const inputs = isSession && meta?.inputs?.length ? meta.inputs : (isSession ? ["/bye"] : []);

    const runjsResult = await runWithTimeout("./runjs", [file], { timeoutMs, inputLines: inputs });
    const runjsOutcome = normalizeOutcome(runjsResult);
    if (runjsOutcome.status === "success") runjs.successes.push(file);
    if (runjsOutcome.status === "failed") runjs.failures.push(file);
    if (runjsOutcome.status === "timeout") runjs.timeouts.push(file);

    const runcResult = await runWithTimeout("./runc", [file], { timeoutMs, inputLines: inputs });
    const runcOutcome = normalizeOutcome(runcResult);
    if (runcOutcome.status === "success") runc.successes.push(file);
    if (runcOutcome.status === "failed") runc.failures.push(file);
    if (runcOutcome.status === "timeout") runc.timeouts.push(file);

    details[file] = {
      run: { status: "success" },
      runjs: runjsOutcome,
      runc: runcOutcome
    };
  }

  const parity = {
    green: [],
    red: []
  };

  for (const file of runReport.successes || []) {
    const info = details[file];
    if (!info) continue;
    if (info.runjs.status === "success" && info.runc.status === "success") {
      parity.green.push(file);
    } else {
      parity.red.push(file);
    }
  }

  const status = {
    lastRun: new Date().toISOString(),
    run: runReport,
    runjs,
    runc,
    parity,
    details
  };

  await fs.mkdir(path.dirname(statusPath), { recursive: true });
  await fs.writeFile(statusPath, JSON.stringify(status, null, 2));

  const exitCode = runResult.code === 0 && runjs.failures.length === 0 && runc.failures.length === 0
    ? 0
    : 1;

  process.exit(exitCode);
}

main().catch((err) => {
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
});
