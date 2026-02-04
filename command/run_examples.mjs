#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
process.chdir(root);

const includeMind = process.argv.includes("--include-mind");
const includeSay = process.argv.includes("--include-say");
const includeCommand = process.argv.includes("--include-command");
const parallelAll = process.argv.includes("--parallel-all");
const parallelArgIndex = process.argv.findIndex((arg) => arg === "--parallel");
const parallelValue = parallelArgIndex >= 0 ? Number(process.argv[parallelArgIndex + 1]) : NaN;
const concurrency = parallelAll
  ? Number.POSITIVE_INFINITY
  : (Number.isFinite(parallelValue) && parallelValue > 0 ? parallelValue : Math.max(1, os.cpus().length));

const DEFAULT_TIMEOUT_MS = 30_000;

const skip = new Set();
if (!includeMind) {
  skip.add("examples/pyash/mind-config-call.pya");
  skip.add("examples/pyash/mind-parity.pya");
  skip.add("examples/pyash/mind-tool-call.pya");
  skip.add("examples/pyash/mind-tools.pya");
}
if (!includeSay) {
  skip.add("examples/pyash/say-default.pya");
  skip.add("examples/pyash/say-espeak.pya");
}
if (!includeCommand) {
  skip.add("examples/pyash/command-espeak.pya");
}
skip.add("examples/pyash/hear-stream.pya");

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

function checkRequirement(req) {
  if (/^[A-Z0-9_]+$/.test(req)) {
    return Boolean(process.env[req]);
  }
  return new Promise((resolve) => {
    const child = spawn("bash", ["-lc", `command -v ${req}`], { stdio: "ignore" });
    child.on("close", (code) => resolve(code === 0));
  });
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

async function main() {
  if ((includeSay || includeCommand) && !(await checkRequirement("espeak-ng"))) {
    console.error("espeak-ng not found; skipping say/command espeak examples.");
    skip.add("examples/pyash/say-default.pya");
    skip.add("examples/pyash/say-espeak.pya");
    skip.add("examples/pyash/command-espeak.pya");
  }

  const files = (await fs.readdir("examples/pyash", { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".pya"))
    .map((entry) => path.join("examples/pyash", entry.name))
    .filter((file) => !file.startsWith("examples/pyash/modules/"))
    .sort();

  const failures = [];
  const missing = [];
  const timeouts = [];

  const queue = [...files];
  const workers = [];

  async function runOne(file) {
    if (skip.has(file)) {
      console.log(`==> ${file} (skipped)`);
      return;
    }
    console.log(`==> ${file}`);
    const meta = await extractMeta(file);
    if (meta?.requires?.length) {
      const unmet = [];
      for (const req of meta.requires) {
        const ok = await checkRequirement(req);
        if (!ok) unmet.push(req);
      }
      if (unmet.length) {
        console.log(`==> ${file} (missing: ${unmet.join(" ")})`);
        missing.push(`${file}: ${unmet.join(" ")}`);
        return;
      }
    }
    const isSession = meta?.mode === "session";
    const inputs = isSession && meta?.inputs?.length ? meta.inputs : (isSession ? ["/bye"] : []);
    const result = await runWithTimeout("./run", [file], {
      timeoutMs: DEFAULT_TIMEOUT_MS,
      inputLines: inputs
    });
    if (result.timedOut) {
      console.log(`TIMEOUT: ${file}`);
      timeouts.push(file);
      return;
    }
    if (result.code !== 0) {
      console.log(`FAILED: ${file}`);
      const tail = (result.stderr || result.stdout || "").trim().split("\n").slice(-8).join("\n");
      if (tail) console.log(tail);
      failures.push(file);
    }
  }

  async function worker() {
    while (queue.length) {
      const file = queue.shift();
      if (!file) return;
      await runOne(file);
    }
  }

  const workerCount = Number.isFinite(concurrency) ? Math.min(queue.length, concurrency) : queue.length;
  for (let i = 0; i < workerCount; i += 1) workers.push(worker());
  await Promise.all(workers);

  if (failures.length || timeouts.length || missing.length) {
    if (failures.length) {
      console.error("\nFailures:");
      for (const file of failures) console.error(file);
    }
    if (timeouts.length) {
      console.error("\nTimeouts:");
      for (const file of timeouts) console.error(file);
    }
    if (missing.length) {
      console.error("\nMissing requirements:");
      for (const item of missing) console.error(item);
    }
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
});
