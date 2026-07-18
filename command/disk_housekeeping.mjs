#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readPyaTextValues } from "./pya_lookup.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const POLICY_KEYS = [
  "disk housekeeping enabled",
  "disk housekeeping roots",
  "disk housekeeping video max age days",
  "disk housekeeping part max age days",
  "disk housekeeping fresh cache max bytes",
  "disk warning free gb",
  "disk minimum free gb",
  "disk download preflight enabled",
];

function usage() {
  return [
    "Usage: node command/disk_housekeeping.mjs [--pre-download] [--required-bytes <n>] [--mount <path>] [--json]",
    "",
    "Policy is inactive unless configure/policy.pya or configure/secret.pya explicitly sets:",
    '  su name disk housekeeping enabled ob text "true" ya',
    '  su name disk housekeeping roots ob text "/home/htaf/pyash/artifacts:/home/htaf/pyash/world/house/owen-sound-reporter/artifacts" ya',
    '  su name disk warning free gb ob text "10" ya',
    '  su name disk minimum free gb ob text "10" ya',
  ].join("\n");
}

function parseArgs(argv) {
  const out = { preDownload: false, requiredBytes: 0, mount: os.homedir(), json: false };
  const args = [...argv];
  while (args.length) {
    const a = args.shift();
    if (a === "--pre-download") out.preDownload = true;
    else if (a === "--required-bytes") out.requiredBytes = Number(args.shift() || 0);
    else if (a === "--mount") out.mount = path.resolve(String(args.shift() || os.homedir()));
    else if (a === "--json") out.json = true;
    else if (a === "--help" || a === "-h") {
      process.stdout.write(`${usage()}\n`);
      process.exit(0);
    } else {
      throw new Error(`unknown arg: ${a}`);
    }
  }
  return out;
}

function configPaths() {
  const cwd = process.cwd();
  const candidates = [
    path.join(cwd, "configure/policy.pya"),
    path.join(cwd, "configure/secret.pya"),
    path.join(ROOT, "configure/policy.pya"),
    path.join(ROOT, "configure/secret.pya"),
  ];
  return [...new Set(candidates.map((p) => path.normalize(p)))];
}

function readPolicy() {
  const merged = Object.create(null);
  for (const key of POLICY_KEYS) merged[key] = "";
  const loaded = [];
  for (const filePath of configPaths()) {
    if (!fs.existsSync(filePath)) continue;
    const vals = readPyaTextValues(filePath, POLICY_KEYS);
    let used = false;
    for (const key of POLICY_KEYS) {
      const value = String(vals[key] || "").trim();
      if (!value) continue;
      merged[key] = value;
      used = true;
    }
    if (used) loaded.push(filePath);
  }
  return { values: merged, loaded };
}

function parseBool(value) {
  const s = String(value || "").trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(s)) return true;
  if (["0", "false", "no", "off"].includes(s)) return false;
  return null;
}

function parseNumber(value) {
  const n = Number(String(value || "").trim());
  return Number.isFinite(n) ? n : null;
}

function parseRoots(value) {
  return String(value || "")
    .split(/[:\n,]/u)
    .map((p) => path.resolve(p.trim()))
    .filter((p) => p && p.startsWith(os.homedir()) && fs.existsSync(p));
}

function loadPolicy() {
  const { values, loaded } = readPolicy();
  const enabled = parseBool(values["disk housekeeping enabled"]);
  const preDownloadEnabled = parseBool(values["disk download preflight enabled"]);
  const roots = parseRoots(values["disk housekeeping roots"]);
  const videoMaxAgeDays = parseNumber(values["disk housekeeping video max age days"]);
  const partMaxAgeDays = parseNumber(values["disk housekeeping part max age days"]);
  const freshCacheMaxBytes = parseNumber(values["disk housekeeping fresh cache max bytes"]);
  const warningFreeGb = parseNumber(values["disk warning free gb"]);
  const minimumFreeGb = parseNumber(values["disk minimum free gb"]);

  return {
    active: enabled === true,
    preDownloadActive: preDownloadEnabled === true,
    loaded,
    roots,
    videoMaxAgeDays: videoMaxAgeDays !== null && videoMaxAgeDays >= 0 ? videoMaxAgeDays : null,
    partMaxAgeDays: partMaxAgeDays !== null && partMaxAgeDays >= 0 ? partMaxAgeDays : null,
    freshCacheMaxBytes: freshCacheMaxBytes !== null && freshCacheMaxBytes >= 0 ? freshCacheMaxBytes : null,
    warningFreeGb: warningFreeGb !== null && warningFreeGb >= 0 ? warningFreeGb : null,
    minimumFreeGb: minimumFreeGb !== null && minimumFreeGb >= 0 ? minimumFreeGb : null,
  };
}

