#!/usr/bin/env node
// The words of a sheet, placed at the times the house heard them.
//
// The hear lane says what it heard, with the time of every phrase. The sheet
// says what the song is meant to sing. The placement brings the two together,
// so a listener reads the line that is being sung.

import test from "node:test";
import assert from "node:assert/strict";

import {
  heardWords,
  normalizeWord,
  placeSheetLines,
  splitWords,
  wordsRoughlyMatch
} from "../program/library/placement.mjs";

const CUES = [
  { start: 0, end: 4, text: "Darkness births a holy light deep within" },
  { start: 4, end: 8, text: "our souls Shadwes fade as we stand away" },
  { start: 8, end: 12, text: "from all control Our heart opens wide" },
  { start: 12, end: 16, text: "to find true love inside" }
];

const SHEET = [
  { text: "Darkness births a holy light deep within our soul.", section: "Verse" },
  { text: "Shadows fade as we stand away from all control.", section: "Verse" },
  { text: "Our heart opens wide to find true love inside.", section: "Verse" }
];

test("a word is written down as the house counts it", () => {
  assert.equal(normalizeWord("Love,"), "love");
  assert.equal(normalizeWord("SPIRITS"), "spirits");
  assert.equal(normalizeWord("well-known"), "wellknown");
  assert.deepEqual(splitWords("We sing, and we listen"), ["we", "sing", "and", "we", "listen"]);
});

test("a word the house heard slightly wrong is still the same word", () => {
  assert.ok(wordsRoughlyMatch("soul", "souls"));
  assert.ok(wordsRoughlyMatch("births", "bursts"), "one letter apart is the same word");
  assert.ok(!wordsRoughlyMatch("soul", "shadow"), "two words apart are two words");
  assert.ok(!wordsRoughlyMatch("", "soul"), "an empty word matches nothing");
});

test("the words of a heard song carry the time they were heard at", () => {
  const words = heardWords([{ start: 0, end: 4, text: "one two" }]);

  assert.equal(words.length, 2);
  assert.equal(words[0].word, "one");
  assert.equal(words[0].time, 0);
  assert.equal(words[1].word, "two");
  assert.ok(words[1].time > 0 && words[1].time < 4, "the second word is heard later in the phrase");
});

test("every line of the sheet is placed where its own words were heard", () => {
  const placed = placeSheetLines({ lines: SHEET, cues: CUES });

  assert.equal(placed.length, 3);
  assert.ok(placed[0].heard, "the first line was heard");
  assert.equal(placed[0].start, 0, "the first line starts with the song");
  assert.ok(placed[1].heard, "the second line was heard");
  assert.ok(placed[1].start >= placed[0].end, "the lines keep the order they were sung in");
  assert.ok(placed[2].heard, "the third line was heard");
  assert.equal(placed[0].section, "Verse", "the line keeps the section of the sheet");
});

test("a line the song never sang is left out", () => {
  const placed = placeSheetLines({
    lines: [
      { text: "A verse the render never sang.", section: "Verse" },
      { text: "Darkness births a holy light deep within our soul.", section: "Verse" }
    ],
    cues: CUES
  });

  assert.equal(placed[0].heard, false, "the verse that was not sung is not shown");
  assert.equal(placed[0].start, null);
  assert.equal(placed[1].heard, true, "the line that was sung is still placed");
});

test("a sheet with no words, and a song with nothing heard, place nothing", () => {
  assert.deepEqual(placeSheetLines({ lines: [], cues: CUES }), []);
  assert.deepEqual(placeSheetLines({ lines: SHEET, cues: [] }).map((line) => line.heard), [false, false, false]);
});

test("the same line sung twice is placed at both of its times", () => {
  const chorus = { text: "We accept creation calm to heal the whole universe", section: "Chorus" };
  const placed = placeSheetLines({
    lines: [chorus, chorus],
    cues: [
      { start: 0, end: 5, text: "We accept creation calm to heal the whole" },
      { start: 20, end: 25, text: "We accept creation calm to heal the whole" }
    ]
  });

  assert.equal(placed[0].heard, true);
  assert.equal(placed[1].heard, true);
  assert.ok(placed[1].start > placed[0].start, "the second time is a second time");
});
