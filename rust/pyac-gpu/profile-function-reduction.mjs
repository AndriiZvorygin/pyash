#!/usr/bin/env node

import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import readline from "node:readline";
import { listProgramletBranches } from "./programlet_branch_reduction.mjs";
import { prepareReductionWorkspace } from "./function_reduction_workspace.mjs";
import { listProgramletShapes, replaceProgramletShape } from "./programlet_shape_reduction.mjs";
import { listReductionCandidates } from "./rust_function_source.mjs";
import { digest, profileExitCode, reductionLiveRamFloor, reductionStartupRamFloor, replacementDescription, sourceFingerprint, writeIndex, writeReport } from "./function_reduction_reports.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SOURCE_ROOT = path.resolve(process.env.PYAC_VLIW_REDUCE_SOURCE_ROOT || ROOT);
const CORE = path.join(SOURCE_ROOT, "rust/pyac-vliw-core");
const SHADER = path.join(SOURCE_ROOT, "rust/pyac-gpu/shader");
const PIPELINE_COMPILER = process.env.PYAC_VLIW_PIPELINE_COMPILER || path.join(ROOT, "rust/pyac-gpu/worker/target/release/pyac-vliw-pipeline-compiler");
const DIAGNOSTICS = path.join(ROOT, "rust/pyac-gpu/target/diagnostics/function-reduction");
const BUILD_TIMEOUT_SEC = Number(process.env.PYAC_VLIW_REDUCE_BUILD_TIMEOUT_SEC || 300);
const PIPELINE_TIMEOUT_SEC = Number(process.env.PYAC_VLIW_REDUCE_PIPELINE_TIMEOUT_SEC || 600);
const BUILD_RSS_LIMIT = 10 * 1024 ** 3;
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

