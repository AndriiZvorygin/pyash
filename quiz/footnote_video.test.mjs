import test from "node:test";
import assert from "node:assert/strict";

import { buildAssFromSrt } from "../command/footnote_video.mjs";

function assTimeToSeconds(value) {
  const m = String(value).match(/^(\d+):(\d{2}):(\d{2})\.(\d{2})$/);
  if (!m) throw new Error(`bad ass time: ${value}`);
  const h = Number(m[1]);
  const min = Number(m[2]);
  const s = Number(m[3]);
  const cs = Number(m[4]);
  return (h * 3600) + (min * 60) + s + (cs / 100);
}

function parseDialogues(ass) {
  return String(ass)
    .split("\n")
    .filter((line) => line.startsWith("Dialogue:"))
    .map((line) => {
      const parts = line.split(",");
      return {
        start: assTimeToSeconds(parts[1]),
        end: assTimeToSeconds(parts[2])
      };
    });
}

const shortSrt = `1
00:00:00,000 --> 00:00:00,060
Of the One Infinite Creator's light.

2
00:00:00,060 --> 00:00:00,120
We call upon the Earth below,

3
00:00:00,120 --> 00:00:00,180
Its healing strength, its steady flow.
`;

for (const mode of ["karaoke", "wordflow"]) {
  test(`footnote ${mode} does not create overlapping dialogues for ultra-short cues`, () => {
    const ass = buildAssFromSrt(shortSrt, {
      mode,
      fontSize: 28,
      playResX: 720,
      playResY: 1280,
      maxLineChars: 20
    });
    const dialogues = parseDialogues(ass);
    assert.ok(dialogues.length > 0, "expected at least one dialogue");
    for (let i = 0; i < dialogues.length - 1; i += 1) {
      assert.ok(
        dialogues[i].end <= dialogues[i + 1].start,
        `expected non-overlap at index ${i}: ${dialogues[i].end} <= ${dialogues[i + 1].start}`
      );
    }
  });
}
