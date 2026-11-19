#!/usr/bin/env node

import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import readline from "node:readline";
import { listReductionCandidates, replaceCandidateBody } from "./rust_function_source.mjs";
import { digest, replacementDescription, sourceFingerprint, writeIndex, writeReport } from "./function_reduction_reports.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const CORE = path.join(ROOT, "rust/pyac-vliw-core");
const SHADER = path.join(ROOT, "rust/pyac-gpu/shader");
const PIPELINE_COMPILER = process.env.PYAC_VLIW_PIPELINE_COMPILER || path.join(ROOT, "rust/pyac-gpu/worker/target/release/pyac-vliw-pipeline-compiler");
const DIAGNOSTICS = path.join(ROOT, "rust/pyac-gpu/target/diagnostics/function-reduction");
const BUILD_TIMEOUT_SEC = Number(process.env.PYAC_VLIW_REDUCE_BUILD_TIMEOUT_SEC || 120);
const PIPELINE_TIMEOUT_SEC = Number(process.env.PYAC_VLIW_REDUCE_PIPELINE_TIMEOUT_SEC || 60);
const BUILD_RSS_LIMIT = 10 * 1024 ** 3;
const MIN_BUILD_RAM = 16 * 1024 ** 3;
const SAMPLE_MS = 2000;

function timestamp() {
  return new Date().toISOString().replace(/[-:]/gu, "").replace(/\.\d+Z$/u, "Z");
}

function readAvailableRam() {
  const match = fs.readFileSync("/proc/meminfo", "utf8").match(/^MemAvailable:\s+(\d+)\s+kB$/mu);
  if (!match) throw new Error("cannot read MemAvailable");
  return Number(match[1]) * 1024;
}

function processTreeRss(rootPid) {
  const rows = execFileSync("ps", ["-eo", "pid=,ppid=,rss="], { encoding: "utf8" }).trim().split(/\r?\n/u);
  const parents = new Map();
  for (const line of rows) {
    const [pid, ppid, rss] = line.trim().split(/\s+/u).map(Number);
    if ([pid, ppid, rss].every(Number.isFinite)) parents.set(pid, { ppid, rss });
  }
  const pids = new Set([rootPid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [pid, process] of parents) {
      if (!pids.has(pid) && pids.has(process.ppid)) {
        pids.add(pid);
        changed = true;
      }
    }
  }
  return [...pids].reduce((sum, pid) => sum + (parents.get(pid)?.rss || 0), 0) * 1024;
}

function stopGroup(child, signal) {
  if (!child.pid) return;
  try { process.kill(-child.pid, signal); } catch { try { child.kill(signal); } catch { /* already exited */ } }
}

