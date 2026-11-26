import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

function parseArgs(argv) {
  const args = argv.slice(2);
  const opts = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--input") opts.input = args[++i];
    else if (arg === "--model") opts.model = args[++i];
    else if (arg === "--language") opts.language = args[++i];
    else if (arg === "--prompt") opts.prompt = args[++i];
    else if (arg === "--bin") opts.bin = args[++i];
    else if (arg === "--output") opts.output = args[++i];
    else if (arg === "-h" || arg === "--help") opts.help = true;
  }
  return opts;
}

function resolveComputer() {
  const arch = process.arch;
  switch (process.platform) {
    case "win32":
      return arch === "x64" ? "win-x64" : `win-${arch}`;
    case "darwin":
      if (arch === "x64") return "darwin-x64";
      if (arch === "arm64") return "darwin-arm64";
      return `darwin-${arch}`;
    case "linux":
      if (arch === "x64") return "linux-x64";
      if (arch === "arm64") return "linux-arm64";
      return `linux-${arch}`;
    default:
      return `${process.platform}-${arch}`;
  }
}

function resolveWhisperBinary(binArg) {
  if (binArg) return binArg;
  if (process.env.PYA_HEAR_BIN) return process.env.PYA_HEAR_BIN;
  const computer = resolveComputer();
  const ext = computer.startsWith("win-") ? ".exe" : "";
  return path.join("caterer", "hear", "binary", computer, `whisper-main${ext}`);
}

function resolveModelPath(modelArg) {
  if (modelArg) return modelArg;
  if (process.env.PYA_HEAR_MODEL) return process.env.PYA_HEAR_MODEL;
  const baseBin = path.join("caterer", "hear", "template", "whisper", "ggml-base.bin");
  if (fsSync.existsSync(baseBin)) return baseBin;
  return path.join("caterer", "hear", "template", "whisper", "ggml-base.en.bin");
}

function resolveLanguage(langArg) {
  return langArg || process.env.PYA_HEAR_LANGUAGE || null;
}

function sanitizeTranscript(text) {
  return String(text ?? "")
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0 && !line.includes("[BLANK_AUDIO]"))
    .join("\n");
}

function printHelp() {
  console.log(`Usage: node command/whisper_main.mjs [options]

Options:
  --input <path>       Input audio file
  --model <path>       Whisper model path (optional)
  --language <id>      Language id (optional)
  --prompt <text>      Initial prompt (optional)
  --bin <path>         Whisper binary path (optional)
  --output <path>      Output text file (optional)

Environment:
  PYA_HEAR_BIN         Override whisper-main binary path
  PYA_HEAR_MODEL       Override whisper model path
  PYA_HEAR_LANGUAGE    Override language (auto, en, ru, ... )`);
}

/**
 * The longest segment the lane will write. The default of whisper is thirty
 * seconds, which is too long for words that follow a song: the house hears
 * the song in shorter phrases, so the words of the song can be placed against
 * it more closely.
 */
const MAX_SEGMENT_SECONDS = (() => {
  const raw = Number(process.env.PYA_HEAR_MAX_SEGMENT_SECONDS || 20);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 20;
})();

async function runWhisper({ inputPath, modelPath, language, prompt, binPath, outputPath }) {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const base = outputPath.replace(/\.txt$/u, "");
  // The text is what the house reads; the subtitle carries the time of every
  // line, which is what a ticker needs to follow the song.
  const args = [
    "-m", String(modelPath),
    "-f", String(inputPath),
    "-nt", "-np",
    "-otxt", "-osrt",
    "-ml", String(MAX_SEGMENT_SECONDS),
    "-of", String(base)
  ];
  if (language) {
    args.push("-l", String(language));
  }
  if (prompt) {
    args.push("--prompt", String(prompt));
  }
  return new Promise((resolve, reject) => {
    const proc = spawn(String(binPath), args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", data => { stderr += data.toString("utf8"); });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code) {
        const detail = stderr.trim();
        reject(new Error(detail ? `whisper-main exited ${code}: ${detail}` : `whisper-main exited ${code}`));
      } else {
        resolve();
      }
    });
  });
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    return;
  }
  const inputPath = args.input;
  if (!inputPath) {
    throw new Error("whisper_main: --input is required");
  }
  const outputPath = args.output ?? "/tmp/pyash-whisper-main.txt";
  const modelPath = resolveModelPath(args.model);
  const binPath = resolveWhisperBinary(args.bin);
  const language = resolveLanguage(args.language);
  const prompt = args.prompt ?? "";

  await runWhisper({ inputPath, modelPath, language, prompt, binPath, outputPath });
  let raw = "";
  try {
    raw = await fs.readFile(outputPath, "utf8");
  } catch (err) {
    throw new Error(`whisper_main: missing output ${outputPath}: ${err?.message ?? err}`);
  }
  const transcript = sanitizeTranscript(raw);
  if (transcript.length) {
    process.stdout.write(`${transcript}\n`);
  }
}

main().catch(err => {
  console.error(err?.message ?? err);
  process.exit(1);
});
