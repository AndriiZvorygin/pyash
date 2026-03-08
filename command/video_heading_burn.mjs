import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

function usage() {
  return "Usage: node command/video_heading_burn.mjs <input-video> <output-video> [--text <heading>] [--text-stdin] [--seconds <num>] [--y-ratio <num>] [--max-width-ratio <num>] [--font-scale <num>]";
}

export function parseArgs(argv) {
  const args = argv.slice(2);
  if (args.length < 2) throw new Error(usage());
  const out = {
    inputVideo: String(args[0] ?? ""),
    outputVideo: String(args[1] ?? ""),
    text: null,
    textStdin: false,
    seconds: 1,
    yRatio: 0.60,
    maxWidthRatio: 0.82,
    fontScale: 1,
    fontFile: "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
  };
  for (let i = 2; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--text") out.text = String(args[++i] ?? "");
    else if (arg === "--text-stdin") out.textStdin = true;
    else if (arg === "--seconds") out.seconds = Number(args[++i] ?? out.seconds);
    else if (arg === "--y-ratio") out.yRatio = Number(args[++i] ?? out.yRatio);
    else if (arg === "--max-width-ratio") out.maxWidthRatio = Number(args[++i] ?? out.maxWidthRatio);
    else if (arg === "--font-scale") out.fontScale = Number(args[++i] ?? out.fontScale);
    else if (arg === "--font-file") out.fontFile = String(args[++i] ?? out.fontFile);
    else throw new Error(usage());
  }
  if (!Number.isFinite(out.seconds) || out.seconds <= 0 || out.seconds > 5) {
    throw new Error("seconds must be between 0 and 5");
  }
  if (!Number.isFinite(out.yRatio) || out.yRatio < 0.45 || out.yRatio > 0.75) {
    throw new Error("y-ratio must be between 0.45 and 0.75");
  }
  if (!Number.isFinite(out.maxWidthRatio) || out.maxWidthRatio < 0.60 || out.maxWidthRatio > 0.95) {
    throw new Error("max-width-ratio must be between 0.60 and 0.95");
  }
  if (!Number.isFinite(out.fontScale) || out.fontScale < 0.25 || out.fontScale > 2) {
    throw new Error("font-scale must be between 0.25 and 2");
  }
  return out;
}

function runCapture(command, args = []) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const proc = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    proc.stdout.on("data", chunk => { stdout += String(chunk ?? ""); });
    proc.stderr.on("data", chunk => { stderr += String(chunk ?? ""); });
    proc.on("error", reject);
    proc.on("close", code => resolve({ code: Number(code ?? 1), stdout, stderr }));
  });
}

async function probeVideoSize(inputVideo) {
  const res = await runCapture("ffprobe", [
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=width,height",
    "-of", "csv=p=0:s=x",
    inputVideo
  ]);
  if (res.code !== 0) return { width: 1280, height: 720 };
  const raw = String(res.stdout ?? "").trim();
  const [wRaw, hRaw] = raw.split("x");
  const width = Number(wRaw);
  const height = Number(hRaw);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { width: 1280, height: 720 };
  }
  return { width: Math.floor(width), height: Math.floor(height) };
}

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

