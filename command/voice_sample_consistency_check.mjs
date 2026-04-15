#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { ensureStarted, identify, discharge, stop } from "./speaker_runner.mjs";

const DEFAULT_VOICES_DIR = "world/voices";
const DEFAULT_CLIP_SECONDS = 6;
const DEFAULT_HEAD_OFFSET_SECONDS = 0.8;

function usage() {
  return [
    "Usage: node command/voice_sample_consistency_check.mjs [voices_dir] [--speaker speaker_688] [--clip 6] [--head-offset 0.8] [--limit 0]",
    "Checks whether the beginning and ending clips of each speaker wav resolve to the same speaker key.",
    "Examples:",
    "  node command/voice_sample_consistency_check.mjs world/voices",
    "  node command/voice_sample_consistency_check.mjs world/voices --speaker speaker_688 --head-offset 1.2",
  ].join("\n");
}

function parseArgs(argv) {
  const out = {
    voicesDir: DEFAULT_VOICES_DIR,
    speaker: "",
    clipSeconds: DEFAULT_CLIP_SECONDS,
    headOffsetSeconds: DEFAULT_HEAD_OFFSET_SECONDS,
    limit: 0,
  };
  const args = [...argv];
  if (args.length > 0 && !args[0].startsWith("--")) {
    out.voicesDir = String(args.shift() || out.voicesDir).trim();
  }
  while (args.length > 0) {
    const arg = String(args.shift() || "").trim();
    if (!arg) continue;
    if (arg === "--help" || arg === "-h") {
      out.help = true;
      continue;
    }
    if (arg === "--speaker") {
      out.speaker = String(args.shift() || "").trim();
      continue;
    }
    if (arg === "--clip") {
      out.clipSeconds = Number(args.shift() || "");
      continue;
    }
    if (arg === "--head-offset") {
      out.headOffsetSeconds = Number(args.shift() || "");
      continue;
    }
    if (arg === "--limit") {
      out.limit = Number(args.shift() || "");
      continue;
    }
    throw new Error(`unknown arg: ${arg}`);
  }
  if (!Number.isFinite(out.clipSeconds) || out.clipSeconds <= 0) {
    throw new Error(`invalid --clip: ${out.clipSeconds}`);
  }
  if (!Number.isFinite(out.headOffsetSeconds) || out.headOffsetSeconds < 0) {
    throw new Error(`invalid --head-offset: ${out.headOffsetSeconds}`);
  }
  if (!Number.isFinite(out.limit) || out.limit < 0) {
    throw new Error(`invalid --limit: ${out.limit}`);
  }
  return out;
}

function listSpeakerWavs(voicesDir, onlySpeaker = "") {
  const speakerKey = String(onlySpeaker || "").trim();
  const names = fs.readdirSync(voicesDir)
    .filter((name) => /^speaker_\d+\.wav$/u.test(name))
    .sort();
  if (!speakerKey) return names.map((name) => ({ key: name.replace(/\.wav$/u, ""), wav: path.join(voicesDir, name) }));
  const exact = `${speakerKey}.wav`;
  if (!names.includes(exact)) return [];
  return [{ key: speakerKey, wav: path.join(voicesDir, exact) }];
}

function getDurationSeconds(filename) {
  const out = execFileSync("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=nokey=1:noprint_wrappers=1",
    filename,
  ], { encoding: "utf8" }).trim();
  const n = Number(out);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`invalid duration for ${filename}`);
  return n;
}

function clipWav({ input, output, since, duration }) {
  execFileSync("ffmpeg", [
    "-y",
    "-v", "error",
    "-ss", String(Math.max(0, since)),
    "-t", String(Math.max(0.05, duration)),
    "-i", input,
    output,
  ]);
}

function fmt(n) {
  const x = Number(n);
  return Number.isFinite(x) ? x.toFixed(4) : "na";
}

async function inspectOne({ key, wav, voicesDir, clipSeconds, headOffsetSeconds }) {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "voice-consistency-"));
  const headPath = path.join(tmpRoot, `${key}-head.wav`);
  const tailPath = path.join(tmpRoot, `${key}-tail.wav`);
  try {
    const duration = getDurationSeconds(wav);
    const effClip = Math.max(1, Math.min(clipSeconds, Math.max(1, duration / 2)));
    const headSince = Math.min(Math.max(0, headOffsetSeconds), Math.max(0, duration - effClip));
    const tailSince = Math.max(0, duration - effClip);
    clipWav({ input: wav, output: headPath, since: headSince, duration: effClip });
    clipWav({ input: wav, output: tailPath, since: tailSince, duration: effClip });
    const head = await identify({ audio: headPath, voicesDir, clipSeconds: effClip });
    const tail = await identify({ audio: tailPath, voicesDir, prevSpeaker: String(head?.speaker || ""), clipSeconds: effClip });
    const same = String(head?.speaker || "") !== "" && String(head?.speaker || "") === String(tail?.speaker || "");
    return {
      key,
      duration,
      clipSeconds: effClip,
      headOffsetSeconds: headSince,
      head,
      tail,
      same,
    };
  } finally {
    try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch {}
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const voicesDir = path.resolve(process.cwd(), opts.voicesDir);
  const st = fs.statSync(voicesDir, { throwIfNoEntry: false });
  if (!st || !st.isDirectory()) throw new Error(`voices dir not found: ${voicesDir}`);

  let items = listSpeakerWavs(voicesDir, opts.speaker);
  if (opts.limit > 0) items = items.slice(0, Math.floor(opts.limit));
  if (items.length === 0) {
    process.stdout.write("no speaker wavs to inspect\n");
    return;
  }

  await ensureStarted();
  let checked = 0;
  let mismatch = 0;
  try {
    for (const item of items) {
      const r = await inspectOne({
        ...item,
        voicesDir,
        clipSeconds: opts.clipSeconds,
        headOffsetSeconds: opts.headOffsetSeconds,
      });
      checked += 1;
      if (!r.same) mismatch += 1;
      process.stdout.write(
        `${r.same ? "OK " : "MISMATCH "} ${r.key} dur=${r.duration.toFixed(2)}s head=${String(r.head?.speaker || "na")}(${fmt(r.head?.similarity)}) tail=${String(r.tail?.speaker || "na")}(${fmt(r.tail?.similarity)})\n`
      );
    }
  } finally {
    try { await discharge(); } catch {}
    try { await stop(); } catch {}
  }
  process.stdout.write(`\nchecked=${checked} mismatch=${mismatch}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    process.stderr.write(`${error?.message || String(error)}\n`);
    process.exit(1);
  });
}

export {
  parseArgs,
  listSpeakerWavs,
};
