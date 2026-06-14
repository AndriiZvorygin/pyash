#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

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
  if (fs.existsSync(outFile)) {
    const stat = fs.statSync(outFile);
    if (stat.size > 0) {
      process.stdout.write(`[resumable-download] exists: ${outFile} bytes=${stat.size}\n`);
      return;
    }
  }
  const partFile = `${outFile}.part`;

  for (let i = 1; i <= attempts; i += 1) {
    try {
      await runCurl([
        "-fL",
        "--no-progress-meter",
        "--show-error",
        "--retry", "6",
        "--retry-all-errors",
        "--retry-delay", "2",
        "--connect-timeout", "20",
        "--speed-time", "60",
        "--speed-limit", "10240",
        "-C", "-",
        "-o", partFile,
        url,
      ]);
      fs.renameSync(partFile, outFile);
      process.stdout.write(`[resumable-download] ok: ${outFile}\n`);
      return;
    } catch (err) {
      process.stderr.write(`[resumable-download] attempt ${i}/${attempts} failed: ${String(err?.message || err)}\n`);
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
