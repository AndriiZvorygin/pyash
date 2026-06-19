#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function usage() {
  return "Usage: node command/resumable_download.mjs <url> <output_file> [attempts]";
}

function runCurl(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("curl", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stdout.on("data", (c) => process.stdout.write(String(c ?? "")));
    child.stderr.on("data", (c) => {
      const t = String(c ?? "");
      stderr += t;
      process.stderr.write(t);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) return resolve();
      reject(new Error(`curl failed (${code}): ${stderr.trim()}`));
    });
  });
}

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

function remoteContentLength(url) {
  const res = spawnSync("curl", [
    "-fsSIL",
    "--max-time", "30",
    "--connect-timeout", "15",
    url,
  ], { encoding: "utf8" });
  if (res.status !== 0) return 0;
  const matches = [...String(res.stdout || "").matchAll(/^content-length:\s*(\d+)\s*$/gimu)];
  const last = matches.at(-1);
  const n = Number(last?.[1] || 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function runDiskPreflight({ outFile, outDir, url }) {
  const existingBytes = fs.statSync(outFile, { throwIfNoEntry: false })?.size || 0;
  const remoteBytes = remoteContentLength(url);
  const requiredBytes = remoteBytes > existingBytes ? remoteBytes - existingBytes : 0;
  const res = spawnSync("node", [
    path.join(ROOT, "command/disk_housekeeping.mjs"),
    "--pre-download",
    "--required-bytes", String(requiredBytes),
    "--mount", outDir,
  ], { cwd: ROOT, encoding: "utf8" });
  if (res.stdout) process.stdout.write(res.stdout);
  if (res.stderr) process.stderr.write(res.stderr);
  if (res.status !== 0) {
    throw new Error(`disk preflight failed before download: ${String(res.stderr || res.stdout || "").trim()}`);
  }
}

async function main() {
  const url = String(process.argv[2] || "").trim();
  const outFile = String(process.argv[3] || "").trim();
  const attempts = Math.max(1, Number.parseInt(String(process.argv[4] || "5"), 10) || 5);
  if (!url || !outFile) {
    process.stderr.write(`${usage()}\n`);
    process.exit(2);
  }
  const outDir = path.dirname(outFile);
  fs.mkdirSync(outDir, { recursive: true });
  runDiskPreflight({ outFile, outDir, url });
  for (let i = 1; i <= attempts; i += 1) {
    try {
      const existingBytes = fs.statSync(outFile, { throwIfNoEntry: false })?.size || 0;
      if (existingBytes > 0) {
        process.stdout.write(`[resumable-download] resume: ${outFile} bytes=${existingBytes}\n`);
      }
      await runCurl([
        "-fL",
        "--no-progress-meter",
        "--show-error",
        "--retry", "6",
        "--retry-all-errors",
        "--retry-connrefused",
        "--retry-delay", "2",
        "--connect-timeout", "20",
        "--speed-time", "60",
        "--speed-limit", "10240",
        "-C", "-",
        "-o", outFile,
        url,
      ]);
      process.stdout.write(`[resumable-download] ok: ${outFile}\n`);
      return;
    } catch (err) {
      const message = String(err?.message || err);
      process.stderr.write(`[resumable-download] attempt ${i}/${attempts} failed: ${message}\n`);
      if (/cannot resume|doesn.t seem to support byte ranges|http server doesn.t seem to support byte ranges/iu.test(message)) {
        try {
          fs.unlinkSync(outFile);
          process.stderr.write(`[resumable-download] removed non-resumable partial: ${outFile}\n`);
        } catch {}
      }
      if (i >= attempts) {
        process.stderr.write(`[resumable-download] giving up: ${url}\n`);
        process.exit(29);
      }
      await sleep(i * 4000);
    }
  }
}

main().catch((err) => {
  process.stderr.write(`${String(err?.stack || err?.message || err)}\n`);
  process.exit(29);
});
