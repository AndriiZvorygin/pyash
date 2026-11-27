#!/usr/bin/env node

import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import readline from "node:readline";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DIAGNOSTICS_ROOT = path.join(ROOT, "rust/pyac-gpu/target/diagnostics");
const DEFAULT_COMPILER = path.join(ROOT, "rust/pyac-gpu/worker/target/release/pyac-vliw-pipeline-compiler");
const COMPILER = process.env.PYAC_VLIW_PIPELINE_COMPILER || DEFAULT_COMPILER;
const SHADER = process.env.PYAC_VLIW_SPIRV_PATH || path.join(ROOT, "rust/pyac-gpu/target/generated/vulkan/pyac_vliw_gpu_kernel.spv");
const MAX_TIMEOUT_SEC = 600;
const MAX_PROCESS_RSS = 16 * 1024 ** 3;
const MIN_AVAILABLE_RAM = 16 * 1024 ** 3;
const SMALL_SHADER_MAX_BYTES = 1024 ** 2;
const SMALL_SHADER_MIN_RAM = 8 * 1024 ** 3;
const LIVE_AVAILABLE_RAM_FLOOR = 8 * 1024 ** 3;
const SAMPLE_MS = 2000;
const MAX_LOG_BYTES = 8 * 1024 ** 2;
const PROFILE_LABEL = process.env.PYAC_VLIW_PROFILE_LABEL?.replace(/[^a-zA-Z0-9_-]/gu, "_");

export function parseStageLine(line) {
  const rules = [
    [/requesting Vulkan adapter/u, "Vulkan adapter request", false],
    [/adapter ready in ([\d.]+)s/u, "Vulkan adapter ready", true],
    [/requesting Vulkan device/u, "Vulkan device request", false],
    [/device ready in ([\d.]+)s/u, "Vulkan device ready", true],
    [/creating SPIR-V module/u, "SPIR-V module creation", false],
    [/SPIR-V module ready in ([\d.]+)s/u, "SPIR-V module ready", true],
    [/creating (pack|programlet|sections) pipeline/u, null, false],
    [/(pack|programlet|sections) pipeline ready in ([\d.]+)s/u, null, true],
  ];
  for (const [pattern, fixedStage, complete] of rules) {
    const match = line.match(pattern);
    if (!match) continue;
    if (fixedStage) return { stage: fixedStage, complete };
    const kind = match[1];
    const duration = complete ? Number(match[2]) : null;
    const name = kind === "sections" ? "section" : kind;
    return {
      stage: `${name} pipeline ${complete ? "ready" : "creation"}`,
      complete,
      durationSeconds: duration,
    };
  }
  if (line.includes("wrote compiled GPU pipeline artifact")) {
    return { stage: "pipeline artifact saved", complete: true };
  }
  return null;
}

export function renderProfileReport(profile) {
  const lines = [
    "# Vulkan Pipeline Build Profile",
    "",
    ...(profile.label ? [`- Profile label: ${profile.label}`] : []),
    `- Host: ${profile.host}`,
    `- Vulkan device: ${profile.gpu.name}; driver ${profile.gpu.driver}; ${profile.gpu.freeMiB} MiB free VRAM at start`,
    `- Available host RAM at start: ${(profile.availableRamBytes / 1024 ** 3).toFixed(1)} GiB`,
    `- Preflight RAM floor: ${(profile.minimumAvailableRamBytes / 1024 ** 3).toFixed(0)} GiB`,
    `- Live RAM floor: ${(LIVE_AVAILABLE_RAM_FLOOR / 1024 ** 3).toFixed(0)} GiB`,
    `- Result: ${profile.result}`,
    `- Stop reason: ${profile.stopReason || "completed"}`,
    `- Compiler binary: ${profile.compiler}`,
    `- Compiler PID: ${profile.compilerPid}`,
    `- Wall time: ${(profile.elapsedMs / 1000).toFixed(1)} s; peak process-tree RSS: ${(profile.peakRssBytes / 1024 ** 3).toFixed(2)} GiB`,
    `- Last observed stage: ${profile.lastStage || "none"}`,
    "",
    "## Stage events",
    "",
  ];
  if (profile.stages.length) {
    for (const entry of profile.stages) {
      const duration = entry.durationSeconds == null ? "" : ` (${entry.durationSeconds}s reported)`;
      lines.push(`- +${(entry.atMs / 1000).toFixed(1)}s: ${entry.stage}${duration}`);
    }
  } else {
    lines.push("- No stage marker was emitted.");
  }
  lines.push(
    "",
    `- Pipeline artifact: ${profile.artifact || "not retained"}`,
    "- This profiles host-side Vulkan driver pipeline compilation only; it does not dispatch VLIW shader work or compile Rust-GPU source to SPIR-V.",
    "- GPU compute utilization is not a success signal for this step; measure driver CPU time, host RAM, stage completion, and cache output.",
    "",
  );
  return lines.join("\n");
}

