import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

test("wide teaching video pipeline selects thumbnail input from generated metadata", async () => {
  const text = await fs.readFile("examples/pyash/wide-teaching-video-from-filename.pya", "utf8");
  assert.match(text, /thumbnail_input_select_from_metadata\.mjs/);
  assert.match(text, /final-concatenate-stage\.metadata\.pya/);
  assert.match(text, /thumbnail-input-source\.txt/);
  assert.match(text, /thumbnail-input-selection\.json/);
  assert.match(text, /su name thumbnail variant mode ob text "triple" ya/);
  assert.match(text, /exists su name thumbnail variant label ob text "" be default ya/);
  assert.match(text, /su name thumbnail source filename stage ob name text thumbnail source path to name filename thumbnail source filename be filename do/);
  assert.match(text, /su name thumbnail demo from filename of ob of thumbnail source filename stage with text of ob of style_prompt be draw as wo thumbnail do/);
});

test("wide teaching thumbnail integration verifies canonical source file path", async () => {
  const familyPath = "know/input/family_to_planetary.txt";
  const stat = await fs.stat(familyPath);
  assert.ok(stat.isFile(), "family_to_planetary source file should exist");
});
