import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { spawn } from "node:child_process";

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

function resolvePiperBinary({ binArg, binEnv } = {}) {
  if (binArg) return binArg;
  if (binEnv) return binEnv;
  const computer = resolveComputer();
  const ext = computer.startsWith("win-") ? ".exe" : "";
  return path.join("caterer", "say", "binary", computer, `piper${ext}`);
}

function resolveVoicePath({ voiceArg, voiceEnv } = {}) {
  const voice = voiceArg || voiceEnv || "en_US-lessac-medium";
  if (voice.endsWith(".onnx")) return voice;
  return path.join("caterer", "say", "vocalization", "piper", voice, `${voice}.onnx`);
}

function resolveAudioPlayer({ playerArg, playerEnv } = {}) {
  if (playerArg) return playerArg;
  if (playerEnv) return playerEnv;
  if (process.platform === "darwin") return "afplay";
  if (process.platform === "win32") return null;
  return "aplay";
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const opts = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--bin") opts.bin = args[++i];
    else if (arg === "--voice") opts.voice = args[++i];
    else if (arg === "--player") opts.player = args[++i];
    else if (arg === "--output") opts.output = args[++i];
  }
  return opts;
}

async function runPiper({ text, bin, voicePath, outputPath }) {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  return new Promise((resolve, reject) => {
    const proc = spawn(String(bin), ["--model", String(voicePath), "--output_file", String(outputPath)], {
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stderr = "";
    proc.stderr.on("data", data => { stderr += data.toString("utf8"); });
    proc.on("error", reject);
    proc.on("close", code => {
      if (code) {
        const detail = stderr.trim();
        reject(new Error(detail ? `piper exited ${code}: ${detail}` : `piper exited ${code}`));
      } else {
        resolve();
      }
    });
    proc.stdin.write(text);
    proc.stdin.end();
  });
}

async function playAudio(outputPath, player) {
  if (!player) return;
  return new Promise((resolve, reject) => {
    const proc = spawn(String(player), [outputPath], { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", data => { stderr += data.toString("utf8"); });
    proc.on("error", reject);
    proc.on("close", code => {
      if (code) {
        const detail = stderr.trim();
        reject(new Error(detail ? `player exited ${code}: ${detail}` : `player exited ${code}`));
      } else {
        resolve();
      }
    });
  });
}

function resolveDelayMs() {
  const raw = process.env.PYA_SAY_STREAM_DELAY_MS;
  const value = Number(raw);
  if (Number.isFinite(value) && value >= 0) return value;
  return 300;
}

function shouldFlushRemainder(text) {
  return /\s$/.test(text);
}

function extractChunks(text, { force = false } = {}) {
  let remaining = text;
  const chunks = [];
  while (remaining.length) {
    let boundary = -1;
    for (let i = 0; i < remaining.length; i += 1) {
      const ch = remaining[i];
      if (ch === "\n") {
        boundary = i;
        break;
      }
      if (ch === "." || ch === "!" || ch === "?") {
        const next = remaining[i + 1];
        if (!next || /\s/.test(next)) {
          boundary = i + 1;
          break;
        }
      }
    }
    if (boundary === -1) break;
    const chunk = remaining.slice(0, boundary).trim();
    remaining = remaining.slice(boundary).trimStart();
    if (chunk) chunks.push(chunk);
  }
  if (force && remaining.trim()) {
    chunks.push(remaining.trim());
    remaining = "";
  } else if (!force && remaining.trim() && shouldFlushRemainder(remaining)) {
    chunks.push(remaining.trim());
    remaining = "";
  }
  return { chunks, remaining };
}

async function main() {
  const opts = parseArgs(process.argv);
  const bin = resolvePiperBinary({ binArg: opts.bin, binEnv: process.env.PYA_PIPER_BIN });
  const voicePath = resolveVoicePath({ voiceArg: opts.voice, voiceEnv: process.env.PYA_PIPER_VOICE });
  const player = resolveAudioPlayer({ playerArg: opts.player, playerEnv: process.env.PYA_AUDIO_PLAYER });
  const outputPath = opts.output || path.join("/tmp", `pyash-piper-${process.pid}-${Date.now()}.wav`);
  const fixture = process.env.PYA_PIPER_FIXTURE;

  let buffer = "";
  let timer = null;
  const delayMs = resolveDelayMs();
  let chain = Promise.resolve();
  const enqueueSpeak = (chunk) => {
    chain = chain.then(async () => {
      await runPiper({ text: chunk, bin, voicePath, outputPath });
      if (process.env.PYA_SAY_SILENT !== "1" && process.env.PYA_SAY_SILENT !== "true") {
        await playAudio(outputPath, player);
      }
    }).catch(() => {});
  };
  const flushBuffer = (force = false) => {
    const { chunks, remaining } = extractChunks(buffer, { force });
    buffer = remaining;
    for (const chunk of chunks) {
      enqueueSpeak(chunk);
      process.stdout.write(`${chunk}\n`);
    }
  };
  const scheduleFlush = () => {
    if (delayMs <= 0) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      flushBuffer(false);
    }, delayMs);
  };

  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on("line", (line) => {
    const trimmed = String(line ?? "").trim();
    if (!trimmed) return;
    if (buffer && !/\s$/.test(buffer)) buffer += " ";
    buffer += trimmed;
    scheduleFlush();
  });
  rl.on("close", async () => {
    if (timer) clearTimeout(timer);
    if (fixture !== undefined) {
      await fs.mkdir(path.dirname(outputPath), { recursive: true });
      await fs.writeFile(outputPath, String(fixture), "utf8");
      if (fixture) process.stdout.write(`${fixture}\n`);
    } else {
      flushBuffer(true);
      await chain;
    }
    if (!opts.output) {
      try {
        if (fsSync.existsSync(outputPath)) await fs.unlink(outputPath);
      } catch {
        // best-effort cleanup
      }
    }
  });
}

main().catch((err) => {
  const message = err?.message ?? String(err ?? "unknown error");
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
