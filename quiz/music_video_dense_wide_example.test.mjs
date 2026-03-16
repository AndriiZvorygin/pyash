import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

test("wide dense music video example uses lyric line cuts with widescreen draws", async () => {
  const text = await fs.readFile(new URL("../examples/pyash/wide-music-video-dense-from-lyrics-and-audio.pya", import.meta.url), "utf8");

  assert.match(text, /ob ve filename text audio filename text lyrics be input ya/u);
  assert.match(text, /su name width ob num 1280 ya/u);
  assert.match(text, /su name height ob num 720 ya/u);
  assert.match(text, /su name cut stage from filename of ob of captions filename stage to name itinerary lyric cuts be cut do/u);
  assert.match(text, /with name draw size widescreen to filename of ob of draw out dir be draw do/u);
  assert.doesNotMatch(text, /srt_section_collapse\.mjs/u);
  assert.doesNotMatch(text, /during num 999999/u);
});