function readAvailableRam() {
  const match = fs.readFileSync("/proc/meminfo", "utf8").match(/^MemAvailable:\s+(\d+)\s+kB$/mu);
  if (!match) throw new Error("could not read MemAvailable from /proc/meminfo");
  return Number(match[1]) * 1024;
}

function readGpu() {
  const output = execFileSync("nvidia-smi", [
    "--query-gpu=name,driver_version,memory.free",
    "--format=csv,noheader,nounits",
  ], { encoding: "utf8" }).trim();
  const rows = output.split(/\r?\n/u);
  if (rows.length !== 1) throw new Error(`expected one NVIDIA GPU, found ${rows.length}`);
  const [name, driver, freeMiB] = rows[0].split(",").map((value) => value.trim());
  if (!name || !driver || !Number.isFinite(Number(freeMiB))) {
    throw new Error(`could not parse nvidia-smi row: ${rows[0]}`);
  }
  return { name, driver, freeMiB: Number(freeMiB) };
}

export function minimumAvailableRamForShader(shaderBytes) {
  return shaderBytes <= SMALL_SHADER_MAX_BYTES ? SMALL_SHADER_MIN_RAM : MIN_AVAILABLE_RAM;
}

function processTreeUsage(rootPid) {
  const rows = execFileSync("ps", ["-eo", "pid=,ppid=,rss=,pcpu="], { encoding: "utf8" });
  const processes = new Map();
  for (const line of rows.trim().split(/\r?\n/u)) {
    const [pid, ppid, rssKiB, cpu] = line.trim().split(/\s+/u).map(Number);
    if ([pid, ppid, rssKiB, cpu].every(Number.isFinite)) processes.set(pid, { ppid, rssKiB, cpu });
  }
  const pids = new Set([rootPid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [pid, entry] of processes) {
      if (!pids.has(pid) && pids.has(entry.ppid)) {
        pids.add(pid);
        changed = true;
      }
    }
  }
  let rssBytes = 0;
  let cpuPercent = 0;
  for (const pid of pids) {
    rssBytes += (processes.get(pid)?.rssKiB || 0) * 1024;
    cpuPercent += processes.get(pid)?.cpu || 0;
  }
  return { rssBytes, cpuPercent };
}

function signalProcessGroup(child, signal) {
  if (!child.pid) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    try { child.kill(signal); } catch { /* already exited */ }
  }
}

function compactTimestamp() {
  return new Date().toISOString().replace(/[-:]/gu, "").replace(/\.\d+Z$/u, "Z");
}

export function resolveProfileOutputDir({
  diagnosticsRoot = DIAGNOSTICS_ROOT,
  requestedPath = process.env.PYAC_VLIW_PROFILE_DIR,
  label = PROFILE_LABEL,
  timestamp = compactTimestamp(),
} = {}) {
  const root = path.resolve(diagnosticsRoot);
  const prefix = label ? `pipeline-build-${label}-` : "pipeline-build-";
  const outputDir = path.resolve(requestedPath || path.join(root, `${prefix}${timestamp}`));
  const relative = path.relative(root, outputDir);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`profile output must be a child of ${root}: ${outputDir}`);
  }
  return outputDir;
}

