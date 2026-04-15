#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { ensureStarted, identify, discharge, stop } from "./speaker_runner.mjs";

const DEFAULT_VOICES_DIR = "world/voices";
const DEFAULT_CLIP_SECONDS = 6;
const DEFAULT_HEAD_OFFSET_SECONDS = 0.8;
const DEFAULT_MIN_SIMILARITY = 0.72;

function usage() {
  return [
    "Usage: node command/prune_mixed_voice_samples.mjs [voices_dir] [--apply] [--speaker speaker_688] [--clip 6] [--head-offset 0.8] [--min-sim 0.72] [--limit 0] [--archive-dir path]",
    "Behavior:",
    "- Audits each speaker wav using head/tail identity checks via speaker worker.",
    "- Flags mixed samples when start/end speakers differ and the sample appears auto-created.",
    "- Dry-run by default. Use --apply to move flagged speaker files to archive dir.",
  ].join("\n");
}

function parseArgs(argv) {
  const out = {
    voicesDir: DEFAULT_VOICES_DIR,
    apply: false,
    speaker: "",
    clipSeconds: DEFAULT_CLIP_SECONDS,
    headOffsetSeconds: DEFAULT_HEAD_OFFSET_SECONDS,
    minSimilarity: DEFAULT_MIN_SIMILARITY,
    limit: 0,
    archiveDir: "",
    help: false,
  };
  const args = [...argv];
  if (args.length > 0 && !String(args[0]).startsWith("--")) {
    out.voicesDir = String(args.shift() || out.voicesDir).trim();
  }
  while (args.length > 0) {
    const arg = String(args.shift() || "").trim();
    if (!arg) continue;
    if (arg === "--help" || arg === "-h") { out.help = true; continue; }
    if (arg === "--apply") { out.apply = true; continue; }
    if (arg === "--speaker") { out.speaker = String(args.shift() || "").trim(); continue; }
    if (arg === "--clip") { out.clipSeconds = Number(args.shift() || ""); continue; }
    if (arg === "--head-offset") { out.headOffsetSeconds = Number(args.shift() || ""); continue; }
    if (arg === "--min-sim") { out.minSimilarity = Number(args.shift() || ""); continue; }
    if (arg === "--limit") { out.limit = Number(args.shift() || ""); continue; }
    if (arg === "--archive-dir") { out.archiveDir = String(args.shift() || "").trim(); continue; }
    throw new Error(`unknown arg: ${arg}`);
  }
  if (!Number.isFinite(out.clipSeconds) || out.clipSeconds <= 0) throw new Error(`invalid --clip: ${out.clipSeconds}`);
  if (!Number.isFinite(out.headOffsetSeconds) || out.headOffsetSeconds < 0) throw new Error(`invalid --head-offset: ${out.headOffsetSeconds}`);
  if (!Number.isFinite(out.minSimilarity) || out.minSimilarity < -1 || out.minSimilarity > 1) throw new Error(`invalid --min-sim: ${out.minSimilarity}`);
  if (!Number.isFinite(out.limit) || out.limit < 0) throw new Error(`invalid --limit: ${out.limit}`);
  return out;
}

function tsStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
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

function parseSpeakerMetaFile(metaPath) {
  const out = {};
  if (!fs.existsSync(metaPath)) return out;
  const text = fs.readFileSync(metaPath, "utf8");
  const lines = text.split(/\r?\n/u);
  for (const raw of lines) {
    const line = String(raw || "").trim();
    if (!line.startsWith("su name ")) continue;
    const m = line.match(/^su name (.+?) ob (.+?) ya$/u);
    if (!m) continue;
    const key = String(m[1] || "").trim();
    const body = String(m[2] || "").trim();
    if (body.startsWith("text ")) {
      try {
        out[key] = JSON.parse(body.slice(5));
      } catch {
        out[key] = body.slice(5).replace(/^"|"$/gu, "");
      }
    } else if (body.startsWith("num ")) {
      const n = Number(body.slice(4).trim());
      if (Number.isFinite(n)) out[key] = n;
    }
  }
  return out;
}

function isAutoIdentifyMeta(meta) {
  const origin = String(meta.origin || "").trim().toLowerCase();
  const fullName = String(meta.full_name || "").trim();
  const name = String(meta.name || "").trim().toLowerCase();
  const speaker = String(meta.speaker || "").trim().toLowerCase();
  if (origin === "identify") return true;
  if (!fullName && name && speaker && name === speaker) return true;
  return false;
}

function getDurationSeconds(filename) {
  const out = execFileSync("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=nokey=1:noprint_wrappers=1",
    filename,
  ], { encoding: "utf8" }).trim();
  const n = Number(out);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`invalid duration: ${filename}`);
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

function fmt(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(4) : "na";
}

function isKnownLike(matched) {
  const t = String(matched || "").trim().toLowerCase();
  return t === "known" || t === "prev";
}

