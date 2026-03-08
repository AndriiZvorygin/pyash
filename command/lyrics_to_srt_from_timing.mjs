#!/usr/bin/env node
import fs from "node:fs/promises";
import { splitSentences } from "../program/library/sentenceSplitter.mjs";
import { parseSrtToCuts } from "./itinerary_io.mjs";

function usage() {
  return "Usage: node command/lyrics_to_srt_from_timing.mjs <lyrics.txt> <timing.srt> <output.srt> [--include-sections]";
}

function formatSrtTime(seconds) {
  const safe = Math.max(0, Number(seconds) || 0);
  const totalMs = Math.round(safe * 1000);
  const hh = Math.floor(totalMs / 3600000);
  const mm = Math.floor((totalMs % 3600000) / 60000);
  const ss = Math.floor((totalMs % 60000) / 1000);
  const ms = totalMs % 1000;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

function normalizeSectionName(raw) {
  return String(raw ?? "").trim().replace(/\s+/g, " ");
}

function normalizeLyricsCuts(text, { includeSections = false } = {}) {
  const source = String(text ?? "");
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const lineCuts = [];
  let activeSection = "";

  for (const rawLine of lines) {
    const line = String(rawLine || "").trim();
    if (!line) continue;
    const sectionMatch = /^\[([^\]]+)\]$/u.exec(line);
    if (sectionMatch) {
      activeSection = normalizeSectionName(sectionMatch[1]);
      continue;
    }
    const textLine = includeSections && activeSection ? `[${activeSection}] ${line}` : line;
    lineCuts.push(textLine);
  }
  if (lineCuts.length > 1) return lineCuts;

  const sentenceCuts = splitSentences(source, { includeThen: true })
    .map((entry) => String(entry || "").trim())
    .filter(Boolean)
    .filter((line) => !/^\[[^\]]+\]$/u.test(line));
  return sentenceCuts;
}

function countWords(text) {
  const raw = String(text ?? "").trim();
  if (!raw) return 0;
  return raw.split(/\s+/u).filter(Boolean).length;
}

