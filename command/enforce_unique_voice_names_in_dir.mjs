#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

function usage() {
  return [
    "Usage: node command/enforce_unique_voice_names_in_dir.mjs [voices_dir]",
    "Example: node command/enforce_unique_voice_names_in_dir.mjs world/voices",
  ].join("\n");
}

function ensureDir(dirPath) {
  const st = fs.statSync(dirPath, { throwIfNoEntry: false });
  if (!st || !st.isDirectory()) throw new Error(`voices directory not found: ${dirPath}`);
}

function readName(metaPath) {
  const src = fs.readFileSync(metaPath, "utf8");
  const m = src.match(/^\s*su name name ob text "(.*)" ya\s*$/mu);
  return String(m?.[1] || "").trim();
}

function writeName(metaPath, newName) {
  const src = fs.readFileSync(metaPath, "utf8");
  const line = `su name name ob text "${String(newName).replace(/"/g, '\\"')}" ya`;
  if (/^\s*su name name ob text ".*" ya\s*$/mu.test(src)) {
    const out = src.replace(/^\s*su name name ob text ".*" ya\s*$/mu, line);
    fs.writeFileSync(metaPath, out.endsWith("\n") ? out : `${out}\n`, "utf8");
    return;
  }
  fs.writeFileSync(metaPath, `${src.trimEnd()}\n${line}\n`, "utf8");
}

function keyRank(key) {
  if (!/^speaker_\d+$/iu.test(key)) return 0;
  const m = key.match(/^speaker_(\d+)$/iu);
  const n = Number(m?.[1] || 0);
  return 10_000 + (Number.isFinite(n) ? n : 0);
}

function reserveUnique(base, key, usedByName) {
  let candidate = base;
  let suffix = 1;
  while (true) {
    const keys = usedByName.get(candidate);
    const usedByOther = Boolean(keys && [...keys].some((k) => k !== key));
    if (!usedByOther) return { name: candidate, suffix };
    suffix += 1;
    candidate = `${base}_${suffix}`;
  }
}

function main() {
  const voicesArg = process.argv[2] || "world/voices";
  if (String(voicesArg).trim() === "-h" || String(voicesArg).trim() === "--help") {
    process.stdout.write(`${usage()}\n`);
    process.exit(0);
  }

  const voicesDir = path.resolve(process.cwd(), voicesArg);
  ensureDir(voicesDir);

  const keys = fs.readdirSync(voicesDir)
    .filter((n) => n.endsWith(".pya") && n !== "index.pya")
    .map((n) => n.replace(/\.pya$/u, ""))
    .sort((a, b) => keyRank(a) - keyRank(b) || a.localeCompare(b));

  const byKey = new Map();
  const usedByName = new Map();
  for (const key of keys) {
    const metaPath = path.join(voicesDir, `${key}.pya`);
    const name = readName(metaPath);
    if (!name) continue;
    byKey.set(key, name);
    if (!usedByName.has(name)) usedByName.set(name, new Set());
    usedByName.get(name).add(key);
  }

  const changes = [];
  for (const key of keys) {
    const oldName = byKey.get(key);
    if (!oldName) continue;
    const unique = reserveUnique(oldName, key, usedByName);
    if (unique.name === oldName) continue;

    const oldBag = usedByName.get(oldName);
    if (oldBag) {
      oldBag.delete(key);
      if (!oldBag.size) usedByName.delete(oldName);
    }
    if (!usedByName.has(unique.name)) usedByName.set(unique.name, new Set());
    usedByName.get(unique.name).add(key);
    byKey.set(key, unique.name);

    writeName(path.join(voicesDir, `${key}.pya`), unique.name);
    changes.push({ key, from: oldName, to: unique.name });
  }

  process.stdout.write(`[voices-unique] dir: ${voicesDir}\n`);
  process.stdout.write(`[voices-unique] keys: ${keys.length}\n`);
  process.stdout.write(`[voices-unique] changed: ${changes.length}\n`);
  for (const c of changes) {
    process.stdout.write(`[voices-unique] ${c.key}: ${c.from} -> ${c.to}\n`);
  }
}

try {
  main();
} catch (err) {
  process.stderr.write(`${String(err?.stack || err?.message || err)}\n`);
  process.exit(1);
}