function shouldPruneCandidate({ key, meta, head, tail, minSimilarity }) {
  const headSpeaker = String(head?.speaker || "").trim();
  const tailSpeaker = String(tail?.speaker || "").trim();
  if (!headSpeaker || !tailSpeaker) return false;
  if (headSpeaker === tailSpeaker) return false;
  if (!isAutoIdentifyMeta(meta)) return false;
  // Core mixed-sample signature: this sample identifies as itself at one edge,
  // but resolves to a different known speaker at the other edge with strong similarity.
  const selfOnEdge = headSpeaker === key || tailSpeaker === key;
  const other = headSpeaker === key ? tail : head;
  const otherSpeaker = String(other?.speaker || "").trim();
  if (!selfOnEdge) return false;
  if (!otherSpeaker || otherSpeaker === key) return false;
  if (!isKnownLike(other?.matched)) return false;
  const sim = Number(other?.similarity);
  if (!Number.isFinite(sim) || sim < minSimilarity) return false;
  return true;
}

async function inspectSpeaker({ key, wav, voicesDir, clipSeconds, headOffsetSeconds }) {
  const tmpRoot = fs.mkdtempSync(path.join(path.resolve(process.cwd(), "world", "temporary", "speaker"), "prune-mixed-"));
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
    return { duration, clipSeconds: effClip, headOffsetSeconds: headSince, head, tail };
  } finally {
    try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch {}
  }
}

function moveSpeakerArtifactsToArchive({ voicesDir, archiveDir, key }) {
  fs.mkdirSync(archiveDir, { recursive: true });
  let moved = 0;
  for (const ext of [".wav", ".npy", ".pya"]) {
    const src = path.join(voicesDir, `${key}${ext}`);
    if (!fs.existsSync(src)) continue;
    const dst = path.join(archiveDir, `${key}${ext}`);
    fs.renameSync(src, dst);
    moved += 1;
  }
  return moved;
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
  const archiveDir = path.resolve(process.cwd(), opts.archiveDir || path.join(voicesDir, `archive-mixed-samples-${tsStamp()}`));

  let items = listSpeakerWavs(voicesDir, opts.speaker);
  if (opts.limit > 0) items = items.slice(0, Math.floor(opts.limit));
  if (items.length === 0) {
    process.stdout.write("no speaker wavs to inspect\n");
    return;
  }

  process.stdout.write(`[voice-prune] voices: ${voicesDir}\n`);
  process.stdout.write(`[voice-prune] mode: ${opts.apply ? "apply" : "dry-run"}\n`);
  process.stdout.write(`[voice-prune] clip: ${opts.clipSeconds}s head_offset: ${opts.headOffsetSeconds}s min_sim: ${opts.minSimilarity}\n`);
  process.stdout.write(`[voice-prune] inspect count: ${items.length}\n`);
  if (opts.apply) process.stdout.write(`[voice-prune] archive: ${archiveDir}\n`);

  await ensureStarted();
  let checked = 0;
  let flagged = 0;
  let pruned = 0;
  try {
    for (const item of items) {
      const key = item.key;
      const meta = parseSpeakerMetaFile(path.join(voicesDir, `${key}.pya`));
      let r = null;
      let inspectError = null;
      try {
        r = await inspectSpeaker({
          key,
          wav: item.wav,
          voicesDir,
          clipSeconds: opts.clipSeconds,
          headOffsetSeconds: opts.headOffsetSeconds
        });
      } catch (error) {
        inspectError = error;
      }
      checked += 1;
      if (inspectError) {
        const msg = String(inspectError?.message || inspectError || "");
        const suspicious = msg.toLowerCase().includes("speaker sample defective");
        if (suspicious) {
          flagged += 1;
          process.stdout.write(`FLAG ${key} reason=${JSON.stringify(msg)}\n`);
          if (opts.apply) {
            const moved = moveSpeakerArtifactsToArchive({ voicesDir, archiveDir, key });
            if (moved > 0) pruned += 1;
            process.stdout.write(`PRUNE ${key} moved_files=${moved}\n`);
          }
        } else {
          process.stdout.write(`SKIP ${key} reason=${JSON.stringify(msg)}\n`);
        }
        continue;
      }
      const prune = shouldPruneCandidate({
        key,
        meta,
        head: r?.head,
        tail: r?.tail,
        minSimilarity: opts.minSimilarity,
      });
      if (prune) {
        flagged += 1;
        process.stdout.write(
          `FLAG ${key} origin=${String(meta.origin || "")} head=${String(r.head?.speaker || "na")}(${fmt(r.head?.similarity)}) tail=${String(r.tail?.speaker || "na")}(${fmt(r.tail?.similarity)})\n`
        );
        if (opts.apply) {
          const moved = moveSpeakerArtifactsToArchive({ voicesDir, archiveDir, key });
          if (moved > 0) pruned += 1;
          process.stdout.write(`PRUNE ${key} moved_files=${moved}\n`);
        }
      } else {
        process.stdout.write(
          `KEEP ${key} head=${String(r.head?.speaker || "na")}(${fmt(r.head?.similarity)}) tail=${String(r.tail?.speaker || "na")}(${fmt(r.tail?.similarity)})\n`
        );
      }
    }
  } finally {
    try { await discharge(); } catch {}
    try { await stop(); } catch {}
  }

  process.stdout.write(`\n[voice-prune] checked=${checked} flagged=${flagged} pruned=${pruned}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    process.stderr.write(`${error?.message || String(error)}\n`);
    process.exit(1);
  });
}

export {
  parseArgs,
  parseSpeakerMetaFile,
  isAutoIdentifyMeta,
  shouldPruneCandidate,
  listSpeakerWavs,
};
