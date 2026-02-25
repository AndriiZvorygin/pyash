import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";

import { concatenateFromNameItinerary } from "../program/verbs/itinerary_media.mjs";
import { forget, doRemember } from "../program/remember/index.mjs";
import { interpret } from "../program/bridge/index.mjs";

function ffmpegAvailable() {
  const probe = spawnSync("ffmpeg", ["-version"], { encoding: "utf8" });
  return probe.status === 0;
}

function createClip(filename, color) {
  const run = spawnSync("ffmpeg", [
    "-y",
    "-f", "lavfi",
    "-i", `color=c=${color}:s=320x240:d=0.5`,
    "-f", "lavfi",
    "-i", "anullsrc=r=24000:cl=mono",
    "-shortest",
    "-c:v", "libx264",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    filename
  ], { encoding: "utf8" });
  if (run.status !== 0) {
    throw new Error(run.stderr || "ffmpeg clip generation failed");
  }
}

test("concatenate can merge section clip itinerary rows", async (t) => {
  if (!ffmpegAvailable()) t.skip("ffmpeg is required");
  forget();
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-concat-clips-"));
  const clipOne = path.join(tmp, "section-1.mp4");
  const clipTwo = path.join(tmp, "section-2.mp4");
  const out = path.join(tmp, "final.mp4");
  createClip(clipOne, "black");
  createClip(clipTwo, "blue");

  doRemember({
    mood: "ya",
    su: { name: "teaching section clips" },
    be: "series",
    ob: {
      series: [
        {
          mood: "ya",
          su: { name: "cut 001" },
          since: { num: 0 },
          until: { num: 1 },
          ob: { filename: clipOne },
          be: "filename"
        },
        {
          mood: "ya",
          su: { name: "cut 002" },
          since: { num: 1 },
          until: { num: 2 },
          ob: { filename: clipTwo },
          be: "filename"
        }
      ]
    }
  });

  const res = await concatenateFromNameItinerary({
    mood: "do",
    su: { name: "final concatenate stage" },
    be: "concatenate",
    from: { name: "teaching section clips" },
    fromstate: { wo: "itinerary" },
    become: { wo: "video" },
    to: { filename: out }
  });

  assert.equal(res?.be, "concatenate");
  assert.equal(String(res?.ob?.filename ?? ""), out);
  await fs.access(out);
  await fs.access(path.join(tmp, "final.metadata.pya"));
});

test("concatenate resolves from name series signature", async (t) => {
  if (!ffmpegAvailable()) t.skip("ffmpeg is required");
  forget();
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-concat-series-sig-"));
  const clipOne = path.join(tmp, "section-1.mp4");
  const clipTwo = path.join(tmp, "section-2.mp4");
  const out = path.join(tmp, "final.mp4");
  createClip(clipOne, "black");
  createClip(clipTwo, "blue");

  doRemember({
    mood: "ya",
    su: { name: "teaching section clips" },
    be: "series",
    ob: {
      series: [
        {
          mood: "ya",
          su: { name: "cut 001" },
          since: { num: 0 },
          until: { num: 1 },
          ob: { filename: clipOne },
          be: "filename"
        },
        {
          mood: "ya",
          su: { name: "cut 002" },
          since: { num: 1 },
          until: { num: 2 },
          ob: { filename: clipTwo },
          be: "filename"
        }
      ]
    }
  });

  await interpret({
    mood: "do",
    su: { name: "final concatenate stage" },
    be: "concatenate",
    from: { name: "teaching section clips" },
    fromstate: { wo: "itinerary" },
    become: { wo: "video" },
    to: { filename: out }
  });

  await fs.access(out);
});
