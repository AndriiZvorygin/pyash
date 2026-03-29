import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";

import { concatenateAudioFromNameSeries } from "../program/verbs/itinerary_media.mjs";
import { forget, doRemember } from "../program/remember/index.mjs";
import { interpret } from "../program/bridge/index.mjs";

function ffmpegAvailable() {
  const probe = spawnSync("ffmpeg", ["-version"], { encoding: "utf8" });
  return probe.status === 0;
}

function createAudioClip(filename, freq = 440) {
  const run = spawnSync("ffmpeg", [
    "-y",
    "-f", "lavfi",
    "-i", `sine=frequency=${freq}:duration=0.35`,
    "-c:a", "libopus",
    filename
  ], { encoding: "utf8" });
  if (run.status !== 0) {
    throw new Error(run.stderr || "ffmpeg audio generation failed");
  }
}

test("concatenate can merge nested album song series into one audio file", async (t) => {
  if (!ffmpegAvailable()) {
    t.skip("ffmpeg is required");
    return;
  }
  forget();
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-concat-audio-series-"));
  const a = path.join(tmp, "a.opus");
  const b = path.join(tmp, "b.opus");
  const out = path.join(tmp, "album.opus");
  createAudioClip(a, 440);
  createAudioClip(b, 660);

  doRemember({
    mood: "ya",
    su: { name: "seed songs" },
    be: "series",
    ob: {
      series: [
        {
          mood: "ya",
          su: { name: "item 001" },
          be: "map",
          ob: {
            map: {
              audio: { mood: "ya", su: { name: "audio" }, ob: { filename: a }, be: "filename" }
            }
          }
        }
      ]
    }
  });
  doRemember({
    mood: "ya",
    su: { name: "awake songs" },
    be: "series",
    ob: {
      series: [
        {
          mood: "ya",
          su: { name: "item 001" },
          be: "map",
          ob: {
            map: {
              audio: { mood: "ya", su: { name: "audio" }, ob: { filename: b }, be: "filename" }
            }
          }
        }
      ]
    }
  });
  doRemember({
    mood: "ya",
    su: { name: "album song series stage" },
    be: "series",
    ob: {
      series: [
        {
          mood: "ya",
          su: { name: "seed songs row" },
          be: "map",
          ob: {
            map: {
              seed: { mood: "ya", su: { name: "seed" }, ob: { name: "seed songs", nameTypeWords: ["series"] }, be: "series" }
            }
          }
        },
        {
          mood: "ya",
          su: { name: "awake songs row" },
          be: "map",
          ob: {
            map: {
              awake: { mood: "ya", su: { name: "awake" }, ob: { name: "awake songs", nameTypeWords: ["series"] }, be: "series" }
            }
          }
        }
      ]
    }
  });

  const res = await concatenateAudioFromNameSeries({
    mood: "do",
    su: { name: "album concatenate stage" },
    be: "concatenate",
    from: { name: "album song series stage" },
    fromstate: { wo: "series" },
    become: { wo: "audio" },
    to: { filename: out }
  });
  assert.equal(res?.be, "concatenate");
  assert.equal(String(res?.ob?.filename ?? ""), out);
  await fs.access(out);
});

test("concatenate audio resolves signature through interpret", async (t) => {
  if (!ffmpegAvailable()) {
    t.skip("ffmpeg is required");
    return;
  }
  forget();
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pyash-concat-audio-sig-"));
  const a = path.join(tmp, "a.opus");
  const out = path.join(tmp, "album.opus");
  createAudioClip(a, 440);

  doRemember({
    mood: "ya",
    su: { name: "album song series stage" },
    be: "series",
    ob: {
      series: [
        {
          mood: "ya",
          su: { name: "item 001" },
          be: "map",
          ob: {
            map: {
              audio: { mood: "ya", su: { name: "audio" }, ob: { filename: a }, be: "filename" }
            }
          }
        }
      ]
    }
  });

  await interpret({
    mood: "do",
    su: { name: "album concatenate stage" },
    be: "concatenate",
    from: { name: "album song series stage" },
    fromstate: { wo: "series" },
    become: { wo: "audio" },
    to: { filename: out }
  });
  await fs.access(out);
});
