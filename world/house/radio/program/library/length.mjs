// The length of a song.
//
// A song is as long as its words take to sing. The same sheet sung slowly is a
// longer song than the same sheet sung fast: a hymn at 75 bpm needs more time
// for the same lines than a day song at 128. A fixed length ignores that, and
// the sheet is then crammed into whatever time the workflow was handed, which
// is what makes a slow song feel hurried — the words arrive at the pace of the
// day programme while the music crawls.
//
// So the length is counted, not assumed: the sheet's words are divided by the
// pace the channel sings at. The day channel is the yardstick — its density at
// its own tempo is the density every channel keeps — and a slower channel gets
// proportionally more time for the same words.
//
// The result is bounded at both ends. A song is a song, not a concert: a very
// long sheet is cut to the longest song the house will sing, and a very short
// one still gets enough time to be a song rather than a fragment.

import { parseSheet } from "./ticker.mjs";

// The tempo the house's density is measured at: the day programme's own pace.
export const BASE_BPM = 128;
// How many words the house sings in a second at the base tempo. The day
// programme's sheets carry about 315 words over 175 s, which is this pace.
export const BASE_WORDS_PER_SECOND = 1.8;
// The shortest and longest a song may be, whatever its sheet says.
export const MINIMUM_SECONDS = 90;
// The longest a song may be before the engine stops singing it.
//
// Measured on ACE-Step 1.5 XL turbo, one sheet and one seed at three lengths:
// 175 s and 240 s both sing the words (287 of 297 recovered at 240), while 282 s
// comes back instrumental — no voice at all. A song past this length is not a
// slow song, it is an instrumental, so the ceiling stays under the break.
export const MAXIMUM_SECONDS = 240;

/**
 * The words of a sheet, counted the way a singer counts them: the sung lines
 * only, never the section marks.
 */
export function countSheetWords(text) {
  const lines = parseSheet(text);
  let total = 0;
  for (const line of lines) {
    const words = String(line?.text ?? "").match(/[A-Za-z']+/gu);
    if (words) total += words.length;
  }
  return total;
}

/**
 * How long a song of this many words should be, sung at this pace.
 *
 * The pace is the tempo the channel asks for: the same density the day
 * programme keeps, stretched or tightened in proportion to the beats. A song
 * whose channel has no tempo of its own is measured at the base tempo, so a
 * channel that never asked for a pace is not silently sped up or slowed down.
 *
 * The length is clamped to the house's bounds. A caller may ask for a tighter
 * ceiling of its own, never a looser one: the longest song the house will sing
 * is the same whatever engine renders it.
 */
export function songLength({
  words = 0,
  bpm = 0,
  baseBpm = BASE_BPM,
  wordsPerSecond = BASE_WORDS_PER_SECOND,
  minimumSeconds = MINIMUM_SECONDS,
  maximumSeconds = MAXIMUM_SECONDS
} = {}) {
  const count = Math.max(0, Number(words) || 0);
  const base = Number(baseBpm) || BASE_BPM;
  const pace = Number(bpm) > 0 ? Number(bpm) : base;
  const density = (Number(wordsPerSecond) || BASE_WORDS_PER_SECOND) * (pace / base);
  const minimum = Number(minimumSeconds) || MINIMUM_SECONDS;
  const ceiling = Number(maximumSeconds) || MAXIMUM_SECONDS;
  const maximum = Math.max(minimum, Math.min(MAXIMUM_SECONDS, ceiling));
  if (!count || density <= 0) return minimum;
  const seconds = count / density;
  return Math.round(Math.min(maximum, Math.max(minimum, seconds)));
}
