import fs from "node:fs/promises";
import fss from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseItineraryPya } from "./itinerary_io.mjs";

function usage() {
  return "Usage: node command/itinerary_to_video.mjs <input-itinerary.pya> <images-dir> <audio.wav> <output.mp4> [--prefix <text>] [--fps <num>] [--dry-run]";
}

function parseArgs(argv) {
  const args = argv.slice(2);
  if (args.length < 4) throw new Error(usage());
  const out = {
    itineraryFile: args[0],
    imagesDir: args[1],
    audioFile: args[2],
    outputFile: args[3],
    prefix: "",
    fps: 30,
    dryRun: false
  };
  for (let i = 4; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--prefix") out.prefix = String(args[++i] ?? "");
    else if (arg === "--fps") out.fps = Number(args[++i] ?? "30");
    else if (arg === "--dry-run") out.dryRun = true;
    else throw new Error(usage());
  }
  if (!Number.isFinite(out.fps) || out.fps <= 0) throw new Error("fps must be > 0");
  return out;
}

function indexPrefix(index) {
  return String(index).padStart(3, "0");
}

async function findImageForCut(imagesDir, prefix, cutIndex) {
  const names = await fs.readdir(imagesDir);
  const idx = indexPrefix(cutIndex);
  const normalizedPrefix = String(prefix ?? "").trim();
  const stem = normalizedPrefix ? `${normalizedPrefix}-cut-${idx}` : `-cut-${idx}`;
  const found = names
    .filter((name) => {
      if (!name.toLowerCase().endsWith(".png")) return false;
      if (normalizedPrefix) return name.startsWith(stem);
      return name.includes(stem);
    })
    .sort();
  if (!found.length) {
    if (normalizedPrefix) {
      throw new Error(`missing image for cut ${cutIndex} (expected prefix: ${stem})`);
    }
    throw new Error(`missing image for cut ${cutIndex} (expected pattern: *-cut-${idx}.png)`);
  }
  return path.join(imagesDir, found[0]);
}

async function createConcatListFile(items) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-video-concat-"));
  const file = path.join(dir, "list.txt");
  const lines = [];
  for (const item of items) {
    const imagePath = path.resolve(String(item.image ?? ""));
    lines.push(`file '${imagePath.replace(/'/g, "'\\''")}'`);
    lines.push(`duration ${Math.max(0.05, item.duration).toFixed(3)}`);
  }
  if (items.length > 0) {
    const last = items[items.length - 1];
    const imagePath = path.resolve(String(last.image ?? ""));
    lines.push(`file '${imagePath.replace(/'/g, "'\\''")}'`);
  }
  await fs.writeFile(file, `${lines.join("\n")}\n`, "utf8");
  return { dir, file };
}

function runFfmpeg({ listFile, audioFile, outputFile, fps }) {
  const args = [
    "-y",
    "-f", "concat",
    "-safe", "0",
    "-i", listFile,
    "-i", audioFile,
    "-r", String(Math.floor(fps)),
    "-c:v", "libx264",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-shortest",
    "-movflags", "+faststart",
    outputFile
  ];
  return new Promise((resolve, reject) => {
    let stderr = "";
    const proc = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    proc.stderr.on("data", (chunk) => { stderr += String(chunk ?? ""); });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else {
        const clipped = stderr.length > 8000 ? `${stderr.slice(0, 4000)}\n...\n${stderr.slice(-4000)}` : stderr;
        reject(new Error(`ffmpeg failed status=${code}: ${clipped}`));
      }
    });
  });
}

function runCommandCapture(command, args = []) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const proc = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    proc.stdout.on("data", (chunk) => { stdout += String(chunk ?? ""); });
    proc.stderr.on("data", (chunk) => { stderr += String(chunk ?? ""); });
    proc.on("error", reject);
    proc.on("close", (code) => resolve({ code: Number(code ?? 1), stdout, stderr }));
  });
}

async function getAudioDurationSeconds(audioFile) {
  try {
    const { code, stdout } = await runCommandCapture("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=nokey=1:noprint_wrappers=1",
      audioFile
    ]);
    if (code !== 0) return null;
    const parsed = Number.parseFloat(String(stdout ?? "").trim());
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return parsed;
  } catch {
    return null;
  }
}

function buildTimelineItems(cuts = [], audioDurationSeconds = null) {
  const rows = Array.isArray(cuts) ? cuts : [];
  const out = [];
  for (let i = 0; i < rows.length; i += 1) {
    const cut = rows[i];
    const start = Number(cut?.since ?? 0);
    const nextStart = i + 1 < rows.length ? Number(rows[i + 1]?.since ?? start) : null;
    const fallbackEnd = Number(cut?.until ?? start);
    const desiredEnd = nextStart != null
      ? nextStart
      : (Number.isFinite(Number(audioDurationSeconds)) ? Number(audioDurationSeconds) : fallbackEnd);
    const rawDuration = desiredEnd - start;
    const fallbackDuration = Math.max(0.05, fallbackEnd - start);
    const duration = Number.isFinite(rawDuration) && rawDuration > 0 ? rawDuration : fallbackDuration;
    out.push({ ...cut, duration });
  }
  return out;
}

export { indexPrefix, findImageForCut, createConcatListFile, runFfmpeg, parseArgs, getAudioDurationSeconds, buildTimelineItems };

export async function main() {
  const opts = parseArgs(process.argv);
  const text = await fs.readFile(opts.itineraryFile, "utf8");
  const itinerary = parseItineraryPya(text);
  const cuts = itinerary.cuts;
  if (!cuts.length) throw new Error("no cuts found");
  if (!fss.existsSync(opts.audioFile)) throw new Error(`audio file missing: ${opts.audioFile}`);
  const audioDurationSeconds = await getAudioDurationSeconds(opts.audioFile);
  const timeline = buildTimelineItems(cuts, audioDurationSeconds);
  const items = [];
  for (const cut of timeline) {
    const image = await findImageForCut(opts.imagesDir, opts.prefix, cut.index);
    items.push({ ...cut, image });
  }
  if (opts.dryRun) {
    for (const item of items) {
      process.stdout.write(`${item.index}\t${item.duration.toFixed(3)}\t${item.image}\n`);
    }
    return;
  }
  const { dir, file } = await createConcatListFile(items);
  try {
    await fs.mkdir(path.dirname(opts.outputFile), { recursive: true });
    await runFfmpeg({ listFile: file, audioFile: opts.audioFile, outputFile: opts.outputFile, fps: opts.fps });
    process.stdout.write(`${opts.outputFile}\n`);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

const isDirect = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) {
  main().catch((err) => {
    process.stderr.write(`${err?.message ?? String(err)}\n`);
    process.exit(1);
  });
}
