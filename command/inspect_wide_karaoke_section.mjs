#!/usr/bin/env node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";

function usage() {
  return "Usage: node command/inspect_wide_karaoke_section.mjs <sections/paragraph-N>";
}

async function sha256File(filePath) {
  const bytes = await fs.readFile(filePath);
  return createHash("sha256").update(bytes).digest("hex");
}

function runNode(script, args = []) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const proc = spawn(process.execPath, [script, ...args], { stdio: ["ignore", "pipe", "pipe"] });
    proc.stdout.on("data", (chunk) => { stdout += String(chunk ?? ""); });
    proc.stderr.on("data", (chunk) => { stderr += String(chunk ?? ""); });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
      else reject(new Error(stderr.trim() || `${script} failed with status ${code}`));
    });
  });
}

async function main() {
  const sectionArg = process.argv[2];
  if (!sectionArg) {
    process.stderr.write(`${usage()}\n`);
    process.exit(2);
  }
  const sectionDir = path.resolve(sectionArg);
  const inputVideo = path.join(sectionDir, "section.mp4");
  const inputSrt = path.join(sectionDir, "captions-aligned.srt");
  const outputVideo = path.join(sectionDir, "section-footnote.mp4");
  const chunkMeta = path.join(sectionDir, "audio.qwen-say-chunks", "chunks.metadata.json");
  await fs.access(inputVideo);
  await fs.access(inputSrt);
  await fs.access(outputVideo);
  await fs.access(chunkMeta);

  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-karaoke-inspect-"));
  const karaokeOut = path.join(tmpRoot, "karaoke.mp4");
  const wordflowOut = path.join(tmpRoot, "wordflow.mp4");
  try {
    await runNode("command/footnote_video.mjs", [
      inputVideo, inputSrt, karaokeOut,
      "--mode", "karaoke",
      "--margin-ratio", "0.1",
      "--start-delay-seconds", "0.05"
    ]);
    await runNode("command/footnote_video.mjs", [
      inputVideo, inputSrt, wordflowOut,
      "--mode", "wordflow",
      "--margin-ratio", "0.1",
      "--start-delay-seconds", "0.05"
    ]);
    const actual = await sha256File(outputVideo);
    const karaoke = await sha256File(karaokeOut);
    const wordflow = await sha256File(wordflowOut);
    const resolvedMode = actual === karaoke ? "karaoke" : (actual === wordflow ? "wordflow" : "unknown");
    const report = [
      `section_dir: ${sectionDir}`,
      `burn_input_subtitle_file: ${inputSrt}`,
      `burn_output_file: ${outputVideo}`,
      `actual_sha256: ${actual}`,
      `karaoke_sha256: ${karaoke}`,
      `wordflow_sha256: ${wordflow}`,
      `resolved_mode_by_hash: ${resolvedMode}`
    ].join("\n");
    process.stdout.write(`${report}\n`);
    if (resolvedMode === "wordflow") {
      throw new Error("wide subtitle defective: resolved wordflow instead of karaoke");
    }
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${String(error?.stack || error?.message || error)}\n`);
  process.exit(1);
});

