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
});
