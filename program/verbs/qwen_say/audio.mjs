import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { randomInt } from "node:crypto";

export async function runQwenSay({ text, instruct = "", workflowName, workflowRoot, host, output, returnTranscript = false, seed = null }) {
  const runner = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../command/say_comfyui_runner.mjs");
  const args = [
    runner,
    "--text",
    String(text ?? ""),
    "--workflow-name",
    workflowName,
    "--workflow-root",
    workflowRoot,
    "--host",
    host,
    "--output",
    output
  ];
  if (String(instruct ?? "").trim()) {
    args.push("--instruct", String(instruct).trim());
  }
  if (returnTranscript) {
    args.push("--return-transcript", "true");
  }
  if (Number.isFinite(seed)) {
    args.push("--seed", String(Math.trunc(seed)));
  }
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const proc = spawn(process.execPath, args, { stdio: ["ignore", "pipe", "pipe"] });
    proc.stdout.on("data", chunk => { stdout += String(chunk ?? ""); });
    proc.stderr.on("data", chunk => { stderr += String(chunk ?? ""); });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) {
        const trimmed = stdout.trim();
        const lines = trimmed.split(/\r?\n/u).filter(Boolean);
        const lastLine = lines.length ? lines[lines.length - 1] : "";
        let outputPath = trimmed;
        let transcript = "";
        let timestamps = "";
        try {
          const payload = JSON.parse(lastLine);
          if (payload && typeof payload === "object") {
            outputPath = String(payload.output ?? outputPath);
            transcript = String(payload.transcript ?? "");
            timestamps = String(payload.timestamps ?? "");
          }
        } catch {
          // Plain text mode is still supported for non-JSON callers.
        }
        resolve({ stdout: trimmed, outputPath, transcript, timestamps });
      }
      else reject(new Error(stderr.trim() || `qwen say defective: status=${code}`));
    });
  });
}

export function randomChunkSeed() {
  // Qwen seed expects positive 32-bit-ish ints; keep within signed 31-bit range.
  return randomInt(1, 2147483647);
}

export async function postProcessQwenSayAudio({ input, output, filter }) {
  const args = [
    "-y",
    "-i",
    input,
    "-af",
    String(filter ?? ""),
    output
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
        reject(new Error(`qwen say defective: post process failed status=${code}: ${clipped}`));
      }
    });
  });
}

export async function concatAudioChunks({ inputs = [], output }) {
  if (!Array.isArray(inputs) || !inputs.length) {
    throw new Error("qwen say defective: no chunk audio to concatenate");
  }
  if (inputs.length === 1) {
    await fs.copyFile(inputs[0], output);
    return;
  }
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-qwen-say-concat-"));
  const listFile = path.join(tempDir, "list.txt");
  try {
    const lines = inputs.map((filename) => `file '${path.resolve(String(filename ?? "")).replace(/'/g, "'\\''")}'`);
    await fs.writeFile(listFile, `${lines.join("\n")}\n`, "utf8");
    await new Promise((resolve, reject) => {
      let stderr = "";
      const proc = spawn("ffmpeg", [
        "-y",
        "-f", "concat",
        "-safe", "0",
        "-i", listFile,
        "-c:a", "pcm_s16le",
        output
      ], { stdio: ["ignore", "ignore", "pipe"] });
      proc.stderr.on("data", (chunk) => { stderr += String(chunk ?? ""); });
      proc.on("error", reject);
      proc.on("close", (code) => {
        if (code === 0) resolve();
        else {
          const clipped = stderr.length > 8000 ? `${stderr.slice(0, 4000)}\n...\n${stderr.slice(-4000)}` : stderr;
          reject(new Error(`qwen say defective: concat failed status=${code}: ${clipped}`));
        }
      });
    });
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

export async function padAudioTail({ input = "", output = "", padMs = 0 } = {}) {
  const padSeconds = Math.max(0, Number(padMs) / 1000);
  if (!Number.isFinite(padSeconds) || padSeconds <= 0) {
    await fs.copyFile(input, output);
    return;
  }
  let duration = 0;
  try {
    duration = await probeDurationSeconds(input);
  } catch {
    // Test stubs may use non-audio bytes; keep original output in that case.
    await fs.copyFile(input, output);
    return;
  }
  const targetDuration = duration + padSeconds;
  return await new Promise((resolve, reject) => {
    let stderr = "";
    const proc = spawn("ffmpeg", [
      "-y",
      "-i",
      input,
      "-af",
      `apad=pad_dur=${padSeconds.toFixed(3)}`,
      "-t",
      targetDuration.toFixed(3),
      output
    ], { stdio: ["ignore", "ignore", "pipe"] });
    proc.stderr.on("data", (chunk) => { stderr += String(chunk ?? ""); });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else {
        const clipped = stderr.length > 8000 ? `${stderr.slice(0, 4000)}\n...\n${stderr.slice(-4000)}` : stderr;
        reject(new Error(`qwen say defective: tail pad failed status=${code}: ${clipped}`));
      }
    });
  });
}

export async function runToolWithStderr(tool, args = []) {
  return await new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const proc = spawn(String(tool), args.map((entry) => String(entry)), { stdio: ["ignore", "pipe", "pipe"] });
    proc.stdout.on("data", chunk => { stdout += String(chunk ?? ""); });
    proc.stderr.on("data", chunk => { stderr += String(chunk ?? ""); });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else {
        const clipped = stderr.length > 8000 ? `${stderr.slice(0, 4000)}\n...\n${stderr.slice(-4000)}` : stderr;
        reject(new Error(`qwen say defective: ${tool} failed status=${code}: ${clipped}`));
      }
    });
  });
}

export async function probeDurationSeconds(input = "") {
  const { stdout } = await runToolWithStderr("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=nokey=1:noprint_wrappers=1",
    input
  ]);
  const duration = Number(String(stdout ?? "").trim());
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error("qwen say defective: invalid chunk duration");
  }
  return duration;
}

export async function probeDurationSecondsSafe(input = "") {
  try {
    return await probeDurationSeconds(input);
  } catch {
    return null;
  }
}

export function parseLastAstatsMetric(stderr = "", metric = "") {
  const rx = new RegExp(`${String(metric)}:\\s*(-?\\d+(?:\\.\\d+)?)`, "gu");
  let found = null;
  for (const match of String(stderr ?? "").matchAll(rx)) found = match;
  if (!found) throw new Error(`qwen say defective: astats metric missing ${metric}`);
  return Number(found[1]);
}

