import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

function parseArgs(argv) {
  const out = {
    capture: null,
    model: null,
    file: null,
    language: null,
    prompt: null,
    bin: null,
    timebox: null,
    final: false,
    help: false
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") {
      out.help = true;
      continue;
    }
    if (arg === "-c" || arg === "--capture") {
      out.capture = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === "-m" || arg === "--model") {
      out.model = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === "-f" || arg === "--file") {
      out.file = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === "-l" || arg === "--language") {
      out.language = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--prompt") {
      out.prompt = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--bin") {
      out.bin = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--timebox") {
      out.timebox = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--final") {
      out.final = true;
    }
  }
  return out;
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

function resolveWhisperStreamBinary(binArg) {
  if (binArg) return binArg;
  if (process.env.PYA_HEAR_STREAM_BIN) return process.env.PYA_HEAR_STREAM_BIN;
  const computer = resolveComputer();
  const ext = computer.startsWith("win-") ? ".exe" : "";
  return path.join("caterer", "hear", "binary", computer, `whisper-stream${ext}`);
}

function resolveModelPath() {
  if (process.env.PYA_HEAR_MODEL) return process.env.PYA_HEAR_MODEL;
  const baseBin = path.join("caterer", "hear", "template", "whisper", "ggml-base.bin");
  if (fs.existsSync(baseBin)) return baseBin;
  return path.join("caterer", "hear", "template", "whisper", "ggml-base.en.bin");
}

function resolveHearLanguage(langArg) {
  return langArg || process.env.PYA_HEAR_LANGUAGE || "auto";
}

function normalizeStreamLine(line) {
  return String(line ?? "").trim().toLowerCase();
}

function normalizeStreamPrefix(line) {
  const normalized = normalizeStreamLine(line);
  return normalized.replace(/[.]+$/u, "");
}

function normalizeDedupLine(line) {
  return String(line ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
}

function isBlankAudioLine(line) {
  const trimmed = String(line ?? "").trim();
  return trimmed.includes("[BLANK_AUDIO]");
}

function collapseStreamLines(lines) {
  const output = [];
  const seen = new Set();
  let lastLine = "";
  let lastNormalized = "";
  for (const line of lines) {
    const trimmed = String(line ?? "").trim();
    if (!trimmed || isBlankAudioLine(trimmed)) continue;
    const dedup = normalizeDedupLine(trimmed);
    if (dedup && seen.has(dedup) && dedup !== lastNormalized) continue;
    if (!lastLine) {
      output.push(trimmed);
      lastLine = trimmed;
      lastNormalized = dedup;
      if (dedup) seen.add(dedup);
      continue;
    }
    const normLast = normalizeStreamLine(lastLine);
    const normNext = normalizeStreamLine(trimmed);
    const normLastPrefix = normalizeStreamPrefix(lastLine);
    if (normNext === normLast) continue;
    if (normNext.startsWith(normLast) || (normLastPrefix && normNext.startsWith(normLastPrefix))) {
      if (lastNormalized) seen.delete(lastNormalized);
      output[output.length - 1] = trimmed;
      lastLine = trimmed;
      lastNormalized = dedup;
      if (dedup) seen.add(dedup);
      continue;
    }
    output.push(trimmed);
    lastLine = trimmed;
    lastNormalized = dedup;
    if (dedup) seen.add(dedup);
  }
  return output;
}

function buildStreamTranscript(text) {
  const lines = String(text ?? "").split(/\r?\n/);
  return collapseStreamLines(lines).join("\n");
}

function printHelp() {
  console.log(`Usage: node command/whisper_stream.mjs [options]

Options:
  -h, --help           Show this help message
  -c, --capture <id>   Capture device id (default: PYA_HEAR_CAPTURE or 0)
  -m, --model <path>   Whisper model path (default: PYA_HEAR_MODEL or ggml-base.bin)
  -l, --language <id>  Language id (default: PYA_HEAR_LANGUAGE or auto)
  -f, --file <path>    Output text file (default: /tmp/whisper-stream.txt)
  --prompt <text>      Initial prompt (optional)
  --bin <path>         Whisper-stream binary path (optional)
  --timebox <ms>       Stop after duration (optional)
  --final              Print only the final transcript (optional)

Environment:
  PYA_HEAR_STREAM_BIN  Override whisper-stream binary path
  PYA_HEAR_MODEL       Override whisper model path
  PYA_HEAR_LANGUAGE    Override language (auto, en, ru, ... )
  PYA_HEAR_CAPTURE     Default capture device id`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    process.exit(0);
  }

  const captureId = args.capture ?? process.env.PYA_HEAR_CAPTURE ?? "0";
  const modelPath = args.model ?? resolveModelPath();
  const outputPath = args.file ?? "/tmp/whisper-stream.txt";
  const language = resolveHearLanguage(args.language);
  const binPath = resolveWhisperStreamBinary(args.bin);
  const prompt = args.prompt ?? "";
  const finalOnly = Boolean(args.final);
  const timeboxMs = args.timebox ? Number(args.timebox) : null;

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, "");

  const whisperArgs = ["-c", String(captureId), "-m", String(modelPath), "-l", String(language), "-f", String(outputPath)];
  if (prompt) {
    whisperArgs.push("--prompt", prompt);
  }
  const proc = spawn(String(binPath), whisperArgs, {
    stdio: ["ignore", "pipe", "pipe"]
  });

  proc.stderr.on("data", data => {
    const text = data.toString("utf8");
    if (text.trim()) console.error(text.trim());
  });

  let offset = 0;
  let pending = "";
  let sawTranscript = false;
  const interval = setInterval(() => {
    let stats;
    try {
      stats = fs.statSync(outputPath);
    } catch {
      return;
    }
    if (stats.size <= offset) return;
    const fd = fs.openSync(outputPath, "r");
    const buffer = Buffer.alloc(stats.size - offset);
    fs.readSync(fd, buffer, 0, buffer.length, offset);
    fs.closeSync(fd);
    offset = stats.size;
    const text = pending + buffer.toString("utf8");
    const lines = text.split(/\r?\n/);
    pending = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.length) continue;
      if (isBlankAudioLine(line)) {
        if (sawTranscript) proc.kill("SIGINT");
        continue;
      }
      sawTranscript = true;
      if (!finalOnly) console.log(line);
    }
  }, 200);

  const cleanup = () => {
    clearInterval(interval);
    proc.kill("SIGINT");
  };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  let timeboxTimer = null;
  if (Number.isFinite(timeboxMs) && timeboxMs > 0) {
    timeboxTimer = setTimeout(() => {
      proc.kill("SIGINT");
    }, timeboxMs);
  }

  proc.on("close", async () => {
    clearInterval(interval);
    if (timeboxTimer) clearTimeout(timeboxTimer);
    if (!finalOnly && pending.trim()) console.log(pending.trim());
    if (finalOnly) {
      try {
        const raw = fs.readFileSync(outputPath, "utf8");
        const transcript = buildStreamTranscript(raw);
        if (transcript.length) {
          console.log(transcript);
        }
      } catch {
        // ignore missing output
      }
    }
    process.exit(0);
  });
}

main().catch(err => {
  console.error(err?.message ?? err);
  process.exit(1);
});
