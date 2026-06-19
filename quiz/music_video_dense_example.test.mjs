import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const readExample = (name) => fs.readFile(new URL(`../examples/pyash/${name}`, import.meta.url), "utf8");

test("dense music video example uses lyric line cuts directly", async () => {
  const text = await readExample("music-video-dense-from-lyrics-and-audio.pya");

  assert.match(
    text,
    /ob ve filename text audio filename text lyrics be input ya/u
  );
  assert.match(
    text,
    /su name cut stage from filename of ob of captions filename stage to name itinerary lyric cuts be cut do/u
  );
  assert.doesNotMatch(
    text,
    /srt_section_collapse\.mjs/u
  );
  assert.doesNotMatch(
    text,
    /during num 999999/u
  );
});

test("dense Andrii people music video example uses Klein workflow with shorts size", async () => {
  const text = await readExample("music-video-dense-andrii-people-from-lyrics-and-audio.pya");

  assert.match(text, /ob ve filename text audio filename text lyrics be input ya/u);
  assert.match(text, /su name width ob num 720 ya/u);
  assert.match(text, /su name height ob num 1280 ya/u);
  assert.match(text, /su name draw character routes be map def/u);
  assert.match(text, /aliases: person or man or woman or people or human or figure or gardener or teacher or farmer or worker or face or portrait or owen or character/u);
  assert.match(text, /su name draw workflow default ob text "andrii_zvorygin_image_flux2_klein_image_edit_4b_distilled" be text ya/u);
  assert.match(text, /mature adult male face, late 30s to 40s, tall adult proportions/u);
  assert.match(text, /Use exactly one primary named character from the base character prompt/u);
  assert.match(text, /Prefer interactive community scenes where the primary named character actively engages with other people/u);
  assert.match(text, /every scene must contain exactly one primary named character from style_prompt/u);
  assert.match(text, /describe each other person with a distinct role/u);
  assert.match(text, /For group scenes, describe two or three specific supporting people/u);
  assert.match(text, /When one or more other people share the activity/u);
  assert.match(text, /Do not leave supporting people as generic neighbour/u);
  assert.match(text, /at least one concrete clothing colour and one visible body or face trait/u);
  assert.match(text, /Keep exactly one primary character in the scene/u);
  assert.match(text, /Use group interaction instead of isolated portraits/u);
  assert.doesNotMatch(text, /handshake|shaking-hands|shakes hands/u);
  assert.match(text, /with name draw size shorts to filename of ob of draw out dir be draw do/u);
  assert.doesNotMatch(text, /with name draw size widescreen/u);
  assert.doesNotMatch(text, /aliases: .*\|/u);
});