function percentile(values, p) {
  const list = Array.isArray(values) ? values.filter((n) => Number.isFinite(n)).slice() : [];
  if (!list.length) return 0;
  list.sort((a, b) => a - b);
  const pos = Math.max(0, Math.min(1, Number(p ?? 0))) * (list.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return list[lo];
  const t = pos - lo;
  return list[lo] + ((list[hi] - list[lo]) * t);
}

function sanitizeTimingCuts(rawCuts) {
  const source = Array.isArray(rawCuts) ? rawCuts : [];
  const cuts = source
    .map((cut) => ({
      since: Number(cut?.since ?? 0),
      until: Number(cut?.until ?? Number(cut?.since ?? 0)),
      obText: String(cut?.obText ?? "")
    }))
    .filter((cut) => Number.isFinite(cut.since) && Number.isFinite(cut.until))
    .sort((a, b) => a.since - b.since || a.until - b.until);
  if (!cuts.length) return [];
  const out = [];
  let prevEnd = Math.max(0, cuts[0].since);
  let prevRawEnd = Math.max(0, cuts[0].since);
  for (const cut of cuts) {
    const rawDur = Math.max(0.04, cut.until - cut.since);
    const rawSince = Math.max(0, cut.since);
    const rawGap = Math.max(0, rawSince - prevRawEnd);
    // Keep natural pauses; only trim pathological ASR jumps.
    const keepGap = rawGap > 20 ? 8 : rawGap;
    const since = Math.max(prevEnd, prevEnd + keepGap);
    const until = since + rawDur;
    out.push({ since, until, obText: cut.obText });
    prevEnd = until;
    prevRawEnd = Math.max(prevRawEnd, Math.max(rawSince, cut.until));
  }
  return out;
}

function buildTimingRows(lyricsCuts, timingCuts) {
  const lines = Array.isArray(lyricsCuts) ? lyricsCuts : [];
  const cuts = sanitizeTimingCuts(timingCuts);
  if (!lines.length) throw new Error("lyrics to srt defective: no lyric lines");
  if (!cuts.length) throw new Error("lyrics to srt defective: no timing cuts");

  const totalTimingWords = Math.max(1, cuts.reduce((sum, cut) => sum + Math.max(1, countWords(cut?.obText)), 0));
  const totalLyricWords = Math.max(1, lines.reduce((sum, line) => sum + Math.max(1, countWords(line)), 0));

  const cueWordPositions = [];
  let runningTimingWords = 0;
  for (const cut of cuts) {
    const words = Math.max(1, countWords(cut?.obText));
    const since = Number(cut?.since ?? 0);
    const until = Number(cut?.until ?? since);
    cueWordPositions.push({ since, until, startWord: runningTimingWords, endWord: runningTimingWords + words });
    runningTimingWords += words;
  }

  function wordToTime(wordPos) {
    const clamped = Math.max(0, Math.min(totalTimingWords, wordPos));
    for (const cue of cueWordPositions) {
      if (clamped <= cue.endWord) {
        const spanWords = Math.max(1, cue.endWord - cue.startWord);
        const p = Math.max(0, Math.min(1, (clamped - cue.startWord) / spanWords));
        return cue.since + ((cue.until - cue.since) * p);
      }
    }
    return cueWordPositions[cueWordPositions.length - 1].until;
  }

  const rows = [];
  let runningLyricWords = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const words = Math.max(1, countWords(line));
    const startTimingWord = (runningLyricWords / totalLyricWords) * totalTimingWords;
    runningLyricWords += words;
    const endTimingWord = i === lines.length - 1
      ? totalTimingWords
      : (runningLyricWords / totalLyricWords) * totalTimingWords;
    const since = wordToTime(startTimingWord);
    const until = Math.max(since + 0.06, wordToTime(endTimingWord));
    rows.push({ index: i + 1, since, until, text: line });
  }
  const timelineStart = Number(cueWordPositions[0]?.since ?? 0);
  const timelineEnd = Number(cueWordPositions[cueWordPositions.length - 1]?.until ?? timelineStart);
  const minLineSeconds = 0.10;

  let prevEnd = timelineStart;
  for (const row of rows) {
    row.since = Math.max(prevEnd, Number(row.since ?? 0));
    row.until = Math.max(row.since + minLineSeconds, Number(row.until ?? row.since + minLineSeconds));
    prevEnd = row.until;
  }
  if (rows.length && prevEnd > timelineEnd) {
    const currentSpan = Math.max(0.01, prevEnd - timelineStart);
    const targetSpan = Math.max(0.01, timelineEnd - timelineStart);
    const scale = targetSpan / currentSpan;
    let cursor = timelineStart;
    for (const row of rows) {
      const scaledSince = timelineStart + ((row.since - timelineStart) * scale);
      const scaledUntil = timelineStart + ((row.until - timelineStart) * scale);
      row.since = Math.max(cursor, scaledSince);
      row.until = Math.max(row.since + 0.04, scaledUntil);
      cursor = row.until;
    }
    rows[rows.length - 1].until = timelineEnd;
  }

  return rows;
}

async function main() {
  const args = process.argv.slice(2);
  const includeSections = args.includes("--include-sections");
  const positional = args.filter((part) => part !== "--include-sections");
  const [lyricsPath, timingSrtPath, outputPath] = positional;
  if (!lyricsPath || !timingSrtPath || !outputPath) {
    throw new Error(usage());
  }

  const lyricsText = await fs.readFile(lyricsPath, "utf8");
  const timingText = await fs.readFile(timingSrtPath, "utf8");
  const lyricCuts = normalizeLyricsCuts(lyricsText, { includeSections });
  const timingCuts = parseSrtToCuts(timingText);
  const rows = buildTimingRows(lyricCuts, timingCuts);

  const out = [];
  for (const row of rows) {
    out.push(String(row.index));
    out.push(`${formatSrtTime(row.since)} --> ${formatSrtTime(row.until)}`);
    out.push(String(row.text));
    out.push("");
  }
  await fs.writeFile(outputPath, `${out.join("\n")}\n`, "utf8");
  process.stdout.write(`${outputPath}\n`);
}

main().catch((err) => {
  process.stderr.write(`${err?.message ?? String(err)}\n`);
  process.exit(1);
});
