#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { cosine, listSpeakerNpy, loadDisplayName, parseNpyVector } from "./voice_similarity_report.mjs";

const DEFAULT_THRESHOLD = 0.8;

function usage() {
  return [
    "Usage: node command/auto_merge_high_similarity_voices.mjs [voices_dir] [--threshold 0.8] [--apply] [--keep-source]",
    "Example: node command/auto_merge_high_similarity_voices.mjs world/voices --threshold 0.8 --apply",
    "Behavior:",
    "- Finds connected groups of speakers with cosine similarity >= threshold.",
    "- Picks one canonical target per group and merges others into it.",
    "- Dry-run by default; use --apply to execute merges.",
  ].join("\n");
}

function parseArgs(argv) {
  const out = {
    voicesDir: "world/voices",
    threshold: DEFAULT_THRESHOLD,
    apply: false,
    keepSource: false,
  };
  const args = [...argv];
  if (args.length > 0 && !args[0].startsWith("--")) out.voicesDir = args.shift();
  while (args.length > 0) {
    const arg = String(args.shift() || "").trim();
    if (!arg) continue;
    if (arg === "--help" || arg === "-h") {
      out.help = true;
      continue;
    }
    if (arg === "--threshold") {
      out.threshold = Number(args.shift() ?? "");
      continue;
    }
    if (arg === "--apply") {
      out.apply = true;
      continue;
    }
    if (arg === "--keep-source") {
      out.keepSource = true;
      continue;
    }
    throw new Error(`unknown arg: ${arg}\n${usage()}`);
  }
  if (!Number.isFinite(out.threshold) || out.threshold < -1 || out.threshold > 1) {
    throw new Error(`invalid --threshold: ${out.threshold}`);
  }
  return out;
}

function parseSpeakerId(key) {
  const m = String(key || "").match(/^speaker_(\d+)$/iu);
  if (!m) return Number.POSITIVE_INFINITY;
  return Number(m[1]);
}

function readSampleCount(voicesDir, key) {
  const pya = path.join(voicesDir, `${key}.pya`);
  if (!fs.existsSync(pya)) return 0;
  const src = fs.readFileSync(pya, "utf8");
  const m = src.match(/^\s*su name sample_count ob num ([0-9]+(?:\.[0-9]+)?) ya\s*$/mu);
  const n = Number(m?.[1] || 0);
  return Number.isFinite(n) ? n : 0;
}

function looksNamed(display) {
  const s = String(display || "").trim();
  if (!s) return false;
  return !/^speaker_\d+$/iu.test(s);
}

function chooseCanonical(component) {
  const sorted = [...component].sort((a, b) => {
    const aNamed = looksNamed(a.display) ? 1 : 0;
    const bNamed = looksNamed(b.display) ? 1 : 0;
    if (aNamed !== bNamed) return bNamed - aNamed;
    if (a.sampleCount !== b.sampleCount) return b.sampleCount - a.sampleCount;
    return parseSpeakerId(a.key) - parseSpeakerId(b.key);
  });
  return sorted[0];
}

function buildPairs(vectors, threshold) {
  const out = [];
  for (let i = 0; i < vectors.length; i += 1) {
    for (let j = i + 1; j < vectors.length; j += 1) {
      const sim = cosine(vectors[i].vec, vectors[j].vec);
      if (!Number.isFinite(sim) || sim < threshold) continue;
      out.push({ a: vectors[i].key, b: vectors[j].key, sim });
    }
  }
  return out;
}

function buildComponents(keys, pairs) {
  const adj = new Map();
  for (const key of keys) adj.set(key, new Set());
  for (const pair of pairs) {
    adj.get(pair.a)?.add(pair.b);
    adj.get(pair.b)?.add(pair.a);
  }
  const seen = new Set();
  const components = [];
  for (const key of keys) {
    if (seen.has(key)) continue;
    const q = [key];
    const comp = [];
    seen.add(key);
    while (q.length > 0) {
      const cur = q.shift();
      comp.push(cur);
      for (const next of adj.get(cur) || []) {
        if (seen.has(next)) continue;
        seen.add(next);
        q.push(next);
      }
    }
    if (comp.length > 1) components.push(comp);
  }
  return components;
}

export { parseArgs, chooseCanonical, buildPairs, buildComponents };

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const voicesDir = path.resolve(process.cwd(), opts.voicesDir);
  const st = fs.statSync(voicesDir, { throwIfNoEntry: false });
  if (!st || !st.isDirectory()) throw new Error(`voices dir not found: ${voicesDir}`);

  const entries = listSpeakerNpy(voicesDir);
  const vectors = [];
  for (const entry of entries) {
    try {
      vectors.push({
        key: entry.key,
        vec: parseNpyVector(entry.npy),
        display: loadDisplayName(voicesDir, entry.key),
        sampleCount: readSampleCount(voicesDir, entry.key),
      });
    } catch (error) {
      process.stderr.write(`[voice-merge-auto] skip ${entry.key}: ${error?.message || String(error)}\n`);
    }
  }

  const pairs = buildPairs(vectors, opts.threshold);
  const components = buildComponents(vectors.map((v) => v.key), pairs);
  process.stdout.write(`[voice-merge-auto] voices=${vectors.length} threshold=${opts.threshold.toFixed(3)} groups=${components.length} mode=${opts.apply ? "apply" : "dry-run"}\n`);

  const byKey = new Map(vectors.map((v) => [v.key, v]));
  let planned = 0;
  for (const comp of components) {
    const detailed = comp.map((k) => byKey.get(k)).filter(Boolean);
    const target = chooseCanonical(detailed);
    const members = detailed
      .filter((x) => x.key !== target.key)
      .sort((a, b) => parseSpeakerId(a.key) - parseSpeakerId(b.key));
    process.stdout.write(`[voice-merge-auto] group target=${target.key}${target.display ? `(${target.display})` : ""} members=${members.map((m) => m.key).join(",")}\n`);
    planned += members.length;

    if (!opts.apply) continue;
    for (const member of members) {
      const cmd = [
        path.join(process.cwd(), "command", "merge_voice_speakers.mjs"),
        voicesDir,
        member.key,
        target.key,
        "--apply",
        ...(opts.keepSource ? ["--keep-source"] : []),
      ];
      execFileSync("node", cmd, { stdio: "inherit" });
    }
  }
  process.stdout.write(`[voice-merge-auto] merges_planned=${planned}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error?.message || String(error)}\n`);
    process.exit(1);
  }
}

