import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

function formatSrtTimestamp(ms) {
  const totalMs = Math.max(0, Math.trunc(ms));
  const hours = Math.floor(totalMs / 3600000);
  const minutes = Math.floor((totalMs % 3600000) / 60000);
  const seconds = Math.floor((totalMs % 60000) / 1000);
  const millis = totalMs % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")},${String(millis).padStart(3, "0")}`;
}

function toSeconds(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return n;
}

function sanitizeSegmentText(value = "") {
  return String(value ?? "")
    .replace(/^[\s:：\-–—]+/u, "")
    .replace(/\s+/g, " ")
    .trim();
}

function tryParseJsonTimestamps(raw = "") {
  const text = String(raw ?? "").trim();
  if (!text) return [];
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }
  if (!parsed) return [];
  const rows = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.segments)
      ? parsed.segments
      : [];
  const out = [];
  for (const row of rows) {
    if (Array.isArray(row)) {
      const start = toSeconds(row[0]);
      const end = toSeconds(row[1]);
      const textPart = sanitizeSegmentText(row[2] ?? "");
      if (start === null || end === null) continue;
      out.push({ start, end, text: textPart });
      continue;
    }
    const start = toSeconds(row?.start ?? row?.from ?? row?.begin ?? row?.t0);
    const end = toSeconds(row?.end ?? row?.to ?? row?.until ?? row?.t1);
    const textPart = sanitizeSegmentText(row?.text ?? row?.transcript ?? row?.content ?? "");
    if (start === null || end === null) continue;
    out.push({ start, end, text: textPart });
  }
  return out;
}

function parseBracketLines(raw = "") {
  const out = [];
  const lines = String(raw ?? "").split(/\r?\n/u);
  for (const lineRaw of lines) {
    const line = String(lineRaw ?? "").trim();
    if (!line) continue;
    const match = /^\[?\s*(\d+(?:\.\d+)?)\s*(?:,|-|-->)\s*(\d+(?:\.\d+)?)\s*\]?\s*(.*)$/u.exec(line);
    if (!match) continue;
    const start = toSeconds(match[1]);
    const end = toSeconds(match[2]);
    if (start === null || end === null) continue;
    out.push({ start, end, text: sanitizeSegmentText(match[3] ?? "") });
  }
  return out;
}

function parseTokenPairs(raw = "") {
  const text = String(raw ?? "");
  const re = /<\|(\d+(?:\.\d+)?)\|>([\s\S]*?)<\|(\d+(?:\.\d+)?)\|>/gu;
  const out = [];
  let match = re.exec(text);
  while (match) {
    const start = toSeconds(match[1]);
    const end = toSeconds(match[3]);
    if (start !== null && end !== null) {
      out.push({ start, end, text: sanitizeSegmentText(match[2] ?? "") });
    }
    match = re.exec(text);
  }
  return out;
}

function splitTranscriptLines(transcript = "") {
  return String(transcript ?? "")
    .split(/\r?\n/u)
    .map(line => sanitizeSegmentText(line))
    .filter(Boolean);
}

export function parseQwenTimestampSegments(timestampsRaw = "", transcript = "") {
  let segments = tryParseJsonTimestamps(timestampsRaw);
  if (!segments.length) segments = parseTokenPairs(timestampsRaw);
  if (!segments.length) segments = parseBracketLines(timestampsRaw);
  if (!segments.length && String(transcript ?? "").trim()) {
    segments = parseBracketLines(transcript);
  }
  segments = segments
    .map((segment) => {
      const start = Math.max(0, Number(segment?.start ?? 0));
      const endRaw = Number(segment?.end ?? start);
      const end = endRaw > start ? endRaw : start + 1;
      return {
        start,
        end,
        text: sanitizeSegmentText(segment?.text ?? "")
      };
    })
    .filter(segment => Number.isFinite(segment.start) && Number.isFinite(segment.end))
    .sort((a, b) => a.start - b.start);

  if (!segments.length) return [];

  const transcriptLines = splitTranscriptLines(transcript);
  if (transcriptLines.length) {
    let lineIdx = 0;
    for (const segment of segments) {
      if (segment.text) continue;
      if (lineIdx < transcriptLines.length) {
        segment.text = transcriptLines[lineIdx];
        lineIdx += 1;
      }
    }
  }
  return segments;
}

export function segmentsToSrt(segments = [], transcript = "") {
  const normalized = Array.isArray(segments) ? segments : [];
  if (!normalized.length) {
    const lines = splitTranscriptLines(transcript);
    if (!lines.length) return "";
    return `${lines.map((line, index) => {
      const startMs = index * 2000;
      const endMs = (index + 1) * 2000;
      return `${index + 1}\n${formatSrtTimestamp(startMs)} --> ${formatSrtTimestamp(endMs)}\n${line}`;
    }).join("\n\n")}\n`;
  }
  const cues = normalized.map((segment, index) => {
    const text = sanitizeSegmentText(segment?.text ?? "");
    const startMs = Math.max(0, Math.round(Number(segment.start) * 1000));
    const endMs = Math.max(startMs + 1, Math.round(Number(segment.end) * 1000));
    return `${index + 1}\n${formatSrtTimestamp(startMs)} --> ${formatSrtTimestamp(endMs)}\n${text || " "}`;
  });
  return `${cues.join("\n\n")}\n`;
}

export async function transcribeWithQwenComfyui({
  inputPath,
  host,
  workflowRoot,
  workflowName,
  language = "",
  context = "",
  returnTimestamps = true
} = {}) {
  const runner = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../command/hear_comfyui_runner.mjs");
  const args = [
    runner,
    "--input",
    String(inputPath ?? ""),
    "--host",
    String(host ?? ""),
    "--workflow-root",
    String(workflowRoot ?? ""),
    "--workflow-name",
    String(workflowName ?? ""),
    "--return-timestamps",
    returnTimestamps ? "true" : "false"
  ];
  if (String(language ?? "").trim()) args.push("--language", String(language).trim());
  if (String(context ?? "").trim()) args.push("--context", String(context).trim());

  const result = await new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const proc = spawn(process.execPath, args, { stdio: ["ignore", "pipe", "pipe"] });
    proc.stdout.on("data", chunk => { stdout += String(chunk ?? ""); });
    proc.stderr.on("data", chunk => { stderr += String(chunk ?? ""); });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
      else reject(new Error(stderr.trim() || `qwen hear defective: status=${code}`));
    });
  });

  let payload = {};
  try {
    payload = JSON.parse(String(result.stdout || "{}"));
  } catch {
    throw new Error(`qwen hear defective: invalid runner output ${JSON.stringify(result.stdout.slice(-300))}`);
  }
  const transcript = String(payload?.transcript ?? "").trim();
  const timestampsRaw = String(payload?.timestamps ?? "").trim();
  const segments = parseQwenTimestampSegments(timestampsRaw, transcript);
  const srt = segmentsToSrt(segments, transcript);
  return {
    transcript,
    timestampsRaw,
    segments,
    srt,
    host: String(payload?.host ?? host ?? ""),
    model: String(workflowName ?? "")
  };
}
