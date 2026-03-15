import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

import { expandMusicCuts } from "../command/srt_to_music_video_itinerary.mjs";
import { parseSrtToCuts } from "../command/itinerary_io.mjs";

test("expandMusicCuts keeps lyric lines and adds a section transition cut", () => {
  const cuts = expandMusicCuts([
    { since: 0, until: 2, obText: "[verse 1] We polish metal bright" },
    { since: 5, until: 7, obText: "[chorus] Armor shines tonight" }
  ], { gapSeconds: 6 });

  assert.equal(cuts.length, 3);
  assert.equal(cuts[0].obText, "[verse 1] We polish metal bright");
  assert.match(cuts[1].obText, /^\[Transition\] from verse 1 toward chorus$/u);
  assert.equal(cuts[2].obText, "[chorus] Armor shines tonight");
});

test("expandMusicCuts fills long same-section instrumental gaps in 6-second chunks", () => {
  const cuts = expandMusicCuts([
    { since: 0, until: 2, obText: "[verse 1] We polish metal bright" },
    { since: 16, until: 18, obText: "[verse 1] We find the inward flame" }
  ], { gapSeconds: 6 });

  assert.equal(cuts.length, 5);
  assert.equal(cuts[1].obText, "[Transition] continuation of verse 1");
  assert.equal(cuts[2].obText, "[Transition] continuation of verse 1");
  assert.equal(cuts[3].obText, "[Transition] continuation of verse 1");
  assert.equal(cuts[1].since, 2);
  assert.equal(cuts[3].until, 16);
});

test("srt_to_music_video_itinerary command writes transition-aware srt", async () => {
  const dir = await fs.mkdtemp(path.join(process.cwd(), "artifacts", "music-itinerary-"));
  const input = path.join(dir, "captions-sections.srt");
  const output = path.join(dir, "music-cuts.srt");
  await fs.writeFile(
    input,
    [
      "1",
      "00:00:00,000 --> 00:00:02,000",
      "[verse 1] We polish metal bright",
      "",
      "2",
      "00:00:08,000 --> 00:00:10,000",
      "[chorus] Armor shines tonight",
      ""
    ].join("\n"),
    "utf8"
  );

  const { execFile } = await import("node:child_process");
  await new Promise((resolve, reject) => {
    execFile(process.execPath, ["command/srt_to_music_video_itinerary.mjs", input, output], { cwd: process.cwd() }, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });

  const text = await fs.readFile(output, "utf8");
  const cuts = parseSrtToCuts(text);
  assert.equal(cuts.length, 3);
  assert.match(String(cuts[1]?.obText ?? ""), /^\[Transition\] from verse 1 toward chorus$/u);
});
