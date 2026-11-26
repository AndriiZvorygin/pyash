// The words of a sheet, placed at the times the house heard them.
//
// A song is heard before it is read. The hear lane says what it heard, phrase
// by phrase, with the time of every phrase. The sheet says what the song is
// meant to sing. This brings the two together: every line of the sheet is
// placed where its own words were heard, so a listener reads the line that is
// being sung, at the moment it is sung.
//
// The words of a heard song are never perfect. A word can come out of the
// mouth of the song garbled, so a line is matched loosely: a word matches
// itself, a word that carries one letter more, and a word that is only the
// plural of another.
//
// A line the song never sang is left out. A render may drop a verse, and a
// listener should not read words that are not being sung.

const DEFAULT_THRESHOLD = 0.6;
const DEFAULT_MIN_MATCHES = 2;
const DEFAULT_MIN_DENSITY = 0.5;
const DEFAULT_LOOK_AHEAD = 1.8;

/**
 * The word as the house writes it down: letters and digits only, in lower
 * case.
 */
export function normalizeWord(word) {
  return String(word ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9']+/gu, "");
}

/**
 * The words of a line, as the house counts them.
 */
export function splitWords(text) {
  return String(text ?? "")
    .split(/\s+/u)
    .map((word) => normalizeWord(word))
    .filter(Boolean);
}

/**
 * Two words are the same word when the house heard one of them slightly
 * wrong: the plural of the other, or a word whose letters are nearly the same
 * letters, said a little differently by the mouth of the song.
 */
export function wordsRoughlyMatch(left, right) {
  const a = normalizeWord(left);
  const b = normalizeWord(right);
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length >= 4 && b.length >= 4 && a + "s" === b) return true;
  if (a.length >= 4 && b.length >= 4 && b + "s" === a) return true;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  if (longer.length < 5) return false;
  if (longer.length - shorter.length > 1) return false;
  if (a[0] !== b[0]) return false;
  return sharedLetters(a, b) / longer.length >= 0.6;
}

/**
 * How many letters two words have in common, counted once each.
 */
function sharedLetters(a, b) {
  const rest = new Map();
  for (const letter of b) rest.set(letter, (rest.get(letter) ?? 0) + 1);
  let shared = 0;
  for (const letter of a) {
    const held = rest.get(letter) ?? 0;
    if (held <= 0) continue;
    rest.set(letter, held - 1);
    shared += 1;
  }
  return shared;
}

/**
 * The words of a heard song, one by one, each with the time it was heard at.
 *
 * A phrase of the transcript holds several words and one span of time, so the
 * time of the words inside it is shared among them by their length.
 */
export function heardWords(cues = []) {
  const out = [];
  for (const cue of Array.isArray(cues) ? cues : []) {
    const start = Number(cue?.start ?? 0);
    const end = Number(cue?.end ?? start);
    const span = Math.max(0.001, end - start);
    const words = String(cue?.text ?? "").split(/\s+/u).filter(Boolean);
    words.forEach((word, index) => {
      out.push({ word: normalizeWord(word), time: start + (span * index) / Math.max(1, words.length) });
    });
  }
  return out;
}

/**
 * How well a line of the sheet matches the words that were heard from a
 * certain word onward: how many of its words were heard, where the first and
 * the last of them sit, and how close together they were heard.
 *
 * A line that is sung comes back in one breath: its words are heard close
 * together, in the order of the sheet. A line that was never sung can still
 * gather a few of its words here and there, so the closeness matters as much
 * as the number of words.
 */
function matchAt(lineWords, stream, from, lookAhead) {
  const window = Math.max(lineWords.length + 4, Math.ceil(lineWords.length * lookAhead) + 2);
  let cursor = from;
  let matched = 0;
  let first = -1;
  let last = -1;
  for (const word of lineWords) {
    for (let index = cursor; index < stream.length && index < from + window; index += 1) {
      if (!wordsRoughlyMatch(word, stream[index].word)) continue;
      matched += 1;
      if (first < 0) first = index;
      last = index;
      cursor = index + 1;
      break;
    }
  }
  const span = first < 0 ? 0 : last - first + 1;
  return {
    ratio: matched / Math.max(1, lineWords.length),
    density: span ? matched / span : 0,
    matched,
    first,
    last
  };
}

/**
 * Place the lines of a sheet at the times their words were heard.
 *
 * The lines are placed in the order of the sheet, and the search for each line
 * starts where the line before it was found, so the words of the song stay in
 * the order they were sung. A line that was not sung is left out, and the
 * search carries on from the line before it.
 *
 * Every placed line carries the time it starts, the time it ends, how much of
 * it was heard, and the section of the sheet it belongs to.
 */
export function placeSheetLines({
  lines = [],
  cues = [],
  threshold = DEFAULT_THRESHOLD,
  minMatches = DEFAULT_MIN_MATCHES,
  minDensity = DEFAULT_MIN_DENSITY,
  lookAhead = DEFAULT_LOOK_AHEAD
} = {}) {
  const stream = heardWords(cues);
  const placed = [];
  let cursor = 0;
  for (const entry of Array.isArray(lines) ? lines : []) {
    const text = String(entry?.text ?? "");
    const section = String(entry?.section ?? "");
    const words = splitWords(text);
    if (!words.length) {
      placed.push({ text, section, start: null, end: null, ratio: 0, density: 0, heard: false });
      continue;
    }
    let best = null;
    for (let index = cursor; index < stream.length; index += 1) {
      const match = matchAt(words, stream, index, lookAhead);
      if (!best || match.ratio > best.ratio) best = match;
      // The song sings its lines in the order of the sheet, so the first
      // place the words are heard well enough is the place the line was
      // sung. A later repetition of the same words is not this line.
      if (match.ratio >= threshold && match.matched >= minMatches && match.density >= minDensity) {
        best = match;
        break;
      }
    }
    let heardAhead = true;
    if (!best || best.first < 0 || best.ratio < threshold || best.matched < minMatches || best.density < minDensity) {
      // A song does not always sing its verses in the order of the sheet: a
      // render may take a verse early, or leave one out and sing it later. So
      // a line that is not heard after the line before it is looked for over
      // the whole song.
      best = null;
      for (let index = 0; index < stream.length; index += 1) {
        const match = matchAt(words, stream, index, lookAhead);
        if (!best || match.ratio > best.ratio) best = match;
        if (match.ratio >= threshold && match.matched >= minMatches && match.density >= minDensity) {
          best = match;
          break;
        }
      }
      heardAhead = false;
    }
    if (!best || best.first < 0 || best.ratio < threshold || best.matched < minMatches || best.density < minDensity) {
      placed.push({ text, section, start: null, end: null, ratio: best?.ratio ?? 0, density: best?.density ?? 0, heard: false });
      continue;
    }
    const start = stream[best.first].time;
    const end = Math.max(start, stream[best.last].time);
    placed.push({ text, section, start, end, ratio: best.ratio, density: best.density, heard: true });
    if (heardAhead) cursor = best.last + 1;
  }
  return placed;
}