async function runProfile() {
  const timeoutSec = Number(process.env.PYAC_VLIW_PROFILE_TIMEOUT_SEC || MAX_TIMEOUT_SEC);
  if (!Number.isInteger(timeoutSec) || timeoutSec < 1 || timeoutSec > MAX_TIMEOUT_SEC) {
    throw new Error(`PYAC_VLIW_PROFILE_TIMEOUT_SEC must be an integer from 1 to ${MAX_TIMEOUT_SEC}`);
  }
  const maxWallMs = timeoutSec * 1000;
  if (!fs.existsSync(COMPILER) || !fs.existsSync(SHADER)) {
    throw new Error(`prebuilt inputs required; expected ${COMPILER} and ${SHADER}; this script does not build them`);
  }
  const shaderBytes = fs.statSync(SHADER).size;
  const minimumAvailableRamBytes = minimumAvailableRamForShader(shaderBytes);
  const availableRamBytes = readAvailableRam();
  if (availableRamBytes < minimumAvailableRamBytes) {
    throw new Error(`refusing profile: ${(availableRamBytes / 1024 ** 3).toFixed(1)} GiB host RAM available; this ${(shaderBytes / 1024 ** 2).toFixed(2)}-MiB SPIR-V requires ${(minimumAvailableRamBytes / 1024 ** 3).toFixed(0)} GiB`);
  }
  const gpu = readGpu();
  const outputDir = resolveProfileOutputDir();
  fs.mkdirSync(outputDir, { recursive: true });
  const logPath = path.join(outputDir, "pipeline-build.log");
  const artifactPath = path.join(outputDir, "pipeline-cache.bin");
  const pidPath = path.join(outputDir, "compiler.pid");
  const reportPath = path.join(outputDir, "report.md");
  for (const outputPath of [logPath, artifactPath, pidPath, reportPath]) {
    if (fs.existsSync(outputPath)) throw new Error(`refusing to overwrite profile output: ${outputPath}`);
  }
  const log = fs.createWriteStream(logPath, { flags: "wx" });
  const child = spawn(COMPILER, [SHADER, artifactPath], {
    cwd: ROOT,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  fs.writeFileSync(pidPath, `${child.pid}\n`, { flag: "wx" });
  const start = Date.now();
  let logBytes = 0;
  let omittedBytes = 0;
  let peakRssBytes = 0;
  let lastStage = "starting Vulkan pipeline compiler";
  const stages = [];
  const writeLine = (streamName, line) => {
    const record = `+${((Date.now() - start) / 1000).toFixed(3)}s [${streamName}] ${line}\n`;
    const parsed = parseStageLine(line);
    if (parsed) {
      lastStage = parsed.stage;
      stages.push({ ...parsed, atMs: Date.now() - start });
    }
    if (logBytes + Buffer.byteLength(record) <= MAX_LOG_BYTES) {
      log.write(record);
      logBytes += Buffer.byteLength(record);
    } else {
      omittedBytes += Buffer.byteLength(record);
    }
    process.stdout.write(record);
  };
  for (const [name, stream] of [["stdout", child.stdout], ["stderr", child.stderr]]) {
    readline.createInterface({ input: stream }).on("line", (line) => writeLine(name, line));
  }

  const closed = new Promise((resolve) => child.once("close", (code, signal) => resolve({ code, signal })));
  let exit = null;
  let stopReason = null;
  let lastProgress = start;
  while (!exit) {
    exit = await Promise.race([closed, new Promise((resolve) => setTimeout(() => resolve(null), SAMPLE_MS))]);
    if (exit) break;
    const usage = processTreeUsage(child.pid);
    peakRssBytes = Math.max(peakRssBytes, usage.rssBytes);
    const elapsed = Date.now() - start;
    const memoryLeft = readAvailableRam();
    if (elapsed >= maxWallMs) stopReason = `${timeoutSec}-second wall limit`;
    else if (usage.rssBytes >= MAX_PROCESS_RSS) stopReason = "16-GiB process-tree RSS limit";
    else if (memoryLeft < LIVE_AVAILABLE_RAM_FLOOR) stopReason = "host MemAvailable fell below 8 GiB";
    if (stopReason) {
      signalProcessGroup(child, "SIGINT");
      exit = await Promise.race([closed, new Promise((resolve) => setTimeout(() => resolve(null), 3000))]);
      if (!exit) {
        signalProcessGroup(child, "SIGKILL");
        exit = await closed;
      }
      break;
    }
    if (Date.now() - lastProgress >= 15_000) {
      process.stdout.write(`[profile] ${lastStage}; ${elapsed / 1000}s; RSS ${(usage.rssBytes / 1024 ** 3).toFixed(2)} GiB; process CPU ${usage.cpuPercent.toFixed(0)}%\n`);
      lastProgress = Date.now();
    }
  }
  peakRssBytes = Math.max(peakRssBytes, processTreeUsage(child.pid).rssBytes);
  log.end();
  await new Promise((resolve) => log.once("finish", resolve));
  if (omittedBytes) fs.appendFileSync(logPath, `\n[profile] omitted ${omittedBytes} bytes after ${MAX_LOG_BYTES} bytes\n`);

  const success = !stopReason && exit?.code === 0 && fs.existsSync(artifactPath) && fs.statSync(artifactPath).size > 0;
  if (!success) fs.rmSync(artifactPath, { force: true });
  const profile = {
    host: execFileSync("hostname", { encoding: "utf8" }).trim(),
    label: PROFILE_LABEL || null,
    gpu,
    compiler: COMPILER,
    compilerPid: child.pid,
    availableRamBytes,
    minimumAvailableRamBytes,
    result: success ? "success" : `failed (exit ${exit?.code ?? "unknown"}${exit?.signal ? `, signal ${exit.signal}` : ""})`,
    stopReason,
    elapsedMs: Date.now() - start,
    peakRssBytes,
    lastStage,
    stages,
    artifact: success ? artifactPath : null,
  };
  fs.writeFileSync(reportPath, renderProfileReport(profile), { flag: "wx" });
  process.stdout.write(`\n[profile] report: ${reportPath}\n`);
  process.stdout.write(`[profile] log: ${logPath}\n`);
  if (!success) throw new Error(`${profile.result}; last stage: ${lastStage}; ${stopReason || "see report"}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.argv.slice(2).includes("--help")) {
    process.stdout.write("Usage: node rust/pyac-gpu/profile-pipeline-build.mjs --run\n\nRuns the prebuilt Vulkan pipeline compiler only. It does not run cargo, compile SPIR-V, or dispatch shader work. Vulkan pipeline compilation runs in the host-side driver; GPU compute utilization is not a success signal. Defaults: 10 minutes, 16 GiB process RSS; preflight requires 16 GiB host RAM for full-size SPIR-V and 8 GiB for diagnostic SPIR-V <= 1 MiB; live MemAvailable floor is 8 GiB. Free VRAM is recorded as device context, not used as an idle-GPU gate. Set PYAC_VLIW_PROFILE_DIR to keep logs, report, and cache beside an existing SPIR-V under rust/pyac-gpu/target/diagnostics. Shorten the wall limit with PYAC_VLIW_PROFILE_TIMEOUT_SEC (maximum 600). Select an alternate prebuilt compiler with PYAC_VLIW_PIPELINE_COMPILER.\n");
  } else if (!process.argv.slice(2).includes("--run")) {
    process.stderr.write("This starts target-GPU driver pipeline creation. Pass --run explicitly after reviewing the host resource checks.\n");
    process.exitCode = 2;
  } else {
    runProfile().catch((error) => {
      process.stderr.write(`[pipeline profile] ${error.message}\n`);
      process.exitCode = 1;
    });
  }
}
