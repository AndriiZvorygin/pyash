import test from "node:test";
import assert from "node:assert/strict";

import { parseArgs, buildAssFromSrt } from "../command/footnote_video.mjs";

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
