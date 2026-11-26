// The length of a song.
//
// A song is as long as its words take to sing. These quizzes hold that: a
// sheet sung slowly makes a longer song than the same sheet sung fast, the
// length stays inside the house's bounds whatever the sheet says, and a channel
// that never asked for a pace is measured at the house's own.

import test from "node:test";
import assert from "node:assert/strict";

import {
  BASE_BPM,
  BASE_WORDS_PER_SECOND,
  MAXIMUM_SECONDS,
  MINIMUM_SECONDS,
  countSheetWords,
  songLength
} from "../program/library/radio/length.mjs";

test("the words of a sheet are counted without its section marks", () => {
  const text = [
    "[Verse]",
    "We close our eyes to think of nothing",
    "",
    "[Chorus]",
    "Trust the timing of growth"
  ].join("\n");
  // Verse 8 words, chorus 5; the marks themselves are never words.
  assert.equal(countSheetWords(text), 13);
});

test("a sheet of only section marks has no words", () => {
  assert.equal(countSheetWords("[Verse]\n[Chorus]\n"), 0);
  assert.equal(countSheetWords(""), 0);
});

test("a slow song is longer than the same words sung fast", () => {
  const words = 300;
  const slow = songLength({ words, bpm: 75 });
  const fast = songLength({ words, bpm: 128 });
  assert.ok(slow > fast, "the slower channel keeps the same words for longer");
  assert.equal(fast, 167, "the house's own density at its own tempo");
});

test("the length follows the words at the channel's pace", () => {
  // Half the words at the same pace is half the song, inside the bounds. The
  // lengths are whole seconds, so the comparison allows that last rounding.
  const long = songLength({ words: 400, bpm: 128 });
  const short = songLength({ words: 200, bpm: 128 });
  assert.ok(short < long, "fewer words is a shorter song");
  assert.ok(Math.abs(short * 2 - long) <= 2, "the length is proportional to the words");
});

test("a channel with no pace of its own is measured at the house's own", () => {
  assert.equal(songLength({ words: 320, bpm: 0 }), songLength({ words: 320, bpm: BASE_BPM }));
});

test("the house's density is the one the day programme keeps", () => {
  // The day sheets carry about 312 words over 175 s.
  const dayLength = songLength({ words: 312, bpm: 128 });
  assert.ok(Math.abs(dayLength - 175) <= 8, `the day song stays near its length, got ${dayLength}`);
  assert.ok(Math.abs(312 / dayLength - BASE_WORDS_PER_SECOND) < 0.1, "the density is the base pace");
});

test("a song is never longer than the house allows", () => {
  const huge = songLength({ words: 5000, bpm: 75 });
  assert.equal(huge, MAXIMUM_SECONDS, "a long sheet is cut to the longest song");
});

test("the ceiling stays under the length where the engine stops singing", () => {
  // Measured on ACE-Step 1.5 XL turbo: one sheet and one seed sang at 175 s and
  // at 240 s, and came back instrumental at 282 s. A song past the break is not
  // a slow song, so the ceiling must stay under it.
  assert.ok(MAXIMUM_SECONDS < 282, `the ceiling is under the measured break, got ${MAXIMUM_SECONDS}`);
  assert.ok(MAXIMUM_SECONDS >= 180, `the ceiling still leaves room for a hymn, got ${MAXIMUM_SECONDS}`);
});

test("a full night sheet fits the ceiling at a hymn's density", () => {
  // A night sheet carries about 300 words; sung at 75 bpm they must fit inside
  // the ceiling without being crammed past the pace a hymn is sung at.
  const night = songLength({ words: 300, bpm: 75 });
  assert.ok(night <= MAXIMUM_SECONDS, `the night sheet fits the ceiling, got ${night}`);
  const density = 300 / night;
  assert.ok(density <= 1.35, `the night density stays hymn-like, got ${density.toFixed(2)} words per second`);
});

test("a song is never shorter than a song", () => {
  const tiny = songLength({ words: 3, bpm: 128 });
  assert.equal(tiny, MINIMUM_SECONDS, "a fragment of a sheet still gets a song's length");
  assert.equal(songLength({ words: 0 }), MINIMUM_SECONDS);
});

test("a caller may tighten the ceiling and never loosen it", () => {
  const tightened = songLength({ words: 5000, bpm: 75, maximumSeconds: 200 });
  assert.equal(tightened, 200, "the caller's tighter ceiling holds");
  const loosened = songLength({ words: 5000, bpm: 75, maximumSeconds: 9999 });
  assert.equal(loosened, MAXIMUM_SECONDS, "a looser ceiling is still the house's ceiling");
});

test("the night programme's sheets no longer carry a day song's density", () => {
  // A night sheet of 300 words sung at 75 bpm is a hymn, not a sprint.
  const night = songLength({ words: 300, bpm: 75 });
  const density = 300 / night;
  assert.ok(density <= 1.25, `the night density stays hymn-like, got ${density.toFixed(2)} words per second`);
  assert.ok(density >= 0.9, `the night density still fills the song, got ${density.toFixed(2)} words per second`);
});
