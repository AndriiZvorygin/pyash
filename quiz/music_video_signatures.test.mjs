import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

test("music video footnotes use karaoke mode explicitly", async () => {
  const text = await fs.readFile(new URL("../module/music_video.pya", import.meta.url), "utf8");

  assert.doesNotMatch(
    text,
    /from filename "\.\/video_common\.pya" ob name current footnote mode to name current footnote mode be import do/u
  );
  assert.match(
    text,
    /ob text "karaoke" to name text footnote mode current be text do/u
  );
  assert.match(
    text,
    /from filename of ob of captions output stage with filename of ob of concatenate stage to filename of ob of footnote filename stage by num of ob of subtitle margin ratio stage as text of ob of footnote mode stage be footnote mode do/u
  );
  assert.match(
    text,
    /If current_cut is a transition or instrumental bridge, use previous_cut and next_cut to create an in-between visual inspired by the lyric section that just ended or is about to begin\./u
  );
  assert.match(
    text,
    /su name music video from filename audio with filename lyrics be ceremony def/u
  );
  assert.match(
    text,
    /node command\/lyrics_to_srt_from_timing\.mjs/u
  );
  assert.match(
    text,
    /node command\/srt_to_music_video_itinerary\.mjs/u
  );
});
