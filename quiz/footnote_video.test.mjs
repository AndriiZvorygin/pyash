import test from "node:test";
import assert from "node:assert/strict";

import { parseArgs, buildAssFromSrt, resolveRenderOutputPath } from "../command/footnote_video.mjs";

test("footnote_video parseArgs accepts karaoke mode", () => {
  const opts = parseArgs([
    "node",
    "command/footnote_video.mjs",
    "in.mp4",
    "in.srt",
    "out.mp4",
    "--mode",
    "karaoke",
    "--font-size",
    "48",
    "--margin-v",
    "90",
    "--font-name",
    "Noto Sans"
  ]);
  assert.equal(opts.mode, "karaoke");
  assert.equal(opts.fontSize, 48);
  assert.equal(opts.marginV, 90);
  assert.equal(opts.fontName, "Noto Sans");
});

test("footnote_video parseArgs accepts wordflow mode", () => {
  const opts = parseArgs([
    "node",
    "command/footnote_video.mjs",
    "in.mp4",
    "in.srt",
    "out.mp4",
    "--mode",
    "wordflow"
  ]);
  assert.equal(opts.mode, "wordflow");
});

test("footnote_video parseArgs accepts margin ratio", () => {
  const opts = parseArgs([
    "node",
    "command/footnote_video.mjs",
    "in.mp4",
    "in.srt",
    "out.mp4",
    "--mode",
    "karaoke",
    "--margin-ratio",
    "0.1"
  ]);
  assert.equal(opts.mode, "karaoke");
  assert.equal(opts.marginRatio, 0.1);
});

test("footnote_video buildAssFromSrt emits karaoke timing tags", () => {
  const srt = [
    "1",
    "00:00:00,000 --> 00:00:02,000",
    "love God now",
    "",
    "2",
    "00:00:02,000 --> 00:00:04,000",
    "with all heart",
    ""
  ].join("\n");
  const ass = buildAssFromSrt(srt, { mode: "karaoke", fontSize: 52, marginV: 70, fontName: "DejaVu Sans" });
  assert.match(ass, /\[Events\]/u);
  assert.match(ass, /Dialogue:/u);
  assert.match(ass, /\{\\k/u);
});

test("footnote_video buildAssFromSrt emits plain text subtitles", () => {
  const srt = [
    "1",
    "00:00:00,000 --> 00:00:01,000",
    "plain line",
    ""
  ].join("\n");
  const ass = buildAssFromSrt(srt, { mode: "plain" });
  assert.match(ass, /plain line/u);
  assert.doesNotMatch(ass, /\{\\k/u);
});

test("footnote_video buildAssFromSrt emits grouped dialogue in wordflow mode", () => {
  const srt = [
    "1",
    "00:00:00,000 --> 00:00:02,000",
    "we all love God now",
    ""
  ].join("\n");
  const ass = buildAssFromSrt(srt, { mode: "wordflow", maxLineChars: 10 });
  const lines = ass.split("\n").filter((line) => line.startsWith("Dialogue:"));
  assert.ok(lines.length >= 2);
  assert.ok(lines.some((line) => /,.*\s+.*$/u.test(line)));
  assert.ok(lines.some((line) => /,now$/u.test(line)));
});

test("footnote_video resolveRenderOutputPath avoids in-place writes", () => {
  const same = resolveRenderOutputPath("/tmp/in.mp4", "/tmp/in.mp4");
  assert.notEqual(same, "/tmp/in.mp4");
  assert.match(same, /footnote-tmp-/u);
  const different = resolveRenderOutputPath("/tmp/in.mp4", "/tmp/out.mp4");
  assert.equal(different, "/tmp/out.mp4");
});

test("footnote_video style uses white text with black outline and bottom-zone margin", () => {
  const srt = [
    "1",
    "00:00:00,000 --> 00:00:03,000",
    "one two three four five six",
    ""
  ].join("\n");
  const ass = buildAssFromSrt(srt, {
    mode: "wordflow",
    fontSize: 72,
    marginV: 720,
    marginLR: 108,
    playResX: 1080,
    playResY: 1920
  });
  const styleLine = ass.split("\n").find((line) => line.startsWith("Style: Default,"));
  assert.ok(styleLine);
  assert.match(styleLine, /,72,/u);
  assert.match(styleLine, /,1,7\.92,1\.8,2,108,108,720,1$/u);
});
