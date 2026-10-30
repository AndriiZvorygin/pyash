#!/usr/bin/env node

import { spawnSync } from "node:child_process";

const MAX_TARBALL_BYTES = 50 * 1024 * 1024;

const res = spawnSync("npm", ["pack", "--dry-run", "--json"], {
  encoding: "utf8",
  maxBuffer: 32 * 1024 * 1024
});
if (res.status !== 0) {
  console.error(res.stderr ?? "npm pack --dry-run failed");
  process.exit(1);
}

let entries;
try {
  entries = JSON.parse(res.stdout);
} catch {
  console.error("could not parse npm pack --dry-run output as JSON");
  process.exit(1);
}
const entry = Array.isArray(entries) ? entries[0] : entries;
if (!entry || typeof entry.size !== "number") {
  console.error("npm pack --dry-run output has no tarball size");
  process.exit(1);
}

const megabytes = entry.size / (1024 * 1024);
const unpacked = typeof entry.unpackedSize === "number" ? entry.unpackedSize / (1024 * 1024) : null;
console.log(`package tarball: ${megabytes.toFixed(1)}MB${unpacked !== null ? ` (unpacked ${unpacked.toFixed(1)}MB, ${entry.entryCount ?? "?"} files)` : ""}`);
if (entry.size > MAX_TARBALL_BYTES) {
  console.error(`package tarball exceeds the ${MAX_TARBALL_BYTES / (1024 * 1024)}MB guard`);
  process.exit(1);
}
