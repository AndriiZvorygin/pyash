#!/usr/bin/env node
// Audit example .pya files for execution failures.
//
// Each example is executed by the real runner (command/run_pya_program.mjs) in a
// child process, so the audit observes exactly what a user would see. In-process
// replication is avoided on purpose: the runner keeps interpreter state
// (module dir, registered signatures, config defaults) that is easy to
// misrepresent and that silently changes results.
//
// Usage: node command/audit_examples.mjs [--dir examples/pyash] [--json] [--timeout-ms N]
// Exit code: 0 when no example fails beyond the recorded baseline, 1 when a
// new failure appears.

import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { parse } from "../program/understand/index.mjs";
import { splitSentences } from "../program/library/sentenceSplitter.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);

function flagValue(name, fallback) {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

const targetDir = flagValue("--dir", "examples/pyash");
const asJson = args.includes("--json");
const timeoutMs = Number(flagValue("--timeout-ms", "30000"));
const baselineFile = flagValue("--baseline", "configure/example_audit_baseline.pya");

// Known failures are recorded so the audit gates on *regressions*: an example
// that is already recorded keeps being reported, and a new failure fails the
// run. The list lives in a Pyash sentence file, not a separate format.
async function readBaseline() {
  const file = path.resolve(root, baselineFile);
  let source;
  try {
    source = await fs.readFile(file, "utf8");
  } catch {
    return new Set();
  }
  const names = new Set();
  const noComments = source.split(/\r?\n/u).filter((line) => !/^\s*#/u.test(line)).join("\n");
  for (const raw of splitSentences(noComments, { includeThen: true })) {
    let sentence;
    try {
      sentence = parse(String(raw || "").trim());
    } catch {
      continue;
    }
    if (String(sentence?.su?.name || "").toLowerCase() !== "known_failures") continue;
    const values = sentence?.ob?.ve?.values;
    if (Array.isArray(values)) {
      for (const value of values) names.add(String(value).trim());
      continue;
    }
    const text = String(sentence?.ob?.text || "");
    for (const value of text.split(/[\s,]+/u)) {
      if (value.trim()) names.add(value.trim());
    }
  }
  return names;
}

// Examples that need a live MCP server or model backend cannot be audited
// offline; they are reported as skipped rather than counted as failures.
const backendPattern = /\b(uvx|mcp-server-time|mind_ollama|mind_openai|mind_minimax|mind_zai|mind_strata)\b/;
// Examples that perform live network I/O are likewise skipped offline.
const networkPattern = /\b(download|web search|web-search|confederation-priest-run)\b/;

// Classify a failure so parameterized templates and environment-dependent
// examples are not reported as runtime defects.
function classify(output) {
  if (/input binding defective: missing required input/i.test(output)) return "needs input";
  if (/no such file or directory.*(module|know|artifacts|input)/i.test(output)) return "needs input";
  if (/Error opening output .*examples\/out/i.test(output)) return "needs input";
  if (/file or directory unavailable: .*examples\/out/i.test(output)) return "needs input";

  // A live model, media backend, audio device, or built helper binary.
  if (/localhost:11434|localhost:8000|localhost:8188|ollama request failed|whisperx|fetch failed|ECONNREFUSED/i.test(output)) return "needs backend";
  if (/gpu-managed comfyui job failed/i.test(output)) return "needs backend";
  if (/aplay:.*audio open error/i.test(output)) return "needs backend";
  if (/spawn caterer\/.*ENOENT/i.test(output)) return "needs backend";
  // An interactive session example waits for a live session that never arrives.
  if (/Detected unsettled top-level await/i.test(output)) return "needs backend";

  // A container-only path: the sandbox root is /workplace inside the image.
  if (/\/workplace\//.test(output)) return "needs backend";

  return "failed";
}

function runRunner(filePath, timeout) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [
      path.join(root, "command", "run_pya_program.mjs"),
      filePath
    ], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });

    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      resolve({ status: "timeout", detail: `exceeded ${timeout}ms` });
    }, timeout);

    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ status: "failed", detail: String(err?.message ?? err).slice(0, 160) });
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) {
        resolve({ status: "ok", detail: "" });
        return;
      }
      const combined = `${stdout}\n${stderr}`;
      const errorLine = combined
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .find((line) => /error|Error|Unknown verb|ENOENT|not exists/i.test(line));
      // Classify why the example failed so parameterized templates and
      // backend-dependent examples are not reported as defects.
      const kind = classify(combined);
      resolve({
        status: kind === "needs input" ? "needs input" : "failed",
        kind,
        detail: (errorLine ?? combined.split("\n").filter(Boolean).pop() ?? "non-zero exit").slice(0, 160),
        code
      });
    });
  });
}

const dir = path.resolve(root, targetDir);
const files = (await fs.readdir(dir)).filter((f) => f.endsWith(".pya")).sort();
const results = [];

for (const file of files) {
  const filePath = path.join(dir, file);
  const source = await fs.readFile(filePath, "utf8");
  if (backendPattern.test(source)) {
    results.push({ file, status: "skipped", reason: "needs live backend" });
    continue;
  }
  if (networkPattern.test(source)) {
    results.push({ file, status: "skipped", reason: "needs live network" });
    continue;
  }
  const started = Date.now();
  const outcome = await runRunner(filePath, timeoutMs);
  results.push({
    file,
    status: outcome.status,
    kind: outcome.kind ?? null,
    ms: Date.now() - started,
    detail: outcome.detail
  });
  if (!asJson) console.log(`  ${outcome.status === "ok" ? "ok" : "FAIL"} ${file}${outcome.detail ? ` :: ${outcome.detail}` : ""}`);
}

const needsBackend = results.filter((r) => r.status === "failed" && r.kind === "needs backend");
const failed = results.filter((r) => r.status === "failed" && r.kind !== "needs backend");
const needsInput = results.filter((r) => r.status === "needs input");
const skipped = results.filter((r) => r.status === "skipped");

const baseline = await readBaseline();
const regressions = failed.filter((r) => !baseline.has(r.file));
const known = failed.filter((r) => baseline.has(r.file));
const fixed = [...baseline].filter((name) => !failed.some((r) => r.file === name));
const passed = results.length - failed.length - needsBackend.length - needsInput.length - skipped.length;

if (asJson) {
  console.log(JSON.stringify({
    dir: targetDir,
    total: results.length,
    passed,
    failed: failed.length,
    knownFailures: known.length,
    regressions: regressions.length,
    needsBackend: needsBackend.length,
    needsInput: needsInput.length,
    skipped: skipped.length,
    results
  }, null, 2));
} else {
  console.log(`examples audit: ${passed} passed, ${failed.length} failed, ${needsBackend.length} need backend, ${needsInput.length} need input, ${skipped.length} skipped (of ${results.length})`);
  if (known.length > 0) {
    console.log(`  ${known.length} recorded failure(s) still present:`);
    for (const entry of known) console.log(`    ${entry.file}  :: ${entry.detail}`);
  }
  if (fixed.length > 0) {
    console.log(`  ${fixed.length} recorded failure(s) now pass; remove them from ${baselineFile}:`);
    for (const name of fixed) console.log(`    ${name}`);
  }
  if (regressions.length > 0) {
    console.log(`  ${regressions.length} new failure(s):`);
    for (const entry of regressions) console.log(`    ${entry.file}  :: ${entry.detail}`);
  }
}

process.exit(regressions.length ? 1 : 0);
