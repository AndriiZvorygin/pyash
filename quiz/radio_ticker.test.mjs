#!/usr/bin/env node
// The words of a song, and the time they are sung.
//
// The station plays a song; a listener wants to read along with it. The words
// are the ones the house already heard: the transcript of the song, with the
// time of every line.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  lineAt,
  parseSheet,
  parseSrt,
  readWords,
  splitSentences,
  alignedPathFor,
  timedLines,
  transcriptPathFor,
  withinSong
} from "../program/library/radio/ticker.mjs";

const SRT = [
  "1",
  "00:00:00,000 --> 00:00:30,000",
  "We sit quietly in stillness. Our heavy fears dissolve and disappear.",
  "",
  "2",
  "00:00:30,000 --> 00:01:00,000",
  "Love returns a thousandfold. Walking spirits find their joy.",
  ""
].join("\n");

async function makeTempDir(prefix = "yiniana-ticker-") {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

test("the transcript of a song lies beside its sheet, and the words beside that", () => {
  assert.equal(transcriptPathFor("/radio/lyrics/song-pleasure.txt"), "/radio/lyrics/song-pleasure.srt");
  assert.equal(alignedPathFor("/radio/lyrics/song-pleasure.txt"), "/radio/lyrics/song-pleasure.aligned.srt");
  assert.equal(transcriptPathFor(""), "");
});

test("the words of a transcript are a sentence at a time, each with its own time", () => {
  const lines = parseSrt(SRT);

  assert.equal(lines.length, 4, "the two segments hold four sentences");
  assert.equal(lines[0].text, "We sit quietly in stillness.");
  assert.equal(lines[0].start, 0);
  assert.ok(lines[0].end <= lines[1].start, "the sentences do not overlap");
  assert.ok(lines[1].start < 30, "the second sentence of a segment comes before the next segment");
  assert.ok(lines[3].end <= 60, "the last line ends with its segment");
});

test("a line of words is split into the sentences that carry it", () => {
  assert.deepEqual(splitSentences("One. Two! Three? Four"), ["One.", "Two!", "Three?", "Four"]);
  assert.deepEqual(splitSentences("   "), []);
});

test("the words of a sheet are the lines of the song, each with its section", () => {
  const words = parseSheet([
    "[Verse]",
    "We sit quietly in stillness to align with the Father above.",
    "",
    "[Chorus]",
    "Pleasure flows through unity and service"
  ].join("\n"));

  assert.equal(words.length, 2);
  assert.equal(words[0].section, "Verse");
  assert.equal(words[1].section, "Chorus");
});

test("the words of the song, placed at the times, are what the ticker follows", () => {
  const words = timedLines({ aligned: SRT, sheet: "[Verse]\nThe words of the sheet\n", durationSeconds: 60 });

  assert.equal(words.source, "lyrics");
  assert.equal(words.lines.length, 4);
});

test("a song the house could not align is placed on the words that were heard", () => {
  const words = timedLines({
    sheet: "[Verse]\nDarkness births a holy light deep within our soul.\n[Chorus]\nWe accept creation calm to heal the whole universe\n",
    transcript: [
      "1",
      "00:00:00,000 --> 00:00:04,000",
      "Darkness births a holy light deep within our soul",
      "",
      "2",
      "00:00:30,000 --> 00:00:34,000",
      "We accept creation calm to heal the whole universe",
      ""
    ].join("\n"),
    durationSeconds: 100
  });

  assert.equal(words.source, "song");
  assert.equal(words.lines.length, 2);
  assert.equal(words.lines[0].start, 0, "the first line is sung at the start of the song");
  assert.equal(words.lines[1].start, 30, "the chorus is sung where it was heard");
});

test("a line the song never sang is left out of the words", () => {
  const words = timedLines({
    sheet: "[Verse]\nA verse the render never sang at all\n[Chorus]\nDarkness births a holy light deep within our soul\n",
    transcript: [
      "1",
      "00:00:00,000 --> 00:00:04,000",
      "Darkness births a holy light deep within our soul",
      ""
    ].join("\n"),
    durationSeconds: 100
  });

  assert.equal(words.source, "song");
  assert.equal(words.lines.length, 1);
  assert.match(words.lines[0].text, /Darkness births/);
});

test("the words of a song stay inside the length of the song", () => {
  const words = timedLines({
    aligned: [
      "1",
      "00:00:00,000 --> 00:00:30,000",
      "The first line of the song",
      "",
      "2",
      "00:02:30,000 --> 00:03:00,000",
      "A line the hear lane placed past the end of the song",
      ""
    ].join("\n"),
    durationSeconds: 175
  });

  assert.equal(words.source, "lyrics");
  assert.equal(words.lines.length, 2, "the line the hear lane placed late is still part of the song");
  assert.equal(words.lines[0].end, 30);
  assert.equal(words.lines[1].end, 175, "the last line is cut at the end of the song");
});

test("the lines of a song can be cut at the end of the song", () => {
  const cut = withinSong([
    { start: 0, end: 10, text: "first" },
    { start: 170, end: 180, text: "last" }
  ], 175);

  assert.equal(cut.length, 2);
  assert.equal(cut[1].end, 175, "the last line is cut at the end of the song");
  assert.deepEqual(withinSong([{ start: 200, end: 210 }], 175), [], "a line after the song is left out");
});

test("a song that was never heard falls back to its sheet, with the lines spread over the song", () => {
  const words = timedLines({
    sheet: "[Verse]\nFirst line\n[Chorus]\nSecond line\n",
    durationSeconds: 100
  });

  assert.equal(words.source, "sheet");
  assert.equal(words.lines.length, 2);
  assert.equal(words.lines[0].start, 8, "the first line comes after the opening of the song");
  assert.ok(words.lines[0].end <= words.lines[1].start, "the lines do not overlap");
  assert.ok(words.lines[1].end <= 100, "the last line ends with the song");
});

test("the line that is sung at that moment is the one that covers it", () => {
  const lines = [
    { start: 0, end: 10, text: "first" },
    { start: 10, end: 20, text: "second" }
  ];

  assert.equal(lineAt(lines, 5), 0);
  assert.equal(lineAt(lines, 15), 1);
  assert.equal(lineAt(lines, 99), 1, "after the last line the last line is still the one");
  assert.equal(lineAt([], 5), -1);
});

test("the words of a song are read from the files that hold them", async () => {
  const root = await makeTempDir();
  const sheetPath = path.join(root, "song-pleasure.txt");
  const transcriptPath = path.join(root, "song-pleasure.srt");
  const alignedPath = path.join(root, "song-pleasure.aligned.srt");
  await fs.writeFile(sheetPath, "[Verse]\nWe sit quietly in stillness.\n");
  await fs.writeFile(transcriptPath, SRT);
  await fs.writeFile(alignedPath, SRT);

  const heard = await readWords({ sheetPath, alignedPath, durationSeconds: 60 });
  assert.equal(heard.source, "lyrics");

  await fs.rm(alignedPath, { force: true });
  const placed = await readWords({ sheetPath, alignedPath, transcriptPath, durationSeconds: 60 });
  assert.equal(placed.source, "song", "a song whose words were not aligned is placed on the words heard");

  await fs.rm(transcriptPath, { force: true });
  const sheet = await readWords({ sheetPath, alignedPath, transcriptPath, durationSeconds: 60 });
  assert.equal(sheet.source, "sheet", "a song whose words were never heard shows its sheet");

  await fs.rm(root, { recursive: true, force: true });
});
