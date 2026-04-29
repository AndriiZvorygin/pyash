import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

test("wide teaching example keeps karaoke subtitles and generates thumbnail", async () => {
  const source = await fs.readFile("examples/pyash/wide-teaching-video-from-filename.pya", "utf8");
  assert.match(
    source,
    /su name draw widescreen mode ob text "truth" ya/u
  );
  assert.match(
    source,
    /exists su name draw size widescreen be map def[\s\S]*subtitle_margin_ratio ob num 0\.10[\s\S]*footnote_mode ob text "karaoke"/u
  );
  assert.match(
    source,
    /su name teaching demo from filename of ob of manuscript with text of ob of style_prompt be teaching video wide do/u
  );
  assert.match(
    source,
    /thumbnail_checkpoint_from_metadata\.mjs/u
  );
  assert.match(
    source,
    /thumbnail_render_from_checkpoint\.mjs/u
  );
});
