#!/usr/bin/env node

import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import readline from "node:readline";
import { instrumentInlineSource } from "./inline_diagnostics.mjs";
import { createInlineMetricCollector, parseSpirtLocations, renderInlineReport } from "./inline_diagnostics_report.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SHADER = path.join(ROOT, "rust/pyac-gpu/shader");
const INSTRUMENTATION_VERSION = "2";
const RUST_GPU_LIMIT_MS = 15 * 60 * 1000;
const RSS_LIMIT_BYTES = 8 * 1024 ** 3;
const BUILD_LOG_LIMIT_BYTES = 4 * 1024 ** 2;
const SAMPLE_MS = 2000;

function run(command, args, options = {}) {
  return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...options }).trim();
}

function findCargoGpu() {
  return run("which", ["cargo-gpu"]);
}

function findRustGpuCheckout(cargoHome, revisionPrefix) {
  const checkoutRoot = path.join(cargoHome, "git/checkouts");
  for (const checkout of fs.readdirSync(checkoutRoot, { withFileTypes: true })) {
    if (!checkout.isDirectory() || !checkout.name.startsWith("rust-gpu-")) continue;
    const checkoutPath = path.join(checkoutRoot, checkout.name);
    for (const revision of fs.readdirSync(checkoutPath, { withFileTypes: true })) {
      if (!revision.isDirectory()) continue;
      const repo = path.join(checkoutPath, revision.name);
      try {
        const fullRevision = run("git", ["-C", repo, "rev-parse", "HEAD"]);
        if (fullRevision.startsWith(revisionPrefix)) return { repo, fullRevision };
      } catch {
        continue;
      }
    }
  }
  throw new Error(`Rust-GPU source revision ${revisionPrefix} is not present in ${checkoutRoot}`);
}

function createTempCargoHome(cargoHome, originalCargoHome) {
  fs.mkdirSync(cargoHome, { recursive: true });
  const linkIfMissing = (source, target, type = "file") => {
    try {
      fs.lstatSync(target);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      fs.symlinkSync(source, target, type);
    }
  };
  const registry = path.join(originalCargoHome, "registry");
  if (fs.existsSync(registry)) linkIfMissing(registry, path.join(cargoHome, "registry"), "dir");
  for (const name of ["config", "config.toml", "credentials", "credentials.toml"]) {
    const source = path.join(originalCargoHome, name);
    if (fs.existsSync(source)) linkIfMissing(source, path.join(cargoHome, name));
  }
  return cargoHome;
}

function copyShaderToTemp(tempRoot) {
  const tempShader = path.join(tempRoot, "shader");
  fs.cpSync(SHADER, tempShader, {
    recursive: true,
    filter: (source) => !source.split(path.sep).includes("target"),
  });
  const manifest = path.join(tempShader, "Cargo.toml");
  const oldManifest = fs.readFileSync(manifest, "utf8");
  const pathDependency = /pyac-vliw-core\s*=\s*\{\s*path\s*=\s*"([^"]+)"\s*\}/g;
  const matches = [...oldManifest.matchAll(pathDependency)];
  if (matches.length !== 1) throw new Error("expected one pyac-vliw-core path dependency in shader Cargo.toml");
  const corePath = path.resolve(SHADER, matches[0][1]);
  const newManifest = oldManifest.replace(pathDependency, `pyac-vliw-core = { path = ${JSON.stringify(corePath)} }`);
  fs.writeFileSync(manifest, newManifest);
  return tempShader;
}

function prepareInstrumentedCompiler(cacheRoot, checkout) {
  fs.mkdirSync(cacheRoot, { recursive: true });
  const source = path.join(cacheRoot, "rust-gpu-source");
  const marker = path.join(cacheRoot, "instrumentation-version.txt");
  const expectedMarker = `${checkout.fullRevision}:${INSTRUMENTATION_VERSION}`;
  if (fs.existsSync(marker) && fs.readFileSync(marker, "utf8") === expectedMarker && fs.existsSync(source)) {
    return { source, revision: run("git", ["rev-parse", "HEAD"], { cwd: source }), reused: true };
  }
  fs.rmSync(source, { recursive: true, force: true });
  const archive = path.join(cacheRoot, "rust-gpu.tar");
  fs.mkdirSync(source);
  run("git", ["-C", checkout.repo, "archive", "--format=tar", `--output=${archive}`, "HEAD"]);
  run("tar", ["-xf", archive, "-C", source]);
  fs.rmSync(archive);

  const inlinePath = path.join(source, "crates/rustc_codegen_spirv/src/linker/inline.rs");
  const original = fs.readFileSync(inlinePath, "utf8");
  fs.writeFileSync(inlinePath, instrumentInlineSource(original));
  run("git", ["init", "--quiet"], { cwd: source });
  run("git", ["config", "user.name", "Pyash inline profiler"], { cwd: source });
  run("git", ["config", "user.email", "inline-profiler@localhost"], { cwd: source });
  run("git", ["add", "-A"], { cwd: source });
  run("git", ["commit", "--quiet", "-m", "temporary inline profiler instrumentation"], {
    cwd: source,
    env: {
      ...process.env,
      GIT_AUTHOR_DATE: "2000-01-01T00:00:00Z",
      GIT_COMMITTER_DATE: "2000-01-01T00:00:00Z",
    },
  });
  fs.writeFileSync(marker, expectedMarker);
  return { source, revision: run("git", ["rev-parse", "HEAD"], { cwd: source }), reused: false };
}

