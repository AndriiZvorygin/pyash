#!/usr/bin/env node
import fs from "node:fs/promises";

function usage() {
  return "Usage: node command/srt_from_qwen_say_chunks.mjs <chunks.metadata.json> <output.srt>";
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

function parseTimestampLines(raw = "") {
  const lines = String(raw ?? "").split(/\r?\n/u);
  const out = [];
  for (const line of lines) {
    const match = /^\s*(-?\d+(?:\.\d+)?)\s*-\s*(-?\d+(?:\.\d+)?)\s*:\s*(.+?)\s*$/u.exec(line);
    if (!match) continue;
    const start = Number(match[1]);
    const end = Number(match[2]);
    const text = String(match[3] ?? "").trim();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || !text) continue;
    out.push({ start, end, text });
  }
  return out;
}

function normalizeCueText(raw = "") {
  return String(raw ?? "").replace(/\s+/gu, " ").trim();
}

function readChunkDurationSeconds(chunk = {}) {
  const candidates = [
    chunk?.durationSeconds,
    chunk?.verification?.durationSeconds,
    chunk?.verification?.hotTail?.durationSeconds,
    chunk?.verification?.asrTailEndSeconds
  ];
  for (const value of candidates) {
    const num = Number(value);
    if (Number.isFinite(num) && num > 0) return num;
  }
  return null;
}

function readChunkTimestampText(chunk = {}) {
  const candidates = [
    chunk?.timingTimestamps,
    chunk?.verification?.timingTimestamps,
    chunk?.timestamps,
    chunk?.verification?.timestamps,
    chunk?.verification?.asrTimestamps
  ];
  for (const value of candidates) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
}

function readChunkFallbackCueText(chunk = {}) {
  return normalizeCueText(
    chunk?.verifyText
      ?? chunk?.text
      ?? chunk?.verification?.verifyText
      ?? chunk?.verification?.text
      ?? ""
  );
}

export function buildSrtFromChunks(chunkMetadata) {
  const chunks = Array.isArray(chunkMetadata?.chunks) ? chunkMetadata.chunks : [];
  if (!chunks.length) {
    throw new Error("qwen say chunks defective: missing chunks");
  }
  const cues = [];
  let offsetSeconds = 0;
  for (const chunk of chunks) {
    const chunkIndex = Number(chunk?.index ?? 0) + 1;
    const parsed = parseTimestampLines(readChunkTimestampText(chunk));
    if (parsed.length) {
      for (const cue of parsed) {
        cues.push({
          start: cue.start + offsetSeconds,
          end: cue.end + offsetSeconds,
          text: cue.text
        });
      }
      const chunkEnd = parsed[parsed.length - 1]?.end ?? 0;
      offsetSeconds += Math.max(0, chunkEnd);
      continue;
    }

    const fallbackText = readChunkFallbackCueText(chunk);
    const fallbackDuration = readChunkDurationSeconds(chunk);
    if (fallbackText && Number.isFinite(fallbackDuration) && fallbackDuration > 0) {
      cues.push({
        start: offsetSeconds,
        end: offsetSeconds + fallbackDuration,
        text: fallbackText
      });
      offsetSeconds += fallbackDuration;
      continue;
    }

    throw new Error(`qwen say chunks defective: missing timed cue data at chunk ${chunkIndex}`);
  }
  if (!cues.length) {
    throw new Error("qwen say chunks defective: empty cue stream");
  }
  const lines = [];
  for (let i = 0; i < cues.length; i += 1) {
    const cue = cues[i];
    lines.push(String(i + 1));
    lines.push(`${formatSrtTime(cue.start)} --> ${formatSrtTime(cue.end)}`);
    lines.push(cue.text);
    lines.push("");
  }
  return `${lines.join("\n").trim()}\n`;
}

async function main() {
  const [inputPath, outputPath] = process.argv.slice(2);
  if (!inputPath || !outputPath) {
    throw new Error(usage());
  }
  const raw = await fs.readFile(inputPath, "utf8");
  const metadata = JSON.parse(raw);
  const srt = buildSrtFromChunks(metadata);
  await fs.writeFile(outputPath, srt, "utf8");
  process.stdout.write(`${outputPath}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    process.stderr.write(`${String(error?.message ?? error)}\n`);
    process.exit(1);
  });
}
