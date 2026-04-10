#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

function usage() {
  return [
    "Usage: node command/dedupe_voice_names.mjs [voices_dir] [--apply]",
    "Default voices_dir: /home/htaf/pyash/world/voices",
    "Default mode: dry-run (prints planned changes only).",
    "Use --apply to write updates.",
  ].join("\n");
}

function parseArgs(argv) {
  const out = {
    voicesDir: "/home/htaf/pyash/world/voices",
    apply: false,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const a = String(argv[i] || "").trim();
    if (!a) continue;
    if (a === "--help" || a === "-h") {
      process.stdout.write(`${usage()}\n`);
      process.exit(0);
    }
    if (a === "--apply") {
      out.apply = true;
      continue;
    }
    if (a.startsWith("-")) {
      throw new Error(`unknown arg: ${a}`);
    }
    out.voicesDir = path.resolve(process.cwd(), a);
  }
  return out;
}

function readMetaName(metaPath) {
  const src = fs.readFileSync(metaPath, "utf8");
  const m = src.match(/^\s*su name name ob text "(.*)" ya\s*$/mu);
  return String(m?.[1] || "").trim();
}

function setMetaName(metaPath, newName) {
  const src = fs.readFileSync(metaPath, "utf8");
  const line = `su name name ob text "${newName}" ya`;
  if (/^\s*su name name ob text ".*" ya\s*$/mu.test(src)) {
    const out = src.replace(/^\s*su name name ob text ".*" ya\s*$/mu, line);
    fs.writeFileSync(metaPath, out.endsWith("\n") ? out : `${out}\n`, "utf8");
    return;
  }
  fs.writeFileSync(metaPath, `${src.trimEnd()}\n${line}\n`, "utf8");
}

function isStableName(name) {
  const raw = String(name || "").trim();
  if (!raw) return false;
  return !/^speaker_\d+$/iu.test(raw);
}

function splitSuffix(name) {
  const raw = String(name || "").trim();
  const m = raw.match(/^(.*)_(\d+)$/u);
  if (!m) return { base: raw, num: null };
  return { base: String(m[1] || "").trim(), num: Number(m[2]) };
}

function numericSpeakerSort(a, b) {
  const ai = Number(String(a || "").replace(/^speaker_/u, ""));
  const bi = Number(String(b || "").replace(/^speaker_/u, ""));
  return ai - bi;
}

function main() {
  const { voicesDir, apply } = parseArgs(process.argv);
  const st = fs.statSync(voicesDir, { throwIfNoEntry: false });
  if (!st || !st.isDirectory()) {
    throw new Error(`voices dir not found: ${voicesDir}`);
  }

  const speakerKeys = fs.readdirSync(voicesDir)
    .filter((n) => /^speaker_\d+\.pya$/iu.test(n))
    .map((n) => n.replace(/\.pya$/u, ""))
    .sort(numericSpeakerSort);

  const rows = speakerKeys.map((key) => {
    const metaPath = path.join(voicesDir, `${key}.pya`);
    const name = readMetaName(metaPath);
    return { key, metaPath, name };
  });

  const used = new Set();
  const plans = [];
  const keptLeaderByBase = new Set();

  for (const row of rows) {
    const current = String(row.name || "").trim();
    if (!isStableName(current)) continue;
    const { base } = splitSuffix(current);
    if (!base) continue;

    if (!keptLeaderByBase.has(base) && current === base && !used.has(base)) {
      used.add(base);
      keptLeaderByBase.add(base);
      continue;
    }
    if (!used.has(current)) {
      used.add(current);
      if (!keptLeaderByBase.has(base) && current === base) keptLeaderByBase.add(base);
      continue;
    }

    let n = 2;
    let next = `${base}_${n}`;
    while (used.has(next)) {
      n += 1;
      next = `${base}_${n}`;
    }
    used.add(next);
    plans.push({
      key: row.key,
      from: current,
      to: next,
      metaPath: row.metaPath,
    });
  }

  process.stdout.write(`[voice-dedupe] voices dir: ${voicesDir}\n`);
  process.stdout.write(`[voice-dedupe] mode: ${apply ? "apply" : "dry-run"}\n`);
  process.stdout.write(`[voice-dedupe] checked: ${rows.length}\n`);
  process.stdout.write(`[voice-dedupe] duplicates to rename: ${plans.length}\n`);

  for (const p of plans) {
    process.stdout.write(`[voice-dedupe] ${p.key}: ${p.from} -> ${p.to}\n`);
    if (apply) setMetaName(p.metaPath, p.to);
  }

  if (apply) {
    process.stdout.write("[voice-dedupe] done\n");
  }
}

try {
  main();
} catch (err) {
  process.stderr.write(`${String(err?.stack || err?.message || err)}\n`);
  process.exit(1);
}