function diskFreeBytes(mountPath) {
  const res = spawnSync("df", ["-Pk", mountPath], { encoding: "utf8" });
  if (res.status !== 0) throw new Error(`df failed: ${String(res.stderr || "").trim()}`);
  const lines = String(res.stdout || "").trim().split(/\r?\n/u);
  const cols = String(lines.at(-1) || "").trim().split(/\s+/u);
  const availableKb = Number(cols[3]);
  if (!Number.isFinite(availableKb)) throw new Error(`cannot parse df output: ${res.stdout}`);
  return availableKb * 1024;
}

function cutoffMs(days) {
  return Date.now() - Math.floor(days * 24 * 60 * 60 * 1000);
}

function walkFiles(root, visit) {
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(p);
      else if (entry.isFile()) visit(p);
    }
  }
}

function removeFile(filePath) {
  try {
    const st = fs.statSync(filePath);
    fs.unlinkSync(filePath);
    return Number(st.size || 0);
  } catch {
    return 0;
  }
}

function cleanupFiles({ roots, regex, maxAgeDays }) {
  if (maxAgeDays === null) return { count: 0, bytes: 0 };
  const cutoff = cutoffMs(maxAgeDays);
  let count = 0;
  let bytes = 0;
  for (const root of roots) {
    walkFiles(root, (filePath) => {
      if (!regex.test(path.basename(filePath))) return;
      let st = null;
      try {
        st = fs.statSync(filePath);
      } catch {
        return;
      }
      if (Number(st.mtimeMs || 0) > cutoff) return;
      const removed = removeFile(filePath);
      if (removed > 0) {
        count += 1;
        bytes += removed;
      }
    });
  }
  return { count, bytes };
}

function cleanupFreshCache(maxBytes) {
  if (maxBytes === null) return { ran: false };
  const res = spawnSync("node", [
    path.join(ROOT, "command/cleanup-library-fresh-cache.mjs"),
    "--max-age-days", "30",
    "--max-bytes", String(Math.floor(maxBytes)),
  ], { cwd: ROOT, encoding: "utf8" });
  return {
    ran: true,
    status: res.status,
    stdout: String(res.stdout || "").trim(),
    stderr: String(res.stderr || "").trim(),
  };
}

function formatGb(bytes) {
  return (bytes / 1024 / 1024 / 1024).toFixed(2);
}

function runHousekeeping({ policy, mount }) {
  const beforeFree = diskFreeBytes(mount);
  const video = cleanupFiles({
    roots: policy.roots,
    regex: /\.(mp4|webm|mkv|mov)$/iu,
    maxAgeDays: policy.videoMaxAgeDays,
  });
  const partial = cleanupFiles({
    roots: policy.roots,
    regex: /\.(part|tmp)$/iu,
    maxAgeDays: policy.partMaxAgeDays,
  });
  const fresh = cleanupFreshCache(policy.freshCacheMaxBytes);
  const afterFree = diskFreeBytes(mount);
  return { beforeFree, afterFree, video, partial, fresh };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const policy = loadPolicy();
  const requiredBytes = Math.max(0, Number(args.requiredBytes || 0));
  const shouldRun = policy.active && (!args.preDownload || policy.preDownloadActive);

  let result = {
    active: shouldRun,
    policy_loaded: policy.loaded,
    roots: policy.roots,
    cleanup: null,
    free_bytes: diskFreeBytes(args.mount),
    warning: "",
  };

  if (shouldRun) {
    result.cleanup = runHousekeeping({ policy, mount: args.mount });
    result.free_bytes = result.cleanup.afterFree;
  }

  if (policy.warningFreeGb !== null && result.free_bytes < policy.warningFreeGb * 1024 * 1024 * 1024) {
    result.warning = `low disk space: free=${formatGb(result.free_bytes)}GiB threshold=${policy.warningFreeGb}GiB`;
    process.stderr.write(`[disk-housekeeping] warning ${result.warning}\n`);
  }

  const requiredFree = policy.minimumFreeGb !== null
    ? (policy.minimumFreeGb * 1024 * 1024 * 1024) + requiredBytes
    : 0;
  if (args.preDownload && policy.preDownloadActive && requiredFree > 0 && result.free_bytes < requiredFree) {
    const msg = `insufficient disk before download: free=${formatGb(result.free_bytes)}GiB required=${formatGb(requiredFree)}GiB`;
    if (args.json) process.stdout.write(`${JSON.stringify({ ...result, error: msg }, null, 2)}\n`);
    throw new Error(msg);
  }

  if (args.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    const cleanup = result.cleanup;
    process.stdout.write(
      `[disk-housekeeping] active=${result.active ? "yes" : "no"} free=${formatGb(result.free_bytes)}GiB`
      + (cleanup ? ` video_deleted=${cleanup.video.count}/${cleanup.video.bytes} partial_deleted=${cleanup.partial.count}/${cleanup.partial.bytes}` : "")
      + "\n",
    );
  }
}

try {
  main();
} catch (err) {
  process.stderr.write(`[disk-housekeeping] error ${String(err?.message || err)}\n`);
  process.exit(1);
}
