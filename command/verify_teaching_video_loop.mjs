import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

function usage() {
  return "Usage: node command/verify_teaching_video_loop.mjs <artifact-dir>";
}

function runCapture(command, args = [], { stdin = "ignore" } = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { stdio: [stdin, "pipe", "pipe"] });
    const stdout = [];
    const stderr = [];
    proc.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
    proc.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    proc.on("error", reject);
    proc.on("close", (code) => {
      resolve({
        code: Number(code ?? 1),
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr).toString("utf8")
      });
    });
  });
}

async function ffprobeDuration(filename) {
  const res = await runCapture("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=nokey=1:noprint_wrappers=1",
    filename
  ]);
  if (res.code !== 0) throw new Error(`ffprobe failed for ${filename}: ${res.stderr}`);
  const value = Number.parseFloat(String(res.stdout ?? "").trim());
  if (!Number.isFinite(value) || value <= 0) throw new Error(`invalid duration for ${filename}`);
  return value;
}

async function extractFrameHash(videoFile, timeSeconds) {
  const res = await runCapture("ffmpeg", [
    "-v", "error",
    "-ss", String(Math.max(0, Number(timeSeconds) || 0)),
    "-i", videoFile,
    "-frames:v", "1",
    "-f", "rawvideo",
    "-pix_fmt", "rgb24",
    "pipe:1"
  ]);
  if (res.code !== 0) {
    throw new Error(`ffmpeg frame extract failed: ${res.stderr}`);
  }
  return crypto.createHash("sha256").update(res.stdout).digest("hex");
}

async function extractAudioHash(videoFile, timeSeconds, snippetSeconds = 1.5) {
  const res = await runCapture("ffmpeg", [
    "-v", "error",
    "-ss", String(Math.max(0, Number(timeSeconds) || 0)),
    "-t", String(Math.max(0.25, Number(snippetSeconds) || 1.5)),
    "-i", videoFile,
    "-map", "0:a:0",
    "-ac", "1",
    "-ar", "8000",
    "-f", "s16le",
    "pipe:1"
  ]);
  if (res.code !== 0) {
    throw new Error(`ffmpeg audio extract failed: ${res.stderr}`);
  }
  return crypto.createHash("sha256").update(res.stdout).digest("hex");
}

async function listSectionClipFiles(artifactDir) {
  const sectionsDir = path.join(artifactDir, "sections");
  let entries = [];
  try {
    entries = await fs.readdir(sectionsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const paragraphs = entries
    .filter((entry) => entry.isDirectory() && /^paragraph-\d+$/u.test(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => {
      const ai = Number(a.split("-")[1] || 0);
      const bi = Number(b.split("-")[1] || 0);
      return ai - bi;
    });
  const out = [];
  for (const paragraph of paragraphs) {
    const clip = path.join(sectionsDir, paragraph, "section-footnote.mp4");
    try {
      await fs.access(clip);
      out.push(clip);
    } catch {
      // ignore missing clips
    }
  }
  return out;
}

async function chooseFinalVideo(artifactDir) {
  const preferred = [
    "opening-heading-stage.mp4",
    "final-concatenate-stage.mp4"
  ];
  for (const name of preferred) {
    const filename = path.join(artifactDir, name);
    try {
      await fs.access(filename);
      return filename;
    } catch {
      // ignore
    }
  }
  const entries = await fs.readdir(artifactDir);
  const mp4s = entries.filter((name) => name.endsWith(".mp4")).sort();
  if (!mp4s.length) throw new Error(`no final mp4 found in ${artifactDir}`);
  return path.join(artifactDir, mp4s[0]);
}

export async function analyzeTeachingVideoArtifactDir(artifactDir) {
  const root = path.resolve(String(artifactDir ?? ""));
  const finalVideo = await chooseFinalVideo(root);
  const sectionClips = await listSectionClipFiles(root);
  if (sectionClips.length < 2) {
    return {
      ok: true,
      inconclusive: true,
      reason: "need at least two section clips",
      finalVideo,
      sectionCount: sectionClips.length,
      samples: []
    };
  }

  const durations = [];
  for (const clip of sectionClips) durations.push(await ffprobeDuration(clip));
  const samples = [];
  let offset = 0;
  for (let i = 0; i < sectionClips.length; i += 1) {
    const duration = durations[i];
    const midpoint = offset + Math.max(0.25, duration / 2);
    const frameHash = await extractFrameHash(finalVideo, midpoint);
    const audioHash = await extractAudioHash(finalVideo, midpoint);
    samples.push({
      section: i + 1,
      clip: sectionClips[i],
      duration,
      midpoint,
      frameHash,
      audioHash
    });
    offset += duration;
  }

  const uniqueFrameHashes = new Set(samples.map((sample) => sample.frameHash));
  const uniqueAudioHashes = new Set(samples.map((sample) => sample.audioHash));
  const suspicious = uniqueFrameHashes.size === 1 || uniqueAudioHashes.size === 1;

  return {
    ok: !suspicious,
    inconclusive: false,
    reason: suspicious
      ? `repeated final media across sections (uniqueFrames=${uniqueFrameHashes.size}, uniqueAudio=${uniqueAudioHashes.size})`
      : "final video varies across section midpoints",
    finalVideo,
    sectionCount: sectionClips.length,
    uniqueFrames: uniqueFrameHashes.size,
    uniqueAudio: uniqueAudioHashes.size,
    samples
  };
}

export async function main(argv = process.argv) {
  const artifactDir = String(argv[2] ?? "").trim();
  if (!artifactDir) throw new Error(usage());
  const result = await analyzeTeachingVideoArtifactDir(artifactDir);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok && !result.inconclusive) process.exitCode = 1;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((err) => {
    process.stderr.write(`${err?.message ?? String(err)}\n`);
    process.exit(1);
  });
}
