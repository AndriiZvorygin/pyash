import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";

import { analyzeTeachingVideoArtifactDir } from "../command/verify_teaching_video_loop.mjs";

function ffmpegAvailable() {
  return spawnSync("ffmpeg", ["-version"], { encoding: "utf8" }).status === 0
    && spawnSync("ffprobe", ["-version"], { encoding: "utf8" }).status === 0;
}

function createClip(filename, color, frequency = 440, duration = 0.9) {
  const run = spawnSync("ffmpeg", [
    "-y",
    "-f", "lavfi",
    "-i", `color=c=${color}:s=320x240:d=${duration}`,
    "-f", "lavfi",
    "-i", `sine=frequency=${frequency}:sample_rate=24000:duration=${duration}`,
    "-shortest",
    "-c:v", "libx264",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    filename
  ], { encoding: "utf8" });
  if (run.status !== 0) throw new Error(run.stderr || "ffmpeg clip generation failed");
}

function concatVideos(out, clips) {
  const list = clips.map((clip) => `file '${path.resolve(clip).replace(/'/g, "'\\''")}'`).join("\n");
  const listFile = path.join(path.dirname(out), "concat.txt");
  fs.writeFile(listFile, `${list}\n`, "utf8");
  return fs.writeFile(listFile, `${list}\n`, "utf8").then(() => {
    const run = spawnSync("ffmpeg", [
      "-y",
      "-f", "concat",
      "-safe", "0",
      "-i", listFile,
      "-c:v", "libx264",
      "-pix_fmt", "yuv420p",
      "-c:a", "aac",
      out
    ], { encoding: "utf8" });
    if (run.status !== 0) throw new Error(run.stderr || "ffmpeg concat failed");
  });
}

test("teaching video loop verifier passes when section midpoints differ", async (t) => {
  if (!ffmpegAvailable()) {
    t.skip("ffmpeg and ffprobe are required");
    return;
  }
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-video-loop-pass-"));
  const artifact = path.join(root, "artifacts-pass");
  await fs.mkdir(path.join(artifact, "sections", "paragraph-1"), { recursive: true });
  await fs.mkdir(path.join(artifact, "sections", "paragraph-2"), { recursive: true });
  await fs.mkdir(path.join(artifact, "sections", "paragraph-3"), { recursive: true });
  const clips = [
    path.join(artifact, "sections", "paragraph-1", "section-footnote.mp4"),
    path.join(artifact, "sections", "paragraph-2", "section-footnote.mp4"),
    path.join(artifact, "sections", "paragraph-3", "section-footnote.mp4")
  ];
  createClip(clips[0], "red", 330);
  createClip(clips[1], "blue", 550);
  createClip(clips[2], "green", 770);
  await concatVideos(path.join(artifact, "final-concatenate-stage.mp4"), clips);

  const result = await analyzeTeachingVideoArtifactDir(artifact);
  assert.equal(result.ok, true);
  assert.equal(result.inconclusive, false);
  assert.ok((result.uniqueFrames ?? 0) >= 2);
  assert.ok((result.uniqueAudio ?? 0) >= 2);
});

test("teaching video loop verifier fails when final video repeats the first section clip", async (t) => {
  if (!ffmpegAvailable()) {
    t.skip("ffmpeg and ffprobe are required");
    return;
  }
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-video-loop-fail-"));
  const artifact = path.join(root, "artifacts-fail");
  await fs.mkdir(path.join(artifact, "sections", "paragraph-1"), { recursive: true });
  await fs.mkdir(path.join(artifact, "sections", "paragraph-2"), { recursive: true });
  await fs.mkdir(path.join(artifact, "sections", "paragraph-3"), { recursive: true });
  const clips = [
    path.join(artifact, "sections", "paragraph-1", "section-footnote.mp4"),
    path.join(artifact, "sections", "paragraph-2", "section-footnote.mp4"),
    path.join(artifact, "sections", "paragraph-3", "section-footnote.mp4")
  ];
  createClip(clips[0], "red", 330);
  createClip(clips[1], "blue", 550);
  createClip(clips[2], "green", 770);
  await concatVideos(path.join(artifact, "final-concatenate-stage.mp4"), [clips[0], clips[0], clips[0]]);

  const result = await analyzeTeachingVideoArtifactDir(artifact);
  assert.equal(result.ok, false);
  assert.equal(result.inconclusive, false);
  assert.equal(result.uniqueFrames, 1);
  assert.ok((result.uniqueAudio ?? 0) >= 1);
});
