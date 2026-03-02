#!/usr/bin/env node
import fs from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { splitSentences } from "../program/library/sentenceSplitter.mjs";

function usage() {
  return "Usage: node command/lyrics_to_srt_even.mjs <lyrics.txt> <audio.(wav|mp3)> <output.srt>";
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

function probeDurationSeconds(audioPath) {
  const probe = spawnSync(
    "ffprobe",
    [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      audioPath
    ],
    { encoding: "utf8" }
  );
  if (probe.status !== 0) {
    throw new Error(`ffprobe failed: ${probe.stderr || probe.stdout || "unknown error"}`);
  }
  const value = Number(String(probe.stdout || "").trim());
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`invalid audio duration: ${probe.stdout}`);
  }
  return value;
}

function normalizeCuts(text) {
  const source = String(text ?? "");
  const lineCuts = source
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => String(line || "").trim())
    .filter(Boolean)
    .filter((line) => !/^\[[^\]]+\]$/.test(line));
  if (lineCuts.length > 1) return lineCuts;
  const sentenceCuts = splitSentences(source, { includeThen: true })
    .map((entry) => String(entry || "").trim())
    .filter(Boolean)
    .filter((line) => !/^\[[^\]]+\]$/.test(line));
  return sentenceCuts;
}

async function main() {
  const [lyricsPath, audioPath, outputPath] = process.argv.slice(2);
  if (!lyricsPath || !audioPath || !outputPath) {
    throw new Error(usage());
  }

  const lyrics = await fs.readFile(lyricsPath, "utf8");
  const cuts = normalizeCuts(lyrics);
  if (cuts.length === 0) {
    throw new Error("lyrics to srt defective: no subtitle lines");
  }
  const duration = probeDurationSeconds(audioPath);
  const step = duration / cuts.length;

  const rows = [];
  for (let i = 0; i < cuts.length; i += 1) {
    const start = step * i;
    const end = i === cuts.length - 1 ? duration : step * (i + 1);
    rows.push(String(i + 1));
    rows.push(`${formatSrtTime(start)} --> ${formatSrtTime(end)}`);
    rows.push(cuts[i]);
    rows.push("");
  }
  await fs.writeFile(outputPath, `${rows.join("\n")}\n`, "utf8");
  process.stdout.write(`${outputPath}\n`);
}

main().catch((err) => {
  process.stderr.write(`${err?.message ?? String(err)}\n`);
  process.exit(1);
});
