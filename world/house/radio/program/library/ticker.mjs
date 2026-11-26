// The words of a song, and the time they are sung.
//
// The station plays a song; a listener wants to read along with it. The words
// are the ones the house already heard: the transcript of the song, taken by
// the hear lane when the song was made, with the time of every line.
//
// A song that was never transcribed falls back to its sheet, with the lines
// spread over the length of the song. The words are right; the timing is an
// estimate, and the station says which of the two it is showing.

import fs from "node:fs/promises";
import path from "node:path";

import { placeSheetLines } from "./placement.mjs";

/**
 * Where the transcript of a song lies: beside its sheet, with the suffix of a
 * subtitle.
 */
export function transcriptPathFor(sheetPath) {
  const sheet = String(sheetPath ?? "");
  if (!sheet) return "";
  return sheet.replace(/\.txt$/u, ".srt");
}

/**
 * Where the aligned words of a song lie: beside its sheet, with the name of
 * the alignment.
 *
 * The alignment is the house's own: the words of the song, as they were
 * written, placed at the times the hear lane heard them. The raw transcript
 * beside it is what the machine heard, which is not always the song.
 */
export function alignedPathFor(sheetPath) {
  const sheet = String(sheetPath ?? "");
  if (!sheet) return "";
  return sheet.replace(/\.txt$/u, ".aligned.srt");
}

/**
 * The path of a transcript beside a plain transcript file.
 */
export function srtPathFor(transcriptPath) {
  return String(transcriptPath ?? "").replace(/\.txt$/u, ".srt");
}

/**
 * The words of a song: the sheet it carries, the transcript of what the house
 * heard, and the alignment of the two.
 *
 * A song the house sings in one voice shares the sheet of its lane: the sheet
 * of "peace" is the words of peace, whoever sings them. A song of a channel
 * that has a voice of its own carries a sheet of its own, named for that
 * voice, so a song sung slow is timed by its own hearing and not by the
 * hearing of the lane it was made for.
 */
export function wordPathsFor({ lyricsDirectory = "", engine = "", topic = "", own = false } = {}) {
  const directory = String(lyricsDirectory ?? "").trim();
  const name = String(topic ?? "").trim();
  if (!directory || !name) return { sheetPath: "", transcriptPath: "", alignedPath: "" };
  const voice = own ? String(engine ?? "").trim() : "";
  const stem = voice ? `song-${voice}-${name}` : `song-${name}`;
  return {
    sheetPath: path.join(directory, `${stem}.txt`),
    transcriptPath: path.join(directory, `${stem}.srt`),
    alignedPath: path.join(directory, `${stem}.aligned.srt`)
  };
}

/**
 * Read one timestamp of a subtitle: hours, minutes, seconds and thousandths.
 */
function parseStamp(stamp) {
  const match = String(stamp ?? "").match(/(\d+):(\d+):(\d+)[,.](\d+)/u);
  if (!match) return null;
  const [, hours, minutes, seconds, thousandths] = match;
  return Number(hours) * 3600
    + Number(minutes) * 60
    + Number(seconds)
    + Number(thousandths) / 1000;
}

/**
 * The sentences of a line of words: the hear lane writes what it heard as
 * one long breath, and a ticker follows it a sentence at a time.
 */
export function splitSentences(text) {
  return String(text ?? "")
    .split(/(?<=[.!?])\s+/u)
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * The lines of a subtitle, each with the time it is sung at and the time it
 * ends.
 *
 * A segment of the subtitle holds several sentences, and the time of the
 * segment is shared among them by the length of each one, so the ticker moves
 * with the words and not in steps of thirty seconds.
 */
export function parseSrt(text) {
  const lines = [];
  for (const block of String(text ?? "").split(/\r?\n\s*\r?\n/u)) {
    const rows = block.split(/\r?\n/u).map((row) => row.trim()).filter(Boolean);
    const stampAt = rows.findIndex((row) => row.includes("-->"));
    if (stampAt < 0) continue;
    const [from, to] = rows[stampAt].split("-->").map((part) => part.trim());
    const body = rows.slice(stampAt + 1).join(" ");
    const start = parseStamp(from);
    const end = parseStamp(to);
    if (!body || start === null || end === null) continue;
    const sentences = splitSentences(body);
    if (!sentences.length) continue;
    const total = sentences.reduce((sum, sentence) => sum + sentence.length, 0) || 1;
    let at = start;
    for (const sentence of sentences) {
      const share = ((end - start) * sentence.length) / total;
      lines.push({ start: Number(at.toFixed(3)), end: Number((at + share).toFixed(3)), text: sentence });
      at += share;
    }
  }
  return lines;
}

/**
 * The words of a sheet, each with the section it belongs to.
 */
export function parseSheet(text) {
  const words = [];
  let section = "";
  for (const raw of String(text ?? "").split(/\r?\n/u)) {
    const line = raw.trim();
    if (!line) continue;
    const mark = line.match(/^\[([^\]]+)\]/u);
    if (mark) {
      section = mark[1].trim();
      continue;
    }
    words.push({ section, text: line });
  }
  return words;
}

