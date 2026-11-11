import path from "node:path";
import { fileURLToPath } from "node:url";
import { countWords, yearToWords, integerToWordsHyphenated } from "./text.mjs";
import { runToolWithStderr, probeDurationSeconds, parseLastAstatsMetric } from "./audio.mjs";

function normalizeWordToken(value = "") {
  const normalizeSpellingVariant = (token = "") => {
    const map = {
      behaviour: "behavior",
      behaviours: "behaviors"
    };
    return map[token] || token;
  };
  const raw = String(value ?? "").toLowerCase();
  if (/^\d{3,4}$/.test(raw)) {
    const yearWord = yearToWords(raw);
    if (yearWord) {
      const normalized = String(yearWord).toLowerCase().replace(/[`'’]/gu, "").replace(/[^a-z0-9]+/gu, "");
      return normalizeSpellingVariant(normalized);
    }
  }
  if (/^\d+$/.test(raw)) {
    const numberWord = integerToWordsHyphenated(raw);
    if (numberWord) {
      const normalized = String(numberWord).toLowerCase().replace(/[`'’]/gu, "").replace(/[^a-z0-9]+/gu, "");
      return normalizeSpellingVariant(normalized);
    }
  }
  const normalized = raw.replace(/[`'’]/gu, "").replace(/[^a-z0-9]+/gu, "");
  return normalizeSpellingVariant(normalized);
}

function tokenizedWords(value = "") {
  return String(value ?? "")
    .split(/\s+/u)
    .map((token) => normalizeWordToken(token))
    .filter(Boolean);
}

export function expectedTailTokens(text = "", count = 2) {
  const tokens = tokenizedWords(text);
  const n = Math.max(1, Number(count) || 2);
  return tokens.slice(-n);
}

function verifyAsrTailMatch({ expectedTail = [], transcript = "" } = {}) {
  const expected = Array.isArray(expectedTail) ? expectedTail.filter(Boolean) : [];
  if (!expected.length) return { pass: true, matched: 0, expected: 0 };
  const tokens = tokenizedWords(transcript);
  if (!tokens.length) return { pass: false, matched: 0, expected: expected.length };
  const searchFrom = Math.max(0, tokens.length - Math.max(16, expected.length * 8));
  let cursor = searchFrom;
  let matched = 0;
  for (const want of expected) {
    let found = -1;
    for (let i = cursor; i < tokens.length; i += 1) {
      if (tokens[i] === want) {
        found = i;
        break;
      }
    }
    if (found < 0) return { pass: false, matched, expected: expected.length };
    matched += 1;
    cursor = found + 1;
  }
  return { pass: true, matched, expected: expected.length };
}

function parseTimestampWordStream(timestampsRaw = "") {
  const text = String(timestampsRaw ?? "").trim();
  if (!text) return "";
  const jsonCandidates = [text];
  if (!text.startsWith("[") && !text.startsWith("{")) {
    const firstBracket = text.indexOf("[");
    if (firstBracket >= 0) jsonCandidates.push(text.slice(firstBracket));
    const firstBrace = text.indexOf("{");
    if (firstBrace >= 0) jsonCandidates.push(text.slice(firstBrace));
  }
  for (const candidate of jsonCandidates) {
    try {
      const parsed = JSON.parse(candidate);
      const queue = [parsed];
      const words = [];
      while (queue.length) {
        const cur = queue.shift();
        if (Array.isArray(cur)) {
          queue.push(...cur);
          continue;
        }
        if (cur && typeof cur === "object") {
          if (typeof cur.text === "string" && cur.text.trim()) words.push(cur.text.trim());
          for (const value of Object.values(cur)) queue.push(value);
        }
      }
      if (words.length) return words.join(" ");
    } catch {
      // ignore and use plain-line fallback
    }
  }
  const words = [];
  const lines = text.split(/\r?\n/u);
  for (const line of lines) {
    const match = /^\s*-?\d+(?:\.\d+)?\s*-\s*-?\d+(?:\.\d+)?\s*:\s*(.+)$/u.exec(line);
    if (!match) continue;
    const word = String(match[1] ?? "").trim();
    if (word) words.push(word);
  }
  return words.join(" ");
}

export function verifyAsrTailMatchUsingTranscriptAndTimestamps({
  expectedTail = [],
  transcript = "",
  timestamps = ""
} = {}) {
  const transcriptVerdict = verifyAsrTailMatch({ expectedTail, transcript });
  if (transcriptVerdict.pass) {
    return { ...transcriptVerdict, source: "transcript" };
  }
  const timestampWordStream = parseTimestampWordStream(timestamps);
  if (!timestampWordStream) {
    return { ...transcriptVerdict, source: "transcript" };
  }
  const timestampVerdict = verifyAsrTailMatch({ expectedTail, transcript: timestampWordStream });
  if (timestampVerdict.pass) {
    return { ...timestampVerdict, source: "timestamps" };
  }
  return { ...transcriptVerdict, source: "transcript" };
}

export function applyTailGapGuard({
  verificationRecord = {},
  durationSeconds = NaN,
  isLastChunk = false,
  clipVerifyMinTailMs = 120,
  clipVerifyMinTailWords = 6,
  chunkText = "",
  guardEnabled = false
} = {}) {
  if (!isLastChunk || !guardEnabled) return;
  const chunkWordCount = countWords(chunkText);
  verificationRecord.chunkWordCount = chunkWordCount;
  if (chunkWordCount < Math.max(1, Number(clipVerifyMinTailWords) || 1)) {
    verificationRecord.asrTailGapSkipped = true;
    return;
  }
  const duration = Number(durationSeconds);
  const tailEnd = Number(verificationRecord?.asrTailEndSeconds);
  if (!Number.isFinite(duration) || !Number.isFinite(tailEnd)) return;
  const overshootMs = (tailEnd - duration) * 1000;
  verificationRecord.asrTailOvershootMs = overshootMs;
  if (overshootMs > 0) {
    verificationRecord.asrTailGapMs = 0;
    verificationRecord.asrTailGapClamped = true;
    return;
  }
  const tailGapMs = (duration - tailEnd) * 1000;
  verificationRecord.asrTailGapMs = tailGapMs;
  // If ASR tail ends too far before chunk end, treat as potential truncation.
  if (tailGapMs > clipVerifyMinTailMs) {
    verificationRecord.asrPass = false;
    verificationRecord.asrTailGapFail = true;
  }
}

export function tightenRetryChunkText(text = "") {
  const raw = String(text ?? "").trim();
  if (!raw) return "";
  if (raw.endsWith("...")) return raw.slice(0, -3).trimEnd() + ".";
  if (raw.endsWith("..")) return raw.slice(0, -2).trimEnd() + ".";
  return raw;
}

export function parseTailEndSeconds(timestampsRaw = "") {
  const text = String(timestampsRaw ?? "").trim();
  if (!text) return null;
  const jsonCandidates = [text];
  if (!text.startsWith("[") && !text.startsWith("{")) {
    const firstBracket = text.indexOf("[");
    if (firstBracket >= 0) jsonCandidates.push(text.slice(firstBracket));
    const firstBrace = text.indexOf("{");
    if (firstBrace >= 0) jsonCandidates.push(text.slice(firstBrace));
  }
  for (const candidate of jsonCandidates) {
    try {
      const parsed = JSON.parse(candidate);
      const queue = [parsed];
      let best = null;
      while (queue.length) {
        const cur = queue.shift();
        if (Array.isArray(cur)) {
          queue.push(...cur);
          continue;
        }
        if (cur && typeof cur === "object") {
          const end = Number(cur.end);
          if (Number.isFinite(end)) best = best === null ? end : Math.max(best, end);
          for (const value of Object.values(cur)) queue.push(value);
        }
      }
      if (Number.isFinite(best)) return best;
    } catch {
      // ignore and try regex fallback
    }
  }
  const matches = [...text.matchAll(/"end"\s*:\s*(-?\d+(?:\.\d+)?)/gu)];
  if (matches.length) {
    const end = Number(matches[matches.length - 1]?.[1] ?? "");
    if (Number.isFinite(end)) return end;
  }
  const rangeMatches = [...text.matchAll(/(-?\d+(?:\.\d+)?)\s*-\s*(-?\d+(?:\.\d+)?)/gu)];
  if (rangeMatches.length) {
    let best = null;
    for (const match of rangeMatches) {
      const end = Number(match?.[2] ?? "");
      if (Number.isFinite(end)) best = best === null ? end : Math.max(best, end);
    }
    if (Number.isFinite(best)) return best;
  }
  return null;
}

function looksLikeComfyTempTranscript(value = "") {
  const text = String(value ?? "").trim();
  if (!text) return false;
  return /^ComfyUI_temp_[^s]+.(?:flac|wav|mp3)$/iu.test(text);
}

export function asrEvidenceUnavailable(verificationRecord = {}) {
  const timestamps = String(verificationRecord?.asrTimestamps ?? "").trim();
  const transcript = String(verificationRecord?.asrTranscript ?? "").trim();
  if (timestamps) return false;
  if (!transcript) return true;
  return looksLikeComfyTempTranscript(transcript);
}

export async function detectHotTailSuspect({
  input = "",
  windowMs = 120,
  peakDbThreshold = -12,
  deltaDbThreshold = 1
} = {}) {
  const duration = await probeDurationSeconds(input);
  const windowSeconds = Math.max(0.06, Number(windowMs) / 1000);
  const prevStart = Math.max(0, duration - (windowSeconds * 2));
  const prevEnd = Math.max(0, duration - windowSeconds);
  const tailStart = prevEnd;
  const tailEnd = duration;
  const prev = await runToolWithStderr("ffmpeg", [
    "-hide_banner",
    "-nostats",
    "-v",
    "info",
    "-i",
    input,
    "-af",
    `atrim=start=${prevStart.toFixed(6)}:end=${prevEnd.toFixed(6)},astats=metadata=1:reset=1`,
    "-f",
    "null",
    "-"
  ]);
  const tail = await runToolWithStderr("ffmpeg", [
    "-hide_banner",
    "-nostats",
    "-v",
    "info",
    "-i",
    input,
    "-af",
    `atrim=start=${tailStart.toFixed(6)}:end=${tailEnd.toFixed(6)},astats=metadata=1:reset=1`,
    "-f",
    "null",
    "-"
  ]);
  const prevRmsDb = parseLastAstatsMetric(prev.stderr, "RMS level dB");
  const tailRmsDb = parseLastAstatsMetric(tail.stderr, "RMS level dB");
  const tailPeakDb = parseLastAstatsMetric(tail.stderr, "Peak level dB");
  const deltaDb = tailRmsDb - prevRmsDb;
  const suspect = tailPeakDb > Number(peakDbThreshold) && deltaDb > Number(deltaDbThreshold);
  return {
    suspect,
    durationSeconds: duration,
    prevRmsDb,
    tailRmsDb,
    tailPeakDb,
    deltaDb,
    windowMs: Number(windowMs),
    peakDbThreshold: Number(peakDbThreshold),
    deltaDbThreshold: Number(deltaDbThreshold)
  };
}

export async function verifyChunkTailWithQwenAsr({
  input = "",
  host = "",
  workflowRoot = "",
  workflowName = "",
  expectedTail = []
} = {}) {
  const runner = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../command/hear_comfyui_runner.mjs");
  const args = [
    runner,
    "--input",
    input,
    "--host",
    host,
    "--workflow-root",
    workflowRoot,
    "--workflow-name",
    workflowName,
    "--return-timestamps",
    "true"
  ];
  const { stdout } = await runToolWithStderr(process.execPath, args);
  const lines = String(stdout ?? "").trim().split(/\r?\n/u).filter(Boolean);
  const payloadText = lines[lines.length - 1] ?? "{}";
  let payload = {};
  try {
    payload = JSON.parse(payloadText);
  } catch {
    payload = {};
  }
  const transcript = String(payload?.transcript ?? "").trim();
  const timestamps = String(payload?.timestamps ?? "").trim();
  const verdict = verifyAsrTailMatchUsingTranscriptAndTimestamps({ expectedTail, transcript, timestamps });
  const tailEndSeconds = parseTailEndSeconds(timestamps);
  return {
    pass: verdict.pass,
    transcript,
    timestamps,
    tailEndSeconds,
    matched: verdict.matched,
    expected: verdict.expected,
    matchSource: verdict.source
  };
}

