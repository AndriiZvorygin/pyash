import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseSrtToCuts } from "./itinerary_io.mjs";

function usage() {
  return "Usage: node command/footnote_video.mjs <input-video.mp4> <input.srt> <output-video.mp4> [--mode plain|karaoke] [--font-size <num>] [--margin-v <num>] [--font-name <text>]";
}

function parseArgs(argv) {
  const args = argv.slice(2);
  if (args.length < 3) throw new Error(usage());
  const out = {
    inputVideo: args[0],
    inputSrt: args[1],
    outputVideo: args[2],
    mode: "plain",
    fontSize: null,
    marginV: null,
    fontName: "DejaVu Sans",
    width: null,
    height: null,
    maxLineChars: null
  };
  for (let i = 3; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--mode") out.mode = String(args[++i] ?? "plain").trim().toLowerCase();
    else if (arg === "--font-size") out.fontSize = Number(args[++i] ?? "54");
    else if (arg === "--margin-v") out.marginV = Number(args[++i] ?? "80");
    else if (arg === "--font-name") out.fontName = String(args[++i] ?? "").trim() || "DejaVu Sans";
    else if (arg === "--width") out.width = Number(args[++i] ?? "");
    else if (arg === "--height") out.height = Number(args[++i] ?? "");
    else if (arg === "--max-line-chars") out.maxLineChars = Number(args[++i] ?? "");
    else throw new Error(usage());
  }
  if (out.mode !== "plain" && out.mode !== "karaoke" && out.mode !== "wordflow") throw new Error("mode must be plain, karaoke, or wordflow");
  if (out.fontSize != null && (!Number.isFinite(out.fontSize) || out.fontSize <= 0)) throw new Error("font-size must be > 0");
  if (out.marginV != null && (!Number.isFinite(out.marginV) || out.marginV < 0)) throw new Error("margin-v must be >= 0");
  if (out.width != null && (!Number.isFinite(out.width) || out.width <= 0)) throw new Error("width must be > 0");
  if (out.height != null && (!Number.isFinite(out.height) || out.height <= 0)) throw new Error("height must be > 0");
  if (out.maxLineChars != null && (!Number.isFinite(out.maxLineChars) || out.maxLineChars <= 0)) throw new Error("max-line-chars must be > 0");
  if (out.fontSize != null) out.fontSize = Math.floor(out.fontSize);
  if (out.marginV != null) out.marginV = Math.floor(out.marginV);
  if (out.width != null) out.width = Math.floor(out.width);
  if (out.height != null) out.height = Math.floor(out.height);
  if (out.maxLineChars != null) out.maxLineChars = Math.floor(out.maxLineChars);
  return out;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

const GOLDEN = 1.61803398875;
const SUBTITLE_WIDTH_RATIO = 0.61;
const SUBTITLE_MAX_ROWS = 2;
const SUBTITLE_MIN_SEGMENT_SECONDS = 0.28;

function splitWords(text = "") {
  return String(text ?? "").trim().split(/\s+/).filter(Boolean);
}

function wrapWords(words = [], maxChars = 30) {
  const lines = [];
  let line = [];
  let length = 0;
  for (const word of words) {
    const w = String(word ?? "");
    const add = line.length ? (1 + w.length) : w.length;
    if (line.length && length + add > maxChars) {
      lines.push(line);
      line = [w];
      length = w.length;
      continue;
    }
    line.push(w);
    length += add;
  }
  if (line.length) lines.push(line);
  return lines.length ? lines : [[]];
}

function estimateMaxLineChars(width, fontSize) {
  const safeWidth = Math.max(100, Number(width) * SUBTITLE_WIDTH_RATIO);
  const charPx = Math.max(7, Number(fontSize) * 0.70);
  return clamp(Math.floor(safeWidth / charPx), 10, 34);
}

function worstRowsForSrt(srtText, maxChars) {
  const cuts = parseSrtToCuts(String(srtText ?? ""));
  let worst = 1;
  for (const cut of cuts) {
    const words = splitWords(cut?.obText ?? "");
    const rows = wrapWords(words, maxChars).length;
    if (rows > worst) worst = rows;
  }
  return worst;
}

function pickFontSizeForSrt(srtText, { width, requestedFontSize } = {}) {
  if (Number.isFinite(requestedFontSize) && requestedFontSize > 0) {
    return Math.floor(requestedFontSize);
  }
  let fontSize = clamp(Math.round(Number(width) * 0.030), 14, 28);
  let attempts = 0;
  while (attempts < 16) {
    const maxChars = estimateMaxLineChars(width, fontSize);
    const worst = worstRowsForSrt(srtText, maxChars);
    if (worst <= SUBTITLE_MAX_ROWS || fontSize <= 12) break;
    fontSize -= 1;
    attempts += 1;
  }
  return clamp(Math.floor(fontSize), 12, 28);
}

function assTime(secondsRaw = 0) {
  const seconds = Math.max(0, Number(secondsRaw) || 0);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const centis = Math.floor((seconds - Math.floor(seconds)) * 100);
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${String(centis).padStart(2, "0")}`;
}

function sanitizeAssText(text = "") {
  return String(text ?? "")
    .replace(/\r?\n/g, "\\N")
    .replace(/[{}]/g, "")
    .replace(/\\/g, "\\\\");
}

function karaokeTextForCut(text, durationSeconds, maxLineChars = 30) {
  const words = splitWords(text);
  if (!words.length) return "";
  const lines = wrapWords(words, maxLineChars);
  const totalCs = Math.max(1, Math.round(Number(durationSeconds || 0) * 100));
  const each = Math.max(1, Math.floor(totalCs / words.length));
  let remain = Math.max(0, totalCs - each * words.length);
  const timedWords = words.map((word) => {
    const bonus = remain > 0 ? 1 : 0;
    remain -= bonus;
    return `{\\k${each + bonus}}${sanitizeAssText(word)}`;
  });
  const out = [];
  let cursor = 0;
  for (const line of lines) {
    const count = line.length;
    out.push(timedWords.slice(cursor, cursor + count).join(" "));
    cursor += count;
  }
  return out.join("\\N");
}

function paginateRows(rows = [], maxRows = 2) {
  const out = [];
  for (let i = 0; i < rows.length; i += maxRows) {
    out.push(rows.slice(i, i + maxRows));
  }
  return out.length ? out : [[[]]];
}

function karaokeTaggedRows(rows = [], totalCs = 1) {
  const flatWords = rows.flat();
  const wordsCount = flatWords.length || 1;
  const each = Math.max(1, Math.floor(totalCs / wordsCount));
  let remain = Math.max(0, totalCs - each * wordsCount);
  const outRows = rows.map((row) => {
    const parts = row.map((word) => {
      const bonus = remain > 0 ? 1 : 0;
      remain -= bonus;
      return `{\\k${each + bonus}}${sanitizeAssText(word)}`;
    });
    return parts.join(" ");
  });
  return outRows.join("\\N");
}

function buildKaraokeDialogues(cuts = [], { maxLineChars = 24, maxRows = 2 } = {}) {
  const out = [];
  for (const cut of cuts) {
    const since = Number(cut?.since ?? 0);
    const until = Number(cut?.until ?? since + 1);
    const duration = Math.max(0.05, until - since);
    const words = splitWords(cut?.obText ?? "");
    if (!words.length) continue;
    const rows = wrapWords(words, Math.max(1, Math.floor(maxLineChars)));
    const pages = paginateRows(rows, Math.max(1, Math.floor(maxRows)));
    const totalWords = pages.reduce((sum, pageRows) => sum + pageRows.flat().length, 0) || 1;
    let cursor = since;
    for (let i = 0; i < pages.length; i += 1) {
      const pageRows = pages[i];
      const pageWords = pageRows.flat().length || 1;
      const ratio = pageWords / totalWords;
      const slice = duration * ratio;
      const end = i === pages.length - 1 ? until : cursor + slice;
      const totalCs = Math.max(1, Math.round((end - cursor) * 100));
      const text = karaokeTaggedRows(pageRows, totalCs);
      out.push(`Dialogue: 0,${assTime(cursor)},${assTime(Math.max(cursor + SUBTITLE_MIN_SEGMENT_SECONDS, end))},Default,,0,0,0,,${text}`);
      cursor = end;
    }
  }
  return out;
}

function plainTextForCut(text, maxLineChars = 30) {
  const words = splitWords(text);
  if (!words.length) return "";
  return wrapWords(words, maxLineChars)
    .map((line) => sanitizeAssText(line.join(" ")))
    .join("\\N");
}

function styleTextForCut(text, mode, durationSeconds, maxLineChars) {
  if (mode === "karaoke") return karaokeTextForCut(text, durationSeconds, maxLineChars);
  return plainTextForCut(text, maxLineChars);
}

function buildWordflowDialogues(cuts = [], { maxLineChars = 12 } = {}) {
  const out = [];
  for (const cut of cuts) {
    const since = Number(cut?.since ?? 0);
    const until = Number(cut?.until ?? since);
    const duration = Math.max(0.05, until - since);
    const words = splitWords(cut?.obText ?? "");
    if (!words.length) continue;
    const groups = wrapWords(words, Math.max(1, Math.floor(maxLineChars)));
    const totalWords = groups.reduce((sum, line) => sum + line.length, 0) || 1;
    let cursor = since;
    for (let i = 0; i < groups.length; i += 1) {
      const lineWords = groups[i];
      const ratio = lineWords.length / totalWords;
      const slice = duration * ratio;
      const end = i === groups.length - 1 ? until : cursor + slice;
      const text = sanitizeAssText(lineWords.join(" "));
      out.push(`Dialogue: 0,${assTime(cursor)},${assTime(Math.max(cursor + SUBTITLE_MIN_SEGMENT_SECONDS, end))},Default,,0,0,0,,${text}`);
      cursor = end;
    }
  }
  return out;
}

function buildAssFromSrt(
  srtText,
  {
    mode = "plain",
    fontSize = 36,
    marginV = 100,
    fontName = "DejaVu Sans",
    maxLineChars = 30,
    playResX = 720,
    playResY = 1280,
    marginLR = 80
  } = {}
) {
  const cuts = parseSrtToCuts(srtText);
  const header = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${Math.max(1, Math.floor(Number(playResX) || 720))}`,
    `PlayResY: ${Math.max(1, Math.floor(Number(playResY) || 1280))}`,
    "WrapStyle: 2",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Default,${fontName},${fontSize},&H0000FFFF,&H0000FFFF,&H00000000,&H00000000,1,0,0,0,100,100,0,0,3,0,0,2,${marginLR},${marginLR},${marginV},1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text"
  ];
  const body = mode === "wordflow"
    ? buildWordflowDialogues(cuts, { maxLineChars })
    : mode === "karaoke"
      ? buildKaraokeDialogues(cuts, { maxLineChars, maxRows: SUBTITLE_MAX_ROWS })
      : cuts.map((cut) => {
      const since = Number(cut?.since ?? 0);
      const until = Number(cut?.until ?? since + 1);
      const text = styleTextForCut(cut?.obText ?? "", mode, Math.max(0.05, until - since), maxLineChars);
      return `Dialogue: 0,${assTime(since)},${assTime(until)},Default,,0,0,0,,${text}`;
    });
  return `${header.concat(body).join("\n")}\n`;
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

async function probeVideoSize(inputVideo) {
  const res = await runCommandCapture("ffprobe", [
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=width,height",
    "-of", "csv=p=0:s=x",
    inputVideo
  ]);
  if (res.code !== 0) return null;
  const raw = String(res.stdout ?? "").trim();
  const [wRaw, hRaw] = raw.split("x");
  const width = Number(wRaw);
  const height = Number(hRaw);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  return { width: Math.floor(width), height: Math.floor(height) };
}

function ffmpegEscapePathForFilter(inputPath) {
  return String(inputPath ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'");
}

function runFfmpegBurn({ inputVideo, outputVideo, assFile }) {
  const escapedAss = ffmpegEscapePathForFilter(path.resolve(assFile));
  const vf = `ass='${escapedAss}'`;
  const args = [
    "-y",
    "-i", inputVideo,
    "-vf", vf,
    "-c:v", "libx264",
    "-pix_fmt", "yuv420p",
    "-c:a", "copy",
    "-movflags", "+faststart",
    outputVideo
  ];
  return new Promise((resolve, reject) => {
    let stderr = "";
    let stdout = "";
    const proc = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
    proc.stdout.on("data", (chunk) => { stdout += String(chunk ?? ""); });
    proc.stderr.on("data", (chunk) => { stderr += String(chunk ?? ""); });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`ffmpeg failed status=${code}: ${stderr.slice(-1500)}`));
    });
  });
}