function processTreeRss(rootPid) {
  let rows;
  try {
    rows = run("ps", ["-eo", "pid=,ppid=,rss="]).split("\n");
  } catch {
    return 0;
  }
  const parents = new Map();
  for (const row of rows) {
    const [pid, ppid, rss] = row.trim().split(/\s+/).map(Number);
    if (Number.isFinite(pid) && Number.isFinite(ppid) && Number.isFinite(rss)) parents.set(pid, { ppid, rss });
  }
  const descendants = new Set([rootPid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [pid, process] of parents) {
      if (!descendants.has(pid) && descendants.has(process.ppid)) {
        descendants.add(pid);
        changed = true;
      }
    }
  }
  return [...descendants].reduce((sum, pid) => sum + (parents.get(pid)?.rss || 0), 0) * 1024;
}

function sendSignal(child, signal) {
  if (!child.pid) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    try { child.kill(signal); } catch { /* the process already exited */ }
  }
}

async function runProfileBuild({ cargoGpu, args, env, logPath, collector }) {
  const child = spawn(cargoGpu, args, { cwd: ROOT, env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  const log = fs.createWriteStream(logPath, { flags: "wx" });
  let logBytes = 0;
  let omittedLogBytes = 0;
  let activeFunction = null;
  let phase = "starting compiler";
  let peakRssBytes = 0;
  let stopReason = null;
  const started = Date.now();
  let lastProgressAt = started;
  const childExit = new Promise((resolve) => child.once("close", (code, signal) => resolve({ code, signal })));
  const writeLine = (streamName, line) => {
    const record = `[${streamName}] ${line}\n`;
    collector.ingest(line);
    if (line.startsWith("PYASH_INLINE_START\t")) {
      const name = Buffer.from(line.split("\t")[1] || "", "hex").toString("utf8");
      activeFunction = name;
    } else if (line.startsWith("PYASH_INLINE_FN\t")) {
      activeFunction = null;
    } else if (line.includes("Compiling `rustc_codegen_spirv`")) {
      phase = "building instrumented Rust-GPU backend";
    } else if (line.includes("Compiling shaders at ")) {
      phase = "building Pyash WGSL shader";
    }
    const size = Buffer.byteLength(record);
    if (logBytes + size <= BUILD_LOG_LIMIT_BYTES) {
      log.write(record);
      logBytes += size;
    } else {
      omittedLogBytes += size;
    }
  };
  for (const [name, stream] of [["stdout", child.stdout], ["stderr", child.stderr]]) {
    readline.createInterface({ input: stream }).on("line", (line) => writeLine(name, line));
  }

  let exit = null;
  while (!exit) {
    exit = await Promise.race([childExit, new Promise((resolve) => setTimeout(() => resolve(null), SAMPLE_MS))]);
    if (exit) break;
    peakRssBytes = Math.max(peakRssBytes, processTreeRss(child.pid));
    if (Date.now() - started >= RUST_GPU_LIMIT_MS) stopReason = "15-minute wall-time limit";
    else if (peakRssBytes >= RSS_LIMIT_BYTES) stopReason = "8-GiB process-tree RSS limit";
    if (stopReason) {
      sendSignal(child, "SIGINT");
      exit = await Promise.race([childExit, new Promise((resolve) => setTimeout(() => resolve(null), 10_000))]);
      if (!exit) {
        sendSignal(child, "SIGKILL");
        exit = await childExit;
      }
      break;
    }
    if (Date.now() - lastProgressAt >= 15_000) {
      console.log(`[inline profiler] ${phase}${activeFunction ? `; inliner at ${activeFunction}` : ""}`);
      lastProgressAt = Date.now();
    }
  }
  log.end();
  await new Promise((resolve) => log.once("finish", resolve));
  peakRssBytes = Math.max(peakRssBytes, processTreeRss(child.pid));
  if (omittedLogBytes) fs.appendFileSync(logPath, `\n[diagnostic] omitted ${omittedLogBytes} bytes after ${BUILD_LOG_LIMIT_BYTES} bytes of build log\n`);
  return { ...exit, stopReason, peakRssBytes, elapsedMs: Date.now() - started, phase };
}

function compactRunId(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
}

async function main() {
  const diagnosticsRoot = path.join(ROOT, "rust/pyac-gpu/target/diagnostics");
  fs.mkdirSync(diagnosticsRoot, { recursive: true });
  const reportDir = path.join(diagnosticsRoot, compactRunId());
  fs.mkdirSync(reportDir);
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pyash-rustgpu-inline-"));
  const logPath = path.join(reportDir, "build.log");
  const collector = createInlineMetricCollector();
  try {
    const cargoGpu = findCargoGpu();
    const cargoGpuVersion = run(cargoGpu, ["--version"]);
    const revisionPrefix = cargoGpuVersion.match(/rev\s+([0-9a-f]{7,40})/i)?.[1];
    if (!revisionPrefix) throw new Error(`could not identify Rust-GPU source revision from: ${cargoGpuVersion}`);
    const originalCargoHome = process.env.CARGO_HOME || path.join(os.homedir(), ".cargo");
    const checkout = findRustGpuCheckout(originalCargoHome, revisionPrefix);
    const shaderSource = run(cargoGpu, ["show", "spirv-source", "--shader-crate", SHADER]);
    const compilerCache = path.join(diagnosticsRoot, "compiler-cache");
    const instrumented = prepareInstrumentedCompiler(compilerCache, checkout);
    const tempShader = copyShaderToTemp(tempRoot);
    const preInline = path.join(tempRoot, "pre-inline");
    fs.mkdirSync(preInline);
    const tempCargoHome = createTempCargoHome(path.join(compilerCache, "cargo-home"), originalCargoHome);
    const tempCache = path.join(compilerCache, "xdg-cache");
    fs.mkdirSync(tempCache, { recursive: true });
    const outputDir = path.join(tempRoot, "shader-output");
    const args = [
      "build",
      "--auto-install-rust-toolchain",
      "--shader-crate", tempShader,
      "--target", "spirv-unknown-naga-wgsl",
      "--debug",
      "--output-dir", outputDir,
      "--spirv-builder-source", pathToFileURL(instrumented.source).href,
      "--spirv-builder-version", instrumented.revision,
    ];
    const env = {
      ...process.env,
      CARGO_HOME: tempCargoHome,
      RUSTUP_HOME: process.env.RUSTUP_HOME || path.join(os.homedir(), ".rustup"),
      XDG_CACHE_HOME: tempCache,
      RUSTGPU_RUSTFLAGS: "-Ztime-passes",
      RUSTGPU_CODEGEN_ARGS: `--no-spirv-opt --dump-pre-inline=${preInline}`,
    };
    console.log(`[inline profiler] Rust-GPU ${revisionPrefix}; shader dependency ${shaderSource}; compiler cache ${instrumented.reused ? "reused" : "built"}`);
    console.log(`[inline profiler] report directory: ${reportDir}`);
    const result = await runProfileBuild({ cargoGpu, args, env, logPath, collector });
    const metrics = collector.snapshot();
    const spirtFile = fs.readdirSync(preInline).find((name) => name.endsWith(".spirt"));
    const sourceLocations = spirtFile
      ? parseSpirtLocations(fs.readFileSync(path.join(preInline, spirtFile), "utf8"))
      : new Map();
    const stopReason = result.stopReason || (result.code === 0 ? "completed" : `cargo-gpu exited ${result.code ?? result.signal}`);
    const report = renderInlineReport({
      metrics,
      sourceLocations,
      build: result.code === 0 ? "completed" : "incomplete",
      peakRssBytes: result.peakRssBytes,
      stopReason,
    });
    fs.writeFileSync(path.join(reportDir, "report.md"), report);
    fs.writeFileSync(path.join(reportDir, "report.json"), JSON.stringify({
      cargoGpuVersion,
      cargoGpuSourceRevision: checkout.fullRevision,
      instrumentedCompilerRevision: instrumented.revision,
      instrumentedCompilerReused: instrumented.reused,
      shaderRustGpuSource: shaderSource,
      target: "spirv-unknown-naga-wgsl",
      elapsedMs: result.elapsedMs,
      phaseAtStop: result.phase,
      exitCode: result.code,
      signal: result.signal,
      stopReason,
      peakRssBytes: result.peakRssBytes,
      metrics,
      sourceLocations: Object.fromEntries(sourceLocations),
    }, null, 2));
    console.log(report);
    console.log(`\nReport: ${path.join(reportDir, "report.md")}`);
    console.log(`Build log: ${logPath}`);
    if (result.code !== 0 && !result.stopReason) process.exitCode = 1;
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`rust-gpu inline diagnostic failed: ${error.stack || error.message}`);
  process.exitCode = 1;
});
