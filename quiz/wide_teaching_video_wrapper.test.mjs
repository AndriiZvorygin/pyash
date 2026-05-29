import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

test("wide teaching wrapper keeps baseline and optional thumbnail checkpoint stage", async () => {
  const text = await fs.readFile("examples/pyash/wide-teaching-video-from-filename.pya", "utf8");
  assert.match(text, /ob ve filename text manuscript text text style_prompt text text thumbnail_mode be input ya/);
  assert.match(text, /su name teaching demo from filename of ob of manuscript with text of ob of style_prompt be teaching video wide do/);
  assert.match(text, /exists su name subtitle_mode ob text "karaoke" be default ya/);
  assert.match(
    text,
    /exists su name draw size widescreen be map def[\s\S]*footnote_mode ob text "karaoke" ya[\s\S]*prah/u
  );
  assert.match(text, /thumbnail_checkpoint_from_metadata\.mjs/);
  assert.match(text, /thumbnail-checkpoint\.pya/);
  assert.match(text, /thumbnail-input-source\.txt/);
  assert.match(text, /ob name text thumbnail mode chosen be equally from text "" then ob text "off" to name text thumbnail mode chosen be text do/);
  assert.match(text, /ob name text thumbnail mode chosen be equally from text "truth" then ob text "checkpoint" to name text thumbnail mode chosen be text do/);
  assert.match(text, /thumbnail_render_from_checkpoint\.mjs/);
});

test("wide teaching Andrii people example configures broad character route", async () => {
  const text = await fs.readFile("examples/pyash/wide-teaching-video-andrii-people-from-filename.pya", "utf8");
  assert.match(text, /su name draw character routes be map def/u);
  assert.match(text, /aliases: person or man or woman or people or human/u);
  assert.match(text, /workflow: andrii_zvorygin_image_flux2_klein_image_edit_4b_distilled/u);
  assert.match(text, /white sclera\. irises visible/u);
  assert.match(text, /su name teaching demo from filename of ob of manuscript with text of ob of style_prompt be teaching video wide do/u);
});
