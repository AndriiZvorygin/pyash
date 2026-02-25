import test from "node:test";
import assert from "node:assert/strict";

import { parseArgs } from "../command/video_heading_burn.mjs";

test("video heading burn parseArgs accepts defaults", () => {
  const opts = parseArgs([
    "node",
    "command/video_heading_burn.mjs",
    "in.mp4",
    "out.mp4"
  ]);
  assert.equal(opts.inputVideo, "in.mp4");
  assert.equal(opts.outputVideo, "out.mp4");
  assert.equal(opts.seconds, 1);
  assert.equal(opts.yRatio, 0.60);
});

test("video heading burn parseArgs validates seconds and y-ratio bands", () => {
  assert.throws(
    () => parseArgs([
      "node",
      "command/video_heading_burn.mjs",
      "in.mp4",
      "out.mp4",
      "--seconds",
      "0"
    ]),
    /seconds must be between 0 and 5/u
  );

  assert.throws(
    () => parseArgs([
      "node",
      "command/video_heading_burn.mjs",
      "in.mp4",
      "out.mp4",
      "--y-ratio",
      "0.8"
    ]),
    /y-ratio must be between 0.45 and 0.75/u
  );
});