async function runBounded(command, args, { cwd, env, timeoutSec, rssLimit, logPath, phase }) {
  const child = spawn(command, args, { cwd, env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  const log = fs.createWriteStream(logPath, { flags: "wx" });
  let bytes = 0;
  const write = (name, line) => {
    const record = `[${name}] ${line}\n`;
    if (bytes < 4 * 1024 ** 2) {
      log.write(record);
      bytes += Buffer.byteLength(record);
    }
    if (line.includes("error") || line.includes("Finished ") || line.startsWith("SPIR-V:") || line.includes("pipeline") || line.includes("report:")) {
      process.stdout.write(`[${phase}] ${line}\n`);
    }
  };
  for (const [name, stream] of [["stdout", child.stdout], ["stderr", child.stderr]]) {
    readline.createInterface({ input: stream }).on("line", (line) => write(name, line));
  }
  const started = Date.now();
  const closed = new Promise((resolve) => {
    child.once("close", (code, signal) => resolve({ code, signal }));
    child.once("error", (error) => resolve({ code: null, signal: null, error: error.message }));
  });
  let exit;
  let stopReason = null;
  let peakRss = 0;
  while (!exit) {
    exit = await Promise.race([closed, new Promise((resolve) => setTimeout(() => resolve(null), SAMPLE_MS))]);
    if (exit) break;
    const rss = processTreeRss(child.pid);
    peakRss = Math.max(peakRss, rss);
    if (Date.now() - started >= timeoutSec * 1000) stopReason = `${timeoutSec}s time cap`;
    else if (rss >= rssLimit) stopReason = `${(rssLimit / 1024 ** 3).toFixed(0)} GiB process RSS cap`;
    else if (readAvailableRam() < MIN_BUILD_RAM) stopReason = "available host RAM fell below 16 GiB";
    if (stopReason) {
      stopGroup(child, "SIGINT");
      exit = await Promise.race([closed, new Promise((resolve) => setTimeout(() => resolve(null), 3000))]);
      if (!exit) {
        stopGroup(child, "SIGKILL");
        exit = await closed;
      }
      break;
    }
  }
  peakRss = Math.max(peakRss, processTreeRss(child.pid));
  log.end();
  await new Promise((resolve) => log.once("finish", resolve));
  return { ...exit, stopReason, elapsedMs: Date.now() - started, peakRss };
}

function copyTree(source, destination) {
  fs.cpSync(source, destination, {
    recursive: true,
    force: true,
    filter: (entry) => !entry.split(path.sep).some((part) => part === ".git" || part === "target"),
  });
}

function prepareWorkspace(candidate, runDir, sourceHash, variant) {
  const workspace = path.join(DIAGNOSTICS, "workspace");
  const coreCopy = path.join(workspace, "rust/pyac-vliw-core");
  const shaderCopy = path.join(workspace, "rust/pyac-gpu/shader");
  fs.mkdirSync(path.dirname(coreCopy), { recursive: true });
  fs.mkdirSync(path.dirname(shaderCopy), { recursive: true });
  fs.rmSync(path.join(coreCopy, "src"), { recursive: true, force: true });
  fs.rmSync(path.join(shaderCopy, "src"), { recursive: true, force: true });
  copyTree(CORE, coreCopy);
  copyTree(SHADER, shaderCopy);

  const functionPath = path.join(coreCopy, "src/semantics_runtime", candidate.file);
  const original = fs.readFileSync(functionPath, "utf8");
  const replaced = replaceCandidateBody(original, candidate.name, variant);
  fs.writeFileSync(functionPath, replaced.source);
  fs.writeFileSync(path.join(runDir, "mutation.diff"), [
    `function: ${candidate.name}`,
    `source: rust/pyac-vliw-core/src/semantics_runtime/${candidate.file}`,
    `variant: ${variant}`,
    `input shader/core tree sha256: ${sourceHash}`,
    `original sha256: ${digest(original)}`,
    `variant sha256: ${digest(replaced.source)}`,
    `replaced body bytes: ${Buffer.byteLength(replaced.originalBody)}`,
    `replacement: ${replacementDescription(variant)}`,
    "",
  ].join("\n"));
  return { workspace, shaderCopy };
}

async function main(args) {
  if (args.includes("--index")) {
    writeIndex(DIAGNOSTICS);
    process.stdout.write(`[reduction] index: ${path.join(DIAGNOSTICS, "index.md")}\n`);
    return;
  }
  if (args.includes("--list")) {
    for (const candidate of listReductionCandidates()) process.stdout.write(`${candidate.name}\t${candidate.file}\n`);
    return;
  }
  if (!args.includes("--run")) throw new Error("pass --run to create a diagnostic SPIR-V variant and probe Vulkan pipeline creation");
  const functionArg = args.indexOf("--function");
  const functionName = functionArg >= 0 ? args[functionArg + 1] : null;
  const variantArg = args.indexOf("--variant");
  const variant = variantArg >= 0 ? args[variantArg + 1] : "error";
  const candidate = listReductionCandidates().find((entry) => entry.name === functionName);
  if (!candidate) throw new Error(`select one known candidate with --function; list them with --list`);
  if (!["baseline", "error", "minimal"].includes(variant)) throw new Error("--variant must be baseline, error, or minimal");
  if (variant === "minimal" && !candidate.minimalStub) throw new Error(`no success-preserving minimal variant exists for ${functionName}`);
  const repoSource = args.includes("--repo-source");
  if (repoSource && variant !== "baseline") throw new Error("--repo-source is only valid for the unmodified baseline variant");
  if (!Number.isInteger(BUILD_TIMEOUT_SEC) || BUILD_TIMEOUT_SEC < 1 || BUILD_TIMEOUT_SEC > 300) throw new Error("build timeout must be 1..300 seconds");
  if (!Number.isInteger(PIPELINE_TIMEOUT_SEC) || PIPELINE_TIMEOUT_SEC < 1 || PIPELINE_TIMEOUT_SEC > 120) throw new Error("pipeline timeout must be 1..120 seconds");
  if (!fs.existsSync(PIPELINE_COMPILER)) throw new Error(`prebuilt Vulkan pipeline compiler missing: ${PIPELINE_COMPILER}`);
  const available = readAvailableRam();
  if (available < 20 * 1024 ** 3) throw new Error(`refusing shader build with only ${(available / 1024 ** 3).toFixed(1)} GiB available RAM`);

  fs.mkdirSync(DIAGNOSTICS, { recursive: true });
  const lockPath = path.join(DIAGNOSTICS, "workspace.lock");
  let lockFd;
  try {
    lockFd = fs.openSync(lockPath, "wx");
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const ownerPid = Number(fs.readFileSync(lockPath, "utf8").trim());
    try {
      if (!Number.isInteger(ownerPid) || ownerPid < 2) throw new Error("invalid stale pid");
      process.kill(ownerPid, 0);
    } catch {
      fs.rmSync(lockPath, { force: true });
      lockFd = fs.openSync(lockPath, "wx");
    }
    if (lockFd === undefined) throw new Error(`another function-reduction run holds workspace lock (pid ${ownerPid})`);
  }
  fs.writeFileSync(lockFd, `${process.pid}\n`);
  try {
    const runDir = path.join(DIAGNOSTICS, `${timestamp()}-${candidate.name}`);
    fs.mkdirSync(runDir, { recursive: false });
    const sourceHash = sourceFingerprint([CORE, SHADER], ROOT);
    const shaderCopy = repoSource ? SHADER : prepareWorkspace(candidate, runDir, sourceHash, variant).shaderCopy;
    if (repoSource) fs.writeFileSync(path.join(runDir, "mutation.diff"), `function: ${candidate.name}\nvariant: baseline (repository source, unchanged)\nsource tree sha256: ${sourceHash}\n`);
    const buildOutput = path.join(runDir, "generated");
    const build = await runBounded("cargo", [
    "gpu", "build", "--shader-crate", shaderCopy,
    "--target", "spirv-unknown-spv1.5", "--features", "vulkan-device-atomics",
    "--output-dir", path.join(buildOutput, "vulkan"),
    ], {
      cwd: ROOT,
      env: process.env,
      timeoutSec: BUILD_TIMEOUT_SEC,
      rssLimit: BUILD_RSS_LIMIT,
      logPath: path.join(runDir, "shader-build.log"),
      phase: "shader build",
    });
    const spirvPath = path.join(buildOutput, "vulkan/pyac_vliw_gpu_kernel.spv");
    let pipeline = null;
    if (!build.stopReason && build.code === 0 && fs.existsSync(spirvPath)) {
      pipeline = await runBounded("node", [path.join(ROOT, "rust/pyac-gpu/profile-pipeline-build.mjs"), "--run"], {
        cwd: ROOT,
        env: {
          ...process.env,
          PYAC_VLIW_SPIRV_PATH: spirvPath,
          PYAC_VLIW_PROFILE_TIMEOUT_SEC: String(PIPELINE_TIMEOUT_SEC),
          PYAC_VLIW_PROFILE_LABEL: candidate.name,
        },
        timeoutSec: PIPELINE_TIMEOUT_SEC + 8,
        rssLimit: 16 * 1024 ** 3,
        logPath: path.join(runDir, "vulkan-probe.log"),
        phase: "Vulkan probe",
      });
    }
    writeReport(runDir, candidate, variant, build, pipeline, spirvPath);
    writeIndex(DIAGNOSTICS);
    process.stdout.write(`[reduction] report: ${path.join(runDir, "report.md")}\n`);
    if (build.stopReason || build.code !== 0) process.exitCode = 1;
  } finally {
    fs.closeSync(lockFd);
    fs.rmSync(lockPath, { force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`[function reduction] ${error.message}\n`);
    process.exitCode = 1;
  });
}
