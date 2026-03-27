import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

test("wide teaching example keeps karaoke subtitles and generates thumbnail", async () => {
  const source = await fs.readFile("examples/pyash/wide-teaching-video-from-filename.pya", "utf8");
  assert.match(
    source,
    /from filename "\.\.\/\.\.\/module\/draw_from_filename\.pya" ob name draw as wo thumbnail to name draw as wo thumbnail be import do/u
  );
  assert.match(
    source,
    /su name draw widescreen mode ob text "truth" be default ya/u
  );
  assert.match(
    source,
    /su name draw size widescreen be map def[\s\S]*subtitle_margin_ratio ob num 0\.10[\s\S]*footnote_mode ob text "karaoke"/u
  );
  assert.match(
    source,
    /su name teaching demo from filename of ob of manuscript with text of ob of style_prompt be teaching video do[\s\S]*su name thumbnail demo from filename of ob of manuscript with text of ob of style_prompt be draw as wo thumbnail do/u
  );
});

