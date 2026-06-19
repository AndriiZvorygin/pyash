import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

test("teaching video module supports beard-guide toggle and example disables it", async () => {
  const moduleSource = await fs.readFile("module/brief_video.pya", "utf8");
  assert.match(
    moduleSource,
    /exists su name draw prompt beard guide enabled ob bool truth be default ya/u
  );
  assert.match(
    moduleSource,
    /draw prompt style assembled[\s\S]*ob text of ob of draw prompt style beard default to name draw prompt style assembled be plus do/u
  );
  assert.match(
    moduleSource,
    /draw prompt style beard default/u
  );

  const exampleSource = await fs.readFile("examples/pyash/teaching-video-from-filename.pya", "utf8");
  assert.match(
    exampleSource,
    /exists su name draw prompt style beard default ob text "" be default ya/u
  );
});


test("regular teaching Andrii people example configures shorts character route", async () => {
  const source = await fs.readFile("examples/pyash/teaching-video-andrii-people-from-filename.pya", "utf8");
  assert.match(source, /ob ve filename text manuscript text text style_prompt be input ya/u);
  assert.match(source, /su name draw widescreen mode ob text "lie" be default ya/u);
  assert.match(source, /exists su name draw size shorts be map def[\s\S]*width ob num 720[\s\S]*height ob num 1280/u);
  assert.match(source, /su name draw character routes be map def/u);
  assert.match(source, /aliases: person or man or woman or people or human/u);
  assert.match(source, /workflow: andrii_zvorygin_image_flux2_klein_image_edit_4b_distilled/u);
  assert.match(source, /one Andrii only: broad pale canvas gardener hat, mostly straight long brown hair tucked under it, with a few strands visible, long brown auburn beard with copper tones/u);
  assert.match(source, /white sclera\. irises visible/u);
  assert.match(source, /su name teaching demo from filename of ob of manuscript with text of ob of style_prompt be teaching video do/u);
  assert.doesNotMatch(source, /be teaching video wide do/u);
});
