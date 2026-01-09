import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

function parseArgs(argv) {
  const out = { capture: null, model: null, file: null, language: null, help: false };
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

function resolveWhisperStreamBinary() {
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

function resolveHearLanguage() {
  return process.env.PYA_HEAR_LANGUAGE || "auto";
}

function printHelp() {
  console.log(`Usage: node command/whisper_stream.mjs [options]

Options:
  -h, --help           Show this help message
  -c, --capture <id>   Capture device id (default: PYA_HEAR_CAPTURE or 0)
  -m, --model <path>   Whisper model path (default: PYA_HEAR_MODEL or ggml-base.bin)
  -l, --language <id>  Language id (default: PYA_HEAR_LANGUAGE or auto)
  -f, --file <path>    Output text file (default: /tmp/whisper-stream.txt)

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
  const language = args.language ?? resolveHearLanguage();
  const binPath = resolveWhisperStreamBinary();

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, "");

  const proc = spawn(String(binPath), ["-c", String(captureId), "-m", String(modelPath), "-l", String(language), "-f", String(outputPath)], {
    stdio: ["ignore", "pipe", "pipe"]
  });

  proc.stderr.on("data", data => {
    const text = data.toString("utf8");
    if (text.trim()) console.error(text.trim());
  });

  let offset = 0;
  let pending = "";
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
      if (line.length) console.log(line);
    }
  }, 200);

  const cleanup = () => {
    clearInterval(interval);
    proc.kill("SIGINT");
  };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  proc.on("close", () => {
    clearInterval(interval);
    if (pending.trim()) console.log(pending.trim());
    process.exit(0);
  });
}

main().catch(err => {
  console.error(err?.message ?? err);
  process.exit(1);
});
