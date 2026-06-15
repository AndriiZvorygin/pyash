#!/usr/bin/env node
import fs from "node:fs/promises";

function usage() {
  return "Usage: node command/srt_from_qwen_say_chunks.mjs <chunks.metadata.json> <output.srt> [--sentence-cues]";
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

function normalizeSentenceCueText(raw = "") {
  return normalizeCueText(String(raw ?? "").replace(/\.\.\.\s*$/u, "."));
}

export function buildSentenceSrtFromChunks(chunkMetadata) {
  const chunks = Array.isArray(chunkMetadata?.chunks) ? chunkMetadata.chunks : [];
  if (!chunks.length) {
    throw new Error("qwen say chunks defective: missing chunks");
  }
  const cues = [];
  let offsetSeconds = 0;
  for (const chunk of chunks) {
    const chunkIndex = Number(chunk?.index ?? 0) + 1;
    const parsed = parseTimestampLines(readChunkTimestampText(chunk));
    const fallbackText = normalizeSentenceCueText(readChunkFallbackCueText(chunk));
    const chunkDuration = readChunkDurationSeconds(chunk);
    if (!fallbackText) {
      throw new Error(`qwen say chunks defective: missing sentence text at chunk ${chunkIndex}`);
    }
    if (parsed.length) {
      cues.push({
        start: offsetSeconds + Number(parsed[0].start),
        end: offsetSeconds + Number(parsed[parsed.length - 1].end),
        text: fallbackText
      });
      const chunkEnd = Number(parsed[parsed.length - 1]?.end ?? 0);
      offsetSeconds += Math.max(0, Number(chunkDuration) || chunkEnd, chunkEnd);
      continue;
    }
    if (Number.isFinite(chunkDuration) && chunkDuration > 0) {
      cues.push({
        start: offsetSeconds,
        end: offsetSeconds + chunkDuration,
        text: fallbackText
      });
      offsetSeconds += chunkDuration;
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
      const chunkDuration = readChunkDurationSeconds(chunk);
      // The final WAV concatenates the full chunk file, including trailing pauses.
      // Advance by real chunk duration when available so downstream subtitles do not
      // compress away silence and drift early across multi-chunk sections.
      offsetSeconds += Math.max(0, Number(chunkDuration) || chunkEnd, chunkEnd);
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
  const args = process.argv.slice(2);
  const sentenceCues = args.includes("--sentence-cues");
  const positional = args.filter((arg) => arg !== "--sentence-cues");
  const [inputPath, outputPath] = positional;
  if (!inputPath || !outputPath || positional.length !== 2) {
    throw new Error(usage());
  }
  const raw = await fs.readFile(inputPath, "utf8");
  const metadata = JSON.parse(raw);
  const srt = sentenceCues ? buildSentenceSrtFromChunks(metadata) : buildSrtFromChunks(metadata);
  await fs.writeFile(outputPath, srt, "utf8");
  process.stdout.write(`${outputPath}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    process.stderr.write(`${String(error?.message ?? error)}\n`);
    process.exit(1);
  });
}
