#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PYASH_ROOT = path.resolve(HERE, "..");
const DEFAULT_DIR = path.join(PYASH_ROOT, "world", "library", "fresh");

function usage() {
  return [
    "Usage: node command/cleanup-library-fresh-cache.mjs [options]",
    "",
    "Options:",
    "  --dir <path>          cache directory (default: world/library/fresh)",
    "  --max-age-days <n>    delete files older than n days (default: 30)",
    "  --max-bytes <n>       cap total size to n bytes via oldest-first prune (default: 10737418240)",
    "  --help                show this help",
  ].join("\n");
}

function parseArgs(argv) {
  const out = {
    dir: DEFAULT_DIR,
    maxAgeDays: 30,
    maxBytes: 10 * 1024 * 1024 * 1024,
  };
  const args = [...argv];
  while (args.length) {
    const a = args.shift();
    if (a === "--dir") out.dir = path.resolve(String(args.shift() || "").trim());
    else if (a === "--max-age-days") out.maxAgeDays = Number(args.shift() || out.maxAgeDays);
    else if (a === "--max-bytes") out.maxBytes = Number(args.shift() || out.maxBytes);
    else if (a === "--help" || a === "-h") {
      process.stdout.write(`${usage()}\n`);
      process.exit(0);
    } else {
      throw new Error(`unknown arg: ${a}`);
    }
  }
  if (!Number.isFinite(out.maxAgeDays) || out.maxAgeDays < 0) throw new Error("--max-age-days must be >= 0");
  if (!Number.isFinite(out.maxBytes) || out.maxBytes < 0) throw new Error("--max-bytes must be >= 0");
  return out;
}

function listFiles(dirPath) {
  if (!fs.existsSync(dirPath)) return [];
  return fs.readdirSync(dirPath)
    .map((name) => path.join(dirPath, name))
    .filter((p) => {
      try {
        return fs.statSync(p).isFile();
      } catch {
        return false;
      }
    })
    .map((p) => {
      const st = fs.statSync(p);
      return {
        path: p,
        size: Number(st.size || 0),
        mtimeMs: Number(st.mtimeMs || 0),
      };
    });
}

function sumBytes(rows) {
  let total = 0;
  for (const r of rows) total += Number(r.size || 0);
  return total;
}

function removeFile(filePath) {
  try {
    fs.unlinkSync(filePath);
    return true;
  } catch {
    return false;
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(args.dir)) {
    process.stdout.write(`[fresh-cache] skip: directory not found (${args.dir})\n`);
    return;
  }

  const before = listFiles(args.dir);
  const beforeBytes = sumBytes(before);
  const nowMs = Date.now();
  const maxAgeMs = Math.floor(args.maxAgeDays * 24 * 60 * 60 * 1000);
  const cutoff = nowMs - maxAgeMs;

  let deletedByAgeCount = 0;
  let deletedByAgeBytes = 0;
  for (const row of before) {
    if (maxAgeMs <= 0 || row.mtimeMs < cutoff) {
      if (removeFile(row.path)) {
        deletedByAgeCount += 1;
        deletedByAgeBytes += row.size;
      }
    }
  }

  let remaining = listFiles(args.dir);
  let total = sumBytes(remaining);
  let deletedBySizeCount = 0;
  let deletedBySizeBytes = 0;
  if (total > args.maxBytes) {
    remaining.sort((a, b) => a.mtimeMs - b.mtimeMs);
    for (const row of remaining) {
      if (total <= args.maxBytes) break;
      if (removeFile(row.path)) {
        total -= row.size;
        deletedBySizeCount += 1;
        deletedBySizeBytes += row.size;
      }
    }
  }

  const after = listFiles(args.dir);
  const afterBytes = sumBytes(after);
  process.stdout.write(
    `[fresh-cache] dir=${args.dir} files_before=${before.length} bytes_before=${beforeBytes} files_after=${after.length} bytes_after=${afterBytes} deleted_age=${deletedByAgeCount}/${deletedByAgeBytes} deleted_size=${deletedBySizeCount}/${deletedBySizeBytes} max_age_days=${args.maxAgeDays} max_bytes=${args.maxBytes}\n`,
  );
}

main();
