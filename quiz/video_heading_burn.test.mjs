import test from "node:test";
import assert from "node:assert/strict";

import {
  layoutHeadingLines,
  parseArgs,
  resolveHeadingTopMargin,
  resolveHeadingText,
  truncateHeadingWords
} from "../command/video_heading_burn.mjs";

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
  assert.equal(opts.fontScale, 1);
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
    /y-ratio must be between 0.05 and 0.75/u
  );

  assert.throws(
    () => parseArgs([
      "node",
      "command/video_heading_burn.mjs",
      "in.mp4",
      "out.mp4",
      "--font-scale",
      "0.2"
    ]),
    /font-scale must be between 0.25 and 2/u
  );
});

test("video heading burn preserves explicit multi-line headings", () => {
  const opts = parseArgs([
    "node",
    "command/video_heading_burn.mjs",
    "in.mp4",
    "out.mp4",
    "--text",
    " Secure   Homes.\r\nSafer Neighbourhoods. ",
    "--y-ratio",
    "0.24"
  ]);
  const text = resolveHeadingText(opts);
  assert.equal(text, "Secure Homes.\nSafer Neighbourhoods.");
  assert.equal(truncateHeadingWords(text), text);
  assert.deepEqual(layoutHeadingLines(text), ["Secure Homes.", "Safer Neighbourhoods."]);
  assert.equal(opts.yRatio, 0.24);
});

test("video heading burn keeps ASS fallback aligned to the lower y-ratio anchor", () => {
  assert.equal(resolveHeadingTopMargin({
    height: 1920,
    yRatio: 0.25,
    fontSize: 111,
    lineCount: 3
  }), 80);
  assert.equal(resolveHeadingTopMargin({
    height: 1920,
    yRatio: 0.05,
    fontSize: 111,
    lineCount: 3
  }), 8);
});