export { parseArgs, buildAssFromSrt, runFfmpegBurn };

function resolveRenderOutputPath(inputVideo, outputVideo) {
  const inputResolved = path.resolve(inputVideo);
  const outputResolved = path.resolve(outputVideo);
  if (inputResolved !== outputResolved) return outputResolved;
  const ext = path.extname(outputResolved) || ".mp4";
  const stem = path.basename(outputResolved, ext);
  const nonce = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return path.join(path.dirname(outputResolved), `${stem}.footnote-tmp-${nonce}${ext}`);
}

export { resolveRenderOutputPath };

export async function main(argv = process.argv) {
  const opts = parseArgs(argv);
  const inputVideo = path.resolve(opts.inputVideo);
  const inputSrt = path.resolve(opts.inputSrt);
  const outputVideo = path.resolve(opts.outputVideo);
  const renderOutputVideo = resolveRenderOutputPath(inputVideo, outputVideo);
  const replaceInPlace = renderOutputVideo !== outputVideo;
  const srtText = await fs.readFile(inputSrt, "utf8");
  const probed = await probeVideoSize(inputVideo);
  const width = opts.width ?? probed?.width ?? 720;
  const height = opts.height ?? probed?.height ?? 1280;
  const marginV = opts.marginV ?? clamp(Math.round(height * 0.04), 24, 84);
  const marginLR = Math.max(16, Math.round(width * ((1 - SUBTITLE_WIDTH_RATIO) / 2)));
  const provisionalFont = opts.fontSize ?? clamp(Math.round(width * 0.08), 42, 110);
  const plainMaxChars = opts.maxLineChars ?? estimateMaxLineChars(width, provisionalFont);
  const wordflowMaxChars = opts.maxLineChars ?? clamp(Math.round(width / 64), 8, 14);
  const karaokeFont = opts.fontSize ?? clamp(Math.round(width * 0.070), 36, 112);
  const karaokeMaxChars = opts.maxLineChars
    ?? clamp(Math.round((width * SUBTITLE_WIDTH_RATIO) / Math.max(10, karaokeFont * 0.42)), 14, 42);
  const fontSize = opts.mode === "wordflow"
    ? (
      opts.fontSize
      ?? clamp(
        Math.round((width / GOLDEN) / (Math.max(1, wordflowMaxChars) * 0.62)),
        42,
        120
      )
    )
    : (opts.mode === "karaoke"
      ? karaokeFont
      : pickFontSizeForSrt(srtText, { width, requestedFontSize: opts.fontSize }));
  const maxLineChars = opts.mode === "wordflow"
    ? wordflowMaxChars
    : (opts.mode === "karaoke" ? karaokeMaxChars : plainMaxChars);
  const assText = buildAssFromSrt(srtText, {
    mode: opts.mode,
    fontName: opts.fontName,
    fontSize,
    marginV,
    maxLineChars,
    playResX: width,
    playResY: height,
    marginLR
  });
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-footnote-"));
  const assFile = path.join(tmpDir, "subtitle.ass");
  await fs.writeFile(assFile, assText, "utf8");
  try {
    await fs.mkdir(path.dirname(outputVideo), { recursive: true });
    await runFfmpegBurn({ inputVideo, outputVideo: renderOutputVideo, assFile });
    if (replaceInPlace) {
      await fs.rename(renderOutputVideo, outputVideo);
    }
    process.stdout.write(`${outputVideo}\n`);
  } finally {
    if (replaceInPlace) {
      await fs.rm(renderOutputVideo, { force: true });
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((err) => {
    process.stderr.write(`${err?.message ?? String(err)}\n`);
    process.exit(1);
  });
}