function ffmpegEscapePathForFilter(inputPath) {
  return String(inputPath ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'");
}

function resolveHeadingText(opts) {
  if (typeof opts.text === "string" && opts.text.trim()) return opts.text.trim().replace(/\s+/g, " ");
  if (opts.textStdin) return String(fsSync.readFileSync(0, "utf8") ?? "").trim().replace(/\s+/g, " ");
  return "";
}

function truncateHeadingWords(text, maxWords = 7) {
  const words = String(text ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return words.join(" ");
  return words.slice(0, maxWords).join(" ");
}

function layoutHeadingLines(text) {
  const words = String(text ?? "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [""];
  if (words.length <= 3) return [words.join(" ")];
  let best = [words.join(" ")];
  let bestScore = Number.POSITIVE_INFINITY;
  for (let split = 1; split < words.length; split += 1) {
    const lines = [words.slice(0, split).join(" "), words.slice(split).join(" ")];
    const lengths = lines.map(line => line.length);
    const maxLen = Math.max(...lengths);
    const minLen = Math.min(...lengths);
    const score = (maxLen - minLen) + (maxLen * 0.1);
    if (score < bestScore) {
      bestScore = score;
      best = lines;
    }
  }
  return best;
}

function resolveRenderOutputPath(inputVideo, outputVideo) {
  const inputResolved = path.resolve(inputVideo);
  const outputResolved = path.resolve(outputVideo);
  if (inputResolved !== outputResolved) return outputResolved;
  const ext = path.extname(outputResolved) || ".mp4";
  const stem = path.basename(outputResolved, ext);
  const nonce = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return path.join(path.dirname(outputResolved), `${stem}.heading-tmp-${nonce}${ext}`);
}

function runFfmpeg(inputVideo, outputVideo, vf) {
  return new Promise((resolve, reject) => {
    let stderr = "";
    const args = [
      "-y",
      "-i", inputVideo,
      "-vf", vf,
      "-map", "0:v:0",
      "-map", "0:a?",
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-crf", "18",
      "-pix_fmt", "yuv420p",
      "-c:a", "copy",
      "-movflags", "+faststart",
      outputVideo
    ];
    const proc = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    proc.stderr.on("data", chunk => { stderr += String(chunk ?? ""); });
    proc.on("error", reject);
    proc.on("close", code => {
      if (code === 0) resolve();
      else reject(new Error(`video heading burn failed status=${code}: ${stderr.slice(-1200)}`));
    });
  });
}

function formatAssTime(seconds) {
  const safe = Math.max(0, Number(seconds) || 0);
  const csTotal = Math.round(safe * 100);
  const hh = Math.floor(csTotal / 360000);
  const mm = Math.floor((csTotal % 360000) / 6000);
  const ss = Math.floor((csTotal % 6000) / 100);
  const cs = csTotal % 100;
  return `${hh}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

function escapeAssText(text) {
  return String(text ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\{/g, "\\{")
    .replace(/\}/g, "\\}")
    .replace(/\r?\n/g, "\\N");
}

function buildAssText({ width, height, fontSize, marginV, seconds, text }) {
  const start = formatAssTime(0);
  const end = formatAssTime(seconds);
  const outline = Math.max(2, Math.round(fontSize * 0.11));
  const shadow = Math.max(1, Math.round(fontSize * 0.03));
  return [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${Math.max(2, Math.floor(width))}`,
    `PlayResY: ${Math.max(2, Math.floor(height))}`,
    "WrapStyle: 2",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding",
    `Style: Default,DejaVu Sans,${Math.max(10, Math.floor(fontSize))},&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,1,0,0,0,100,100,0,0,1,${outline},${shadow},8,40,40,${Math.max(8, Math.floor(marginV))},1`,
    "",
    "[Events]",
    "Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text",
    `Dialogue: 0,${start},${end},Default,,0,0,0,,${escapeAssText(text)}`
  ].join("\n");
}

export async function main(argv = process.argv) {
  const opts = parseArgs(argv);
  const inputVideo = path.resolve(opts.inputVideo);
  const outputVideo = path.resolve(opts.outputVideo);
  const headingText = truncateHeadingWords(resolveHeadingText(opts), 7);
  if (!headingText) throw new Error("missing heading text");
  const headingLines = layoutHeadingLines(headingText);
  const headingForBurn = headingLines.join("\n");
  const { width, height } = await probeVideoSize(inputVideo);
  const maxLineChars = Math.max(...headingLines.map(line => line.length), 1);
  const usableWidth = Math.floor(width * opts.maxWidthRatio);
  const baseSize = Math.floor(clamp(height * 0.058, height * 0.040, height * 0.075));
  const widthBound = Math.floor((usableWidth / Math.max(1, maxLineChars)) / 0.62);
  const scaled = Math.min(baseSize, widthBound) * opts.fontScale;
  const fontSize = Math.floor(clamp(scaled, height * 0.020, height * 0.072));
  const borderW = Math.max(2, Math.round(fontSize * 0.11));
  const shadow = Math.max(1, Math.round(fontSize * 0.03));
  // Treat y-ratio as the lower anchor of the heading block so 0.60 sits
  // meaningfully above subtitle lanes instead of centering through them.
  const yExpr = `max(12\\,h*${opts.yRatio.toFixed(3)}-text_h)`;
  const enableExpr = `lt(t\\,${Number(opts.seconds).toFixed(3)})`;
  const marginV = Math.max(8, Math.round(height * opts.yRatio));

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-video-heading-"));
  const textFile = path.join(tmpDir, "heading.txt");
  const assFile = path.join(tmpDir, "heading.ass");
  const renderOutput = resolveRenderOutputPath(inputVideo, outputVideo);
  const replaceInPlace = renderOutput !== outputVideo;
  await fs.writeFile(textFile, `${headingForBurn}\n`, "utf8");
  const escapedTextFile = ffmpegEscapePathForFilter(path.resolve(textFile));
  const vf = [
    `drawtext=fontfile='${ffmpegEscapePathForFilter(opts.fontFile)}'`,
    `textfile='${escapedTextFile}'`,
    "fontcolor=white",
    `fontsize=${fontSize}`,
    "line_spacing=4",
    "x=(w-text_w)/2",
    `y=${yExpr}`,
    `borderw=${borderW}`,
    "bordercolor=black",
    `shadowx=${shadow}`,
    `shadowy=${shadow}`,
    "shadowcolor=black@0.45",
    `enable='${enableExpr}'`
  ].join(":");

  try {
    await fs.mkdir(path.dirname(outputVideo), { recursive: true });
    try {
      await runFfmpeg(inputVideo, renderOutput, vf);
    } catch (err) {
      const message = String(err?.message ?? err ?? "");
      if (!/No such filter: 'drawtext'/u.test(message)) throw err;
      const assText = buildAssText({
        width,
        height,
        fontSize,
        marginV,
        seconds: opts.seconds,
        text: headingForBurn
      });
      await fs.writeFile(assFile, `${assText}\n`, "utf8");
      const vfAss = `subtitles='${ffmpegEscapePathForFilter(path.resolve(assFile))}'`;
      await runFfmpeg(inputVideo, renderOutput, vfAss);
    }
    if (replaceInPlace) await fs.rename(renderOutput, outputVideo);
    process.stdout.write(`${outputVideo}\n`);
  } finally {
    if (replaceInPlace) await fs.rm(renderOutput, { force: true });
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