async function runBounded(command, args, { cwd, env, timeoutSec, rssLimit, minAvailableRam, logPath, phase }) {
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
    else if (readAvailableRam() < minAvailableRam) {
      stopReason = `available host RAM fell below ${(minAvailableRam / 1024 ** 3).toFixed(0)} GiB`;
    }
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
  if (args.includes("--list-programlet-branches")) {
    for (const branch of listProgramletBranches()) process.stdout.write(`${branch}\n`);
    return;
  }
  if (args.includes("--list-programlet-shapes")) {
    for (const name of listProgramletShapes()) process.stdout.write(`${name}\n`);
    return;
  }
  if (!args.includes("--run")) throw new Error("pass --run to create a diagnostic SPIR-V variant");
  const functionArg = args.indexOf("--function");
  const functionsArg = args.indexOf("--functions");
  const functionNames = functionsArg >= 0
    ? args[functionsArg + 1]?.split(",").map((name) => name.trim()).filter(Boolean)
    : functionArg >= 0 ? [args[functionArg + 1]] : [];
  const branchArg = args.indexOf("--programlet-branch");
  const branchNames = branchArg >= 0 ? args[branchArg + 1]?.split(",").map((name) => name.trim()).filter(Boolean) : [];
  const branchVariantArg = args.indexOf("--branch-variant");
  const shapeArg = args.indexOf("--programlet-shape");
  const shapeOverrides = shapeArg >= 0 ? args[shapeArg + 1]?.split(",").map((entry) => {
    const [name, value, extra] = entry.split("=");
    if (!name || !value || extra !== undefined || !listProgramletShapes().includes(name)) throw new Error(`invalid programlet shape override: ${entry}`);
    return [name, Number(value)];
  }) : [];
  const variantArg = args.indexOf("--variant");
  const variant = variantArg >= 0 ? args[variantArg + 1] : "error";
  const branchVariant = branchVariantArg >= 0
    ? args[branchVariantArg + 1]
    : ["error", "noop"].includes(variant) ? variant : "error";
  const candidatesByName = new Map(listReductionCandidates().map((entry) => [entry.name, entry]));
  if ((functionNames.length === 0 && branchNames.length === 0 && shapeOverrides.length === 0) || functionNames.some((name) => !candidatesByName.has(name))) {
    throw new Error("select candidates with --function/--functions, --programlet-branch, or --programlet-shape; list available choices first");
  }
  if (new Set(functionNames).size !== functionNames.length) throw new Error("function selection contains duplicates");
  if (new Set(branchNames).size !== branchNames.length || branchNames.some((name) => !listProgramletBranches().includes(name))) throw new Error("unknown or duplicate programlet branch; list them with --list-programlet-branches");
  if (new Set(shapeOverrides.map(([name]) => name)).size !== shapeOverrides.length) throw new Error("duplicate programlet shape override");
  for (const [name, value] of shapeOverrides) replaceProgramletShape(fs.readFileSync(path.join(CORE, "src/semantics_runtime.rs"), "utf8"), name, value);
  if (branchNames.length && !["error", "noop"].includes(branchVariant)) throw new Error("programlet branch reduction requires --branch-variant error or noop");
  if (branchVariantArg >= 0 && !branchNames.length) throw new Error("--branch-variant requires --programlet-branch");
  const candidates = functionNames.map((name) => candidatesByName.get(name));
  const selectedNames = [...functionNames, ...branchNames, ...shapeOverrides.map(([name, value]) => `${name}-${value}`)];
  const candidate = {
    name: selectedNames.join(", "),
    file: [...new Set([...candidates.map(({ file }) => file), ...(branchNames.length ? ["programlet_execute.rs"] : []), ...(shapeOverrides.length ? ["semantics_runtime.rs"] : [])])].join(", "),
  };
  if (!["baseline", "error", "minimal", "noop"].includes(variant)) throw new Error("--variant must be baseline, error, minimal, or noop");
  if (variant === "noop" && !branchNames.length) throw new Error("--variant noop requires --programlet-branch");
  if (variant === "minimal") {
    const unsupported = candidates.find(({ minimalStub }) => !minimalStub);
    if (unsupported) throw new Error(`no success-preserving minimal variant exists for ${unsupported.name}`);
  }
  const repoSource = args.includes("--repo-source");
  const entrypointModes = ["pack", "programlet", "sections"].filter((name) => args.includes(`--${name}-only`));
  if (entrypointModes.length > 1) throw new Error("select at most one isolated shader entrypoint");
  const entrypointMode = entrypointModes[0] ?? "all";
  const buildOnly = args.includes("--build-only");
  if (repoSource && variant !== "baseline") throw new Error("--repo-source is only valid for the unmodified baseline variant");
  if (repoSource && entrypointMode !== "all") throw new Error("--repo-source cannot be combined with isolated entrypoint mode");
  if (repoSource && branchNames.length) throw new Error("--repo-source cannot be combined with programlet branch reduction");
  if (repoSource && shapeOverrides.length) throw new Error("--repo-source cannot be combined with programlet shape reduction");
  if (!Number.isInteger(BUILD_TIMEOUT_SEC) || BUILD_TIMEOUT_SEC < 1 || BUILD_TIMEOUT_SEC > 300) throw new Error("build timeout must be 1..300 seconds");
  if (!Number.isInteger(PIPELINE_TIMEOUT_SEC) || PIPELINE_TIMEOUT_SEC < 1 || PIPELINE_TIMEOUT_SEC > 600) throw new Error("pipeline timeout must be 1..600 seconds");
  if (!fs.existsSync(PIPELINE_COMPILER)) throw new Error(`prebuilt Vulkan pipeline compiler missing: ${PIPELINE_COMPILER}`);
  const available = readAvailableRam();
  const startupRamFloor = reductionStartupRamFloor(buildOnly);
  if (available < startupRamFloor) {
    throw new Error(`refusing ${buildOnly ? "CPU-only shader build" : "shader plus Vulkan probe"} with only ${(available / 1024 ** 3).toFixed(1)} GiB available RAM; requires ${(startupRamFloor / 1024 ** 3).toFixed(0)} GiB`);
  }

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
    const runLabel = selectedNames.length === 1 ? selectedNames[0] : `group-${digest(selectedNames.join(",")).slice(0, 10)}`;
    const runDir = path.join(DIAGNOSTICS, `${timestamp()}-${runLabel}${entrypointMode !== "all" ? `-${entrypointMode}-only` : ""}`);
    fs.mkdirSync(runDir, { recursive: false });
    const sourceHash = sourceFingerprint([CORE, SHADER], ROOT);
    const shaderCopy = repoSource ? SHADER : prepareReductionWorkspace({
      core: CORE, shader: SHADER, diagnostics: DIAGNOSTICS, candidates, branchNames,
      branchVariant, shapeOverrides, runDir, sourceHash, variant, entrypointMode,
    }).shaderCopy;
    if (repoSource) fs.writeFileSync(path.join(runDir, "mutation.diff"), `functions: ${candidate.name}\nvariant: baseline (repository source, unchanged)\nsource tree sha256: ${sourceHash}\n`);
    const buildOutput = path.join(runDir, "generated");
    const build = await runBounded("cargo", [
    "gpu", "build", "--shader-crate", shaderCopy,
    "--target", "spirv-unknown-spv1.5", "--features", "vulkan-device-atomics,shader-f64",
    "--capabilities", "Float64", "--capabilities", "Int64",
    "--output-dir", path.join(buildOutput, "vulkan"),
    ], {
      cwd: ROOT,
      env: process.env,
      timeoutSec: BUILD_TIMEOUT_SEC,
      rssLimit: BUILD_RSS_LIMIT,
      minAvailableRam: reductionLiveRamFloor(buildOnly),
      logPath: path.join(runDir, "shader-build.log"),
      phase: "shader build",
    });
    const spirvPath = path.join(buildOutput, "vulkan/pyac_vliw_gpu_kernel.spv");
    const spirvAvailable = fs.existsSync(spirvPath) && fs.statSync(spirvPath).size > 0;
    let pipeline = null;
    if (!buildOnly && !build.stopReason && build.code === 0 && spirvAvailable) {
      pipeline = await runBounded("node", [path.join(ROOT, "rust/pyac-gpu/profile-pipeline-build.mjs"), "--run"], {
        cwd: ROOT,
        env: {
          ...process.env,
          PYAC_VLIW_SPIRV_PATH: spirvPath,
          PYAC_VLIW_PROFILE_TIMEOUT_SEC: String(PIPELINE_TIMEOUT_SEC),
          PYAC_VLIW_PROFILE_LABEL: `${runLabel}${entrypointMode !== "all" ? `-${entrypointMode}-only` : ""}`,
        },
        timeoutSec: PIPELINE_TIMEOUT_SEC + 8,
        rssLimit: 16 * 1024 ** 3,
        minAvailableRam: 12 * 1024 ** 3,
        logPath: path.join(runDir, "vulkan-probe.log"),
        phase: "Vulkan probe",
      });
    }
    writeReport(runDir, candidate, variant, build, pipeline, spirvPath);
    writeIndex(DIAGNOSTICS);
    process.stdout.write(`[reduction] report: ${path.join(runDir, "report.md")}\n`);
    process.exitCode = profileExitCode(build, pipeline, spirvAvailable);
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
