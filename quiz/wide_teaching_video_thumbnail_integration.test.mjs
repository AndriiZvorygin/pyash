import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

test("wide teaching video pipeline selects thumbnail input from generated metadata", async () => {
  const text = await fs.readFile("examples/pyash/wide-teaching-video-from-filename.pya", "utf8");
  assert.match(text, /thumbnail_checkpoint_from_metadata\.mjs/);
  assert.match(text, /final-concatenate-stage\.metadata\.pya/);
  assert.match(text, /thumbnail-input-source\.txt/);
  assert.match(text, /thumbnail-checkpoint\.pya/);
  assert.match(text, /thumbnail_render_from_checkpoint\.mjs/);
  assert.match(text, /text text thumbnail_mode be input ya/);
  assert.match(text, /from text "checkpoint" then/);
  assert.match(text, /su name thumbnail checkpoint stage ob text of ob of thumbnail checkpoint cmd be command do/);
  assert.match(text, /su name thumbnail render stage ob text of ob of thumbnail render cmd be command do/);
});

test("wide teaching thumbnail integration verifies canonical source file path", async () => {
  const sourcePath = "module/brief_video.pya";
  const stat = await fs.stat(sourcePath);
  assert.ok(stat.isFile(), "brief_video source file should exist");
});
