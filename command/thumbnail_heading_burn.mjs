import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

function usage() {
  return "Usage: node command/thumbnail_heading_burn.mjs <input-image> <output-image> [--text <heading>] [--text-stdin] [--y-ratio <num>] [--max-width-ratio <num>]";
}

function parseArgs(argv) {
  const args = argv.slice(2);
  if (args.length < 2) throw new Error(usage());
  const out = {
    inputImage: String(args[0] ?? ""),
    outputImage: String(args[1] ?? ""),
    text: null,
    textStdin: false,
    yRatio: 0.42,
    maxWidthRatio: 0.42,
    fontFile: "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
  };
  for (let i = 2; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--text") out.text = String(args[++i] ?? "");
    else if (arg === "--text-stdin") out.textStdin = true;
    else if (arg === "--y-ratio") out.yRatio = Number(args[++i] ?? out.yRatio);
    else if (arg === "--max-width-ratio") out.maxWidthRatio = Number(args[++i] ?? out.maxWidthRatio);
    else if (arg === "--font-file") out.fontFile = String(args[++i] ?? out.fontFile);
    else throw new Error(usage());
  }
  if (!Number.isFinite(out.yRatio) || out.yRatio < 0.38 || out.yRatio > 0.48) {
    throw new Error("y-ratio must be between 0.38 and 0.48");
  }
  if (!Number.isFinite(out.maxWidthRatio) || out.maxWidthRatio < 0.30 || out.maxWidthRatio > 0.95) {
    throw new Error("max-width-ratio must be between 0.30 and 0.95");
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

async function probeImageSize(inputImage) {
  const res = await runCapture("ffprobe", [
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=width,height",
    "-of", "csv=p=0:s=x",
    inputImage
  ]);
  if (res.code !== 0) return { width: 720, height: 1280 };
  const raw = String(res.stdout ?? "").trim();
  const [wRaw, hRaw] = raw.split("x");
  const width = Number(wRaw);
  const height = Number(hRaw);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { width: 720, height: 1280 };
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

function truncateHeadingWords(text, maxWords = 6) {
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
    const lengths = lines.map((line) => line.length);
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

function runFfmpeg(inputImage, outputImage, vf) {
  return new Promise((resolve, reject) => {
    let stderr = "";
    const args = ["-y", "-i", inputImage, "-vf", vf, "-frames:v", "1", outputImage];
    const proc = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    proc.stderr.on("data", chunk => { stderr += String(chunk ?? ""); });
    proc.on("error", reject);
    proc.on("close", code => {
      if (code === 0) resolve();
      else reject(new Error(`thumbnail heading burn failed status=${code}: ${stderr.slice(-1200)}`));
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

function buildAssText({ width, height, fontSize, marginV, text }) {
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
    `Dialogue: 0,${formatAssTime(0)},${formatAssTime(2)},Default,,0,0,0,,${escapeAssText(text)}`
  ].join("\n");
}

function resolveRenderOutputPath(inputImage, outputImage) {
  const inputResolved = path.resolve(inputImage);
  const outputResolved = path.resolve(outputImage);
  if (inputResolved !== outputResolved) return outputResolved;
  const ext = path.extname(outputResolved) || ".png";
  const stem = path.basename(outputResolved, ext);
  const nonce = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return path.join(path.dirname(outputResolved), `${stem}.thumb-tmp-${nonce}${ext}`);
}

export { parseArgs };

export async function main(argv = process.argv) {
  const opts = parseArgs(argv);
  const inputImage = path.resolve(opts.inputImage);
  const outputImage = path.resolve(opts.outputImage);
  const headingText = truncateHeadingWords(resolveHeadingText(opts), 6);
  if (!headingText) throw new Error("missing heading text");
  const headingLines = layoutHeadingLines(headingText);
  const headingForBurn = headingLines.join("\n");
  const { width, height } = await probeImageSize(inputImage);
  const lineCount = Math.max(1, headingLines.length);
  const maxLineChars = Math.max(...headingLines.map((line) => line.length), 1);
  const panelWidth = Math.floor(width * opts.maxWidthRatio);
  const usableWidth = Math.max(80, panelWidth - Math.floor(width * 0.02));
  const targetBlockHeight = Math.floor(height * 0.25);
  const perLineTarget = Math.floor((targetBlockHeight - Math.max(0, lineCount - 1) * 4) / lineCount);
  const baseSize = Math.floor(clamp(perLineTarget, height * 0.060, height * 0.160));
  const widthBound = Math.floor((usableWidth / Math.max(1, maxLineChars)) / 0.62);
  const fontSize = Math.floor(clamp(Math.min(baseSize, widthBound), height * 0.050, height * 0.160));
  const borderW = Math.max(2, Math.round(fontSize * 0.11));
  const shadow = Math.max(1, Math.round(fontSize * 0.03));
  const marginV = Math.max(8, Math.round(height * opts.yRatio));
  const yExpr = `max(12\\,h*${opts.yRatio.toFixed(3)}-text_h/2)`;
  const panelLeft = Math.floor(width * (1 - opts.maxWidthRatio));
  const panelPad = Math.floor(width * 0.01);
  const xExpr = `${panelLeft + panelPad} + (${Math.max(1, usableWidth)}-text_w)/2`;

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-thumb-"));
  const textFile = path.join(tmpDir, "heading.txt");
  const assFile = path.join(tmpDir, "heading.ass");
  const renderOutput = resolveRenderOutputPath(inputImage, outputImage);
  const replaceInPlace = renderOutput !== outputImage;
  await fs.writeFile(textFile, `${headingForBurn}\n`, "utf8");
  const escapedTextFile = ffmpegEscapePathForFilter(path.resolve(textFile));
  const vf = [
    `drawtext=fontfile='${ffmpegEscapePathForFilter(opts.fontFile)}'`,
    `textfile='${escapedTextFile}'`,
    "fontcolor=white",
    `fontsize=${fontSize}`,
    "line_spacing=4",
    `x=${xExpr}`,
    `y=${yExpr}`,
    `borderw=${borderW}`,
    "bordercolor=black",
    `shadowx=${shadow}`,
    `shadowy=${shadow}`,
    "shadowcolor=black@0.45"
  ].join(":");

  try {
    await fs.mkdir(path.dirname(outputImage), { recursive: true });
    try {
      await runFfmpeg(inputImage, renderOutput, vf);
    } catch (err) {
      const message = String(err?.message ?? err ?? "");
      if (!/No such filter: 'drawtext'/u.test(message)) throw err;
      const assText = buildAssText({
        width,
        height,
        fontSize,
        marginV,
        text: headingForBurn
      });
      await fs.writeFile(assFile, `${assText}\n`, "utf8");
      const vfAss = `subtitles='${ffmpegEscapePathForFilter(path.resolve(assFile))}'`;
      await runFfmpeg(inputImage, renderOutput, vfAss);
    }
    if (replaceInPlace) await fs.rename(renderOutput, outputImage);
    process.stdout.write(`${outputImage}\n`);
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
