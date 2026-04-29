import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

test("wide wrapper widescreen override is additive and keeps semantic subtitle fields", async () => {
  const text = await fs.readFile("examples/pyash/wide-teaching-video-from-filename.pya", "utf8");
  assert.match(
    text,
    /exists su name draw size widescreen be map def[\s\S]*su name width ob num 1280 ya[\s\S]*su name height ob num 720 ya[\s\S]*su name negative prompt ob text[\s\S]*su name thumbnail_heading_y_ratio ob num 0\.42 ya[\s\S]*su name video_heading_y_ratio ob num 0\.60 ya[\s\S]*su name subtitle_margin_ratio ob num 0\.10 ya[\s\S]*su name footnote_mode ob text "karaoke" ya[\s\S]*prah/u
  );
});

test("video common resolver keeps widescreen override additive and preserves karaoke fallback", async () => {
  const text = await fs.readFile("module/video_common.pya", "utf8");
  assert.match(text, /exists su name footnote mode override ob text "" be default ya/u);
  assert.match(
    text,
    /su name current footnote mode to name text footnote mode current be ceremony def[\s\S]*ob text of footnote mode override to name text footnote mode current be text do[\s\S]*draw widescreen mode be equally from text "truth" then ob text of footnote_mode of draw size widescreen[\s\S]*su name footnote mode current ret[\s\S]*prah/u
  );
  assert.match(
    text,
    /su name current thumbnail heading y ratio to name num thumbnail heading y ratio be ceremony def[\s\S]*ob num of thumbnail_heading_y_ratio of draw size widescreen to name num thumbnail heading y ratio be plus do[\s\S]*thumbnail heading y ratio be equally from num 0 then ob num of thumbnail_heading_y_ratio of draw size widescreen canonical to name num thumbnail heading y ratio be plus do[\s\S]*prah/u
  );
  assert.match(
    text,
    /su name current video heading y ratio to name num video heading y ratio be ceremony def[\s\S]*ob num of video_heading_y_ratio of draw size widescreen to name num video heading y ratio be plus do[\s\S]*video heading y ratio be equally from num 0 then ob num of video_heading_y_ratio of draw size widescreen canonical to name num video heading y ratio be plus do[\s\S]*prah/u
  );
});
