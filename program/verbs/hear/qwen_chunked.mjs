import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { parseQwenTimestampSegments, segmentsToSrt } from "./qwen_comfyui.mjs";
import { getExchangeRunId } from "../../bridge/exchange.mjs";

const execFileAsync = promisify(execFile);

function toFinitePositive(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

function looksTimestampLikeTranscript(text = "") {
  const value = String(text ?? "");
  if (!value.trim()) return false;
  let score = 0;
  const tokenPairs = value.match(/<\|\d+(?:\.\d+)?\|>/gu);
  if (tokenPairs && tokenPairs.length >= 2) score += 2;
  const rangePairs = value.match(/\b\d+(?:\.\d+)?\s*-\s*\d+(?:\.\d+)?\s*:/gu);
  if (rangePairs && rangePairs.length >= 2) score += 2;
  const bracketPairs = value.match(/\[\s*\d+(?:\.\d+)?\s*(?:,|-|-->)\s*\d+(?:\.\d+)?\s*\]/gu);
  if (bracketPairs && bracketPairs.length >= 2) score += 2;
  return score >= 2;
}

function normalizePlainTranscript(value = "") {
  let text = String(value ?? "");
  text = text.replace(/<\|\d+(?:\.\d+)?\|>/gu, " ");
  text = text.replace(/\[\s*\d+(?:\.\d+)?\s*(?:,|-|-->)\s*\d+(?:\.\d+)?\s*\]\s*/gu, " ");
  text = text.replace(/\b\d+(?:\.\d+)?\s*-\s*\d+(?:\.\d+)?\s*:\s*/gu, " ");
  text = text.replace(/[ \t]+/gu, " ");
  return text;
}

export function isQwenOutOfMemoryError(err) {
  const text = String(err?.message ?? err ?? "").toLowerCase();
  if (!text) return false;
  return (
    text.includes("out of memory") ||
    text.includes("allocation on device") ||
    text.includes("cuda out of memory")
  );
}

export function planChunkWindows(durationSeconds, { maxChunkSeconds = 55, overlapSeconds = 1.5 } = {}) {
  const duration = Number(durationSeconds);
  if (!Number.isFinite(duration) || duration <= 0) return [];
  const maxSec = toFinitePositive(maxChunkSeconds, 55);
  const overlapSecRaw = toFinitePositive(overlapSeconds, 1.5);
  const overlapSec = Math.min(overlapSecRaw, Math.max(0, maxSec / 2));
  const step = Math.max(0.25, maxSec - overlapSec);
  const windows = [];
  let start = 0;
  while (start < duration) {
    const end = Math.min(duration, start + maxSec);
    windows.push({
      index: windows.length,
      startSeconds: start,
      endSeconds: end,
      durationSeconds: end - start
    });
    if (end >= duration) break;
    start += step;
  }
  return windows;
}

export function mergeQwenChunkSegments(chunkResults = []) {
  const absolute = [];
  for (const chunk of chunkResults) {
    const offset = Number(chunk?.startSeconds ?? 0);
    const segments = Array.isArray(chunk?.segments) ? chunk.segments : [];
    for (const seg of segments) {
      const start = Number(seg?.start ?? 0) + offset;
      const endRaw = Number(seg?.end ?? start) + offset;
      const end = endRaw > start ? endRaw : start + 0.001;
      const text = String(seg?.text ?? "").trim();
      if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
      absolute.push({ start, end, text });
    }
  }
  absolute.sort((a, b) => {
    if (a.start === b.start) return a.end - b.end;
    return a.start - b.start;
  });

  const deduped = [];
  let lastEnd = -1;
  for (const seg of absolute) {
    if (seg.end <= lastEnd + 0.02) continue;
    const start = seg.start <= lastEnd ? lastEnd + 0.001 : seg.start;
    const end = Math.max(start + 0.001, seg.end);
    const text = String(seg.text ?? "").trim();
    const prev = deduped[deduped.length - 1];
    if (prev && prev.text && text && prev.text === text && start <= prev.end + 0.2) {
      if (end > prev.end) prev.end = end;
      lastEnd = Math.max(lastEnd, prev.end);
      continue;
    }
    deduped.push({ start, end, text });
    lastEnd = Math.max(lastEnd, end);
  }
  return deduped;
}

function mergeChunkTranscriptText(chunkResults = [], mergedSegments = []) {
  if (mergedSegments.length) {
    return mergedSegments
      .map(segment => String(segment?.text ?? "").trim())
      .filter(Boolean)
      .join("\n");
  }
  const normalizeWord = (word = "") => String(word ?? "")
    .toLowerCase()
    .replace(/[`'’]/gu, "")
    .replace(/[^a-z0-9]+/gu, "");
  const tokenize = (text = "") => String(text ?? "")
    .replace(/\s+/gu, " ")
    .trim()
    .split(" ")
    .filter(Boolean);

  const mergedTokens = [];
  const maxOverlapWords = 120;
  for (const chunk of chunkResults) {
    const transcript = normalizePlainTranscript(chunk?.transcript ?? "")
      .replace(/\s+/gu, " ")
      .trim();
    if (!transcript) continue;
    const chunkTokens = tokenize(transcript);
    if (!chunkTokens.length) continue;
    if (!mergedTokens.length) {
      mergedTokens.push(...chunkTokens);
      continue;
    }

    const left = mergedTokens;
    const right = chunkTokens;
    const limit = Math.min(maxOverlapWords, left.length, right.length);
    let overlap = 0;
    for (let k = limit; k >= 1; k -= 1) {
      let ok = true;
      for (let i = 0; i < k; i += 1) {
        const a = normalizeWord(left[left.length - k + i]);
        const b = normalizeWord(right[i]);
        if (!a || !b || a !== b) {
          ok = false;
          break;
        }
      }
      if (ok) {
        overlap = k;
        break;
      }
    }
    mergedTokens.push(...right.slice(overlap));
  }

  return mergedTokens.join(" ").trim();
}

export async function probeAudioDurationSeconds(inputPath) {
  const args = [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    String(inputPath ?? "")
  ];
  const { stdout } = await execFileAsync("ffprobe", args);
  const duration = Number(String(stdout ?? "").trim());
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error("hear qwen chunk defective: unable to determine audio duration");
  }
  return duration;
}

export async function renderAudioChunk({
  inputPath,
  outputPath,
  startSeconds,
  durationSeconds
}) {
  const args = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-ss",
    String(startSeconds),
    "-t",
    String(durationSeconds),
    "-i",
    String(inputPath ?? ""),
    "-vn",
    "-ac",
    "1",
    "-ar",
    "16000",
    String(outputPath ?? "")
  ];
  await execFileAsync("ffmpeg", args);
}

export async function transcribeWithQwenComfyuiChunked({
  inputPath,
  host,
  workflowRoot,
  workflowName,
  language = "",
  context = "",
  maxChunkSeconds = 55,
  overlapSeconds = 1.5,
  returnTimestamps = true,
  useSegmentsForTranscript = true,
  forcePlainTranscriptPass = true,
  transcribeFn,
  onChunk,
  probeDurationFn = probeAudioDurationSeconds,
  renderChunkFn = renderAudioChunk
} = {}) {
  if (typeof transcribeFn !== "function") {
    throw new Error("hear qwen chunk defective: missing transcribe function");
  }
  const durationSeconds = await probeDurationFn(inputPath);
  const windows = planChunkWindows(durationSeconds, { maxChunkSeconds, overlapSeconds });
  if (!windows.length) {
    throw new Error("hear qwen chunk defective: audio too short for chunking");
  }

  const runId = String(getExchangeRunId?.() ?? "").trim();
  const chunkRoot = runId
    ? path.join("artifacts", runId, "hear")
    : path.join("artifacts", "hear");
  await fs.mkdir(chunkRoot, { recursive: true });
  const chunkDir = await fs.mkdtemp(path.join(chunkRoot, "qwen-chunk-"));
  const chunkResults = [];
  try {
    for (const window of windows) {
      const chunkPath = path.join(chunkDir, `chunk-${String(window.index + 1).padStart(4, "0")}.wav`);
      await renderChunkFn({
        inputPath,
        outputPath: chunkPath,
        startSeconds: window.startSeconds,
        durationSeconds: window.durationSeconds
      });
      const payload = await transcribeFn({
        inputPath: chunkPath,
        host,
        workflowRoot,
        workflowName,
        language,
        context,
        returnTimestamps: true
      });
      let transcript = String(payload?.transcript ?? "").trim();
      if (!useSegmentsForTranscript && forcePlainTranscriptPass && looksTimestampLikeTranscript(transcript)) {
        const plainPayload = await transcribeFn({
          inputPath: chunkPath,
          host,
          workflowRoot,
          workflowName,
          language,
          context,
          returnTimestamps: false
        });
        const candidate = String(plainPayload?.transcript ?? "").trim();
        if (candidate) transcript = candidate;
      }
      const segments = Array.isArray(payload?.segments)
        ? payload.segments
        : parseQwenTimestampSegments(payload?.timestampsRaw ?? "", payload?.transcript ?? "");
      chunkResults.push({
        index: window.index,
        startSeconds: window.startSeconds,
        endSeconds: window.endSeconds,
        transcript,
        segments
      });
      if (typeof onChunk === "function") {
        onChunk({
          index: window.index,
          total: windows.length,
          startSeconds: window.startSeconds,
          endSeconds: window.endSeconds,
          durationSeconds: window.durationSeconds,
          transcript: String(payload?.transcript ?? "").trim(),
          segmentCount: segments.length
        });
      }
    }
  } finally {
    await fs.rm(chunkDir, { recursive: true, force: true });
  }

  const mergedSegments = mergeQwenChunkSegments(chunkResults);
  const transcript = useSegmentsForTranscript
    ? mergeChunkTranscriptText(chunkResults, mergedSegments)
    : mergeChunkTranscriptText(chunkResults, []);
  const srt = segmentsToSrt(mergedSegments, transcript);
  return {
    transcript,
    timestampsRaw: JSON.stringify(mergedSegments),
    segments: mergedSegments,
    srt,
    chunkCount: windows.length,
    durationSeconds
  };
}
