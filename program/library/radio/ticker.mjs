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
 * The words of a song, with the time of every line.
 *
 * The words are the words of the song, as they were written: the alignment
 * places them at the times the hear lane heard them. A song that was never
 * aligned falls back to its sheet, with the lines spread over the length of
 * the song and the first of them after the opening the song begins with.
 */
export function timedLines({ aligned = "", sheet = "", durationSeconds = 0 } = {}) {
  const sung = parseSrt(aligned);
  if (sung.length) {
    return { source: "lyrics", lines: sung };
  }
  const words = parseSheet(sheet);
  if (!words.length) return { source: "none", lines: [] };
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
 * them, and the sheet when it has not.
 */
export async function readWords({ sheetPath = "", alignedPath = "", durationSeconds = 0 } = {}) {
  let aligned = "";
  let sheet = "";
  if (alignedPath) {
    try {
      aligned = await fs.readFile(alignedPath, "utf8");
    } catch {
      aligned = "";
    }
  }
  if (sheetPath) {
    try {
      sheet = await fs.readFile(sheetPath, "utf8");
    } catch {
      sheet = "";
    }
  }
  return timedLines({ aligned, sheet, durationSeconds });
}
