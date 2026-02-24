import test from "node:test";
import assert from "node:assert/strict";

import { parseArgs } from "../command/thumbnail_heading_burn.mjs";

test("thumbnail heading burn parseArgs accepts defaults", () => {
  const opts = parseArgs([
    "node",
    "command/thumbnail_heading_burn.mjs",
    "in.png",
    "out.png"
  ]);
  assert.equal(opts.inputImage, "in.png");
  assert.equal(opts.outputImage, "out.png");
  assert.equal(opts.yRatio, 0.42);
});

test("thumbnail heading burn parseArgs validates y-ratio band", () => {
  assert.throws(
    () => parseArgs([
      "node",
      "command/thumbnail_heading_burn.mjs",
      "in.png",
      "out.png",
      "--y-ratio",
      "0.8"
    ]),
    /y-ratio must be between 0.38 and 0.48/u
  );
  assert.throws(
    () => parseArgs([
      "node",
      "command/thumbnail_heading_burn.mjs",
      "in.png",
      "out.png",
      "--y-ratio",
      "0.3"
    ]),
    /y-ratio must be between 0.38 and 0.48/u
  );
});
