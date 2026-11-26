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
  transcriptPathFor
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
  await fs.writeFile(sheetPath, "[Verse]\nThe words of the sheet\n");
  await fs.writeFile(transcriptPath, SRT);

  const heard = await readWords({ sheetPath, alignedPath: transcriptPath, durationSeconds: 60 });
  assert.equal(heard.source, "lyrics");

  await fs.rm(transcriptPath, { force: true });
  const sheet = await readWords({ sheetPath, alignedPath: transcriptPath, durationSeconds: 60 });
  assert.equal(sheet.source, "sheet", "a song whose words were not placed shows its sheet");

  await fs.rm(root, { recursive: true, force: true });
});
