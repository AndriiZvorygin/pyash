import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

test("lyrics and audio music video example uses stable footnote tail", async () => {
  const text = await fs.readFile(new URL("../examples/pyash/music-video-from-lyrics-and-audio.pya", import.meta.url), "utf8");

  assert.match(
    text,
    /from filename "\.\.\/\.\.\/module\/video_common\.pya" ob name footnote mode to name footnote mode be import do/u
  );
  assert.match(
    text,
    /su name footnote stage from filename of ob of captions filename stage with filename of ob of result stage to filename of ob of footnote filename stage by num of ob of subtitle margin ratio override as text "karaoke" be footnote mode do/u
  );
  assert.match(
    text,
    /ob text of ob of footnote filename stage to name text opened video path be text do/u
  );
  assert.match(
    text,
    /su name result out stage ob filename of ob of footnote filename stage to name filename result out be filename do/u
  );
});