/**
 * The lines of a song, kept inside the length of the song.
 *
 * The hear lane pads what it hears to a whole window of time, so the last
 * words of a song can be given a time that lies past the end of the song. A
 * listener must not be shown a line that is sung after the song has ended, so
 * every line is cut at the end of the song, and a line that begins after the
 * song is left out.
 */
export function withinSong(lines = [], durationSeconds = 0) {
  const duration = Number(durationSeconds) || 0;
  const list = Array.isArray(lines) ? lines.filter(Boolean) : [];
  if (!duration) return list;
  const kept = [];
  for (const line of list) {
    const start = Number(line?.start ?? 0);
    if (start >= duration) continue;
    const end = Math.min(Number(line?.end ?? start), duration);
    kept.push({ ...line, start, end: Math.max(start, end) });
  }
  return kept;
}

/**
 * The words of a song, with the time of every line.
 *
 * The words are the words of the song, as they were written: the alignment
 * places them at the times the hear lane heard them.
 *
 * A song the house could not align is placed on the words that were heard:
 * every line of the sheet is put where its own words were sung, and a line
 * the song never sang is left out. A song that was never heard at all falls
 * back to its sheet, with the lines spread over the length of the song and
 * the first of them after the opening the song begins with.
 */
export function timedLines({ aligned = "", sheet = "", transcript = "", durationSeconds = 0 } = {}) {
  const sung = parseSrt(aligned);
  if (sung.length) {
    return { source: "lyrics", lines: withinSong(sung, durationSeconds) };
  }
  const words = parseSheet(sheet);
  if (!words.length) return { source: "none", lines: [] };
  const cues = parseSrt(transcript);
  if (cues.length) {
    const placed = placeSheetLines({ lines: words, cues })
      .filter((line) => line.heard)
      .map((line) => ({ start: line.start, end: line.end, text: line.text, section: line.section }))
      .sort((left, right) => left.start - right.start);
    if (placed.length) {
      return { source: "song", lines: withinSong(placed, durationSeconds) };
    }
  }
  const duration = Number(durationSeconds) || 0;
  const opening = duration ? duration * 0.08 : 0;
  const span = Math.max(1, duration - opening);
  const each = span / words.length;
  return {
    source: "sheet",
    lines: words.map((word, index) => ({
      start: Number((opening + index * each).toFixed(3)),
      end: Number((opening + (index + 1) * each).toFixed(3)),
      text: word.text,
      section: word.section
    }))
  };
}

/**
 * The line that is sung at that moment: the one that covers it, and failing
 * that the last one that has already begun.
 */
export function lineAt(lines = [], seconds = 0) {
  const list = Array.isArray(lines) ? lines.filter(Boolean) : [];
  if (!list.length) return -1;
  const now = Number(seconds) || 0;
  for (let index = 0; index < list.length; index += 1) {
    const line = list[index];
    if (now < Number(line.start ?? 0)) return index === 0 ? 0 : index - 1;
    if (now <= Number(line.end ?? 0)) return index;
  }
  return list.length - 1;
}

/**
 * The name of the transcript of a song, for the sheet it belongs to.
 */
export function transcriptNameFor(sheetPath) {
  const transcript = transcriptPathFor(sheetPath);
  return transcript ? path.basename(transcript) : "";
}

/**
 * Keep a file in place: the bytes go to a part file and the part file is
 * renamed onto the name, so a half written file is never on the air.
 */
export async function keepFile({ from = "", to = "" } = {}) {
  if (!from || !to) return "";
  const staging = `${to}.part`;
  await fs.copyFile(from, staging);
  await fs.rename(staging, to);
  return to;
}

/**
 * The words of a song, read from the files that hold them: the alignment
 * when the house has placed the words of the song at the times it heard
 * them, the words heard when the alignment was refused, and the sheet when
 * the song was never heard at all.
 */
export async function readWords({ sheetPath = "", alignedPath = "", transcriptPath = "", durationSeconds = 0 } = {}) {
  const read = async (file) => {
    if (!file) return "";
    try {
      return await fs.readFile(file, "utf8");
    } catch {
      return "";
    }
  };
  const [aligned, transcript, sheet] = await Promise.all([
    read(alignedPath),
    read(transcriptPath),
    read(sheetPath)
  ]);
  return timedLines({ aligned, transcript, sheet, durationSeconds });
}
