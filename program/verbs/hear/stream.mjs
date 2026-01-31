import fsSync from "node:fs";

import { resolveConfigBool } from "../../configure/env.mjs";

function normalizeStreamLine(line) {
  return String(line ?? "").trim().toLowerCase();
}

function normalizeStreamPrefix(line) {
  const normalized = normalizeStreamLine(line);
  return normalized.replace(/[.]+$/u, "");
}

function normalizeDedupLine(line) {
  return String(line ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
}

function isBlankAudioLine(line) {
  const trimmed = String(line ?? "").trim();
  return trimmed.includes("[BLANK_AUDIO]");
}

function parseFixtureLines(fixtureText) {
  return String(fixtureText ?? "")
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0 && !isBlankAudioLine(line));
}

function collapseStreamLines(lines) {
  const output = [];
  const seen = new Set();
  let lastLine = "";
  let lastNormalized = "";
  for (const line of lines) {
    const trimmed = String(line ?? "").trim();
    if (!trimmed || isBlankAudioLine(trimmed)) continue;
    const dedup = normalizeDedupLine(trimmed);
    if (dedup && seen.has(dedup) && dedup !== lastNormalized) continue;
    if (!lastLine) {
      output.push(trimmed);
      lastLine = trimmed;
      lastNormalized = dedup;
      if (dedup) seen.add(dedup);
      continue;
    }
    const normLast = normalizeStreamLine(lastLine);
    const normNext = normalizeStreamLine(trimmed);
    const normLastPrefix = normalizeStreamPrefix(lastLine);
    if (normNext === normLast) continue;
    if (normNext.startsWith(normLast) || (normLastPrefix && normNext.startsWith(normLastPrefix))) {
      if (lastNormalized) seen.delete(lastNormalized);
      output[output.length - 1] = trimmed;
      lastLine = trimmed;
      lastNormalized = dedup;
      if (dedup) seen.add(dedup);
      continue;
    }
    output.push(trimmed);
    lastLine = trimmed;
    lastNormalized = dedup;
    if (dedup) seen.add(dedup);
  }
  return output;
}

function buildStreamTranscript(text) {
  const lines = String(text ?? "").split(/\r?\n/);
  return collapseStreamLines(lines).join("\n");
}

function sanitizeTranscript(text) {
  return String(text ?? "")
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0 && !isBlankAudioLine(line))
    .join("\n");
}

function makeStreamStdoutWriter() {
  let lastLine = "";
  let lastNormalized = "";
  const seen = new Set();
  let lineOpen = false;
  return {
    write(line) {
      const trimmed = String(line ?? "").trim();
      if (!trimmed || trimmed === "[BLANK_AUDIO]") return;
      const dedup = normalizeDedupLine(trimmed);
      if (dedup && seen.has(dedup) && dedup !== lastNormalized) return;
      if (!lastLine) {
        process.stdout.write(trimmed);
        lastLine = trimmed;
        lastNormalized = dedup;
        if (dedup) seen.add(dedup);
        lineOpen = true;
        return;
      }
      const normLast = normalizeStreamLine(lastLine);
      const normNext = normalizeStreamLine(trimmed);
      const normLastPrefix = normalizeStreamPrefix(lastLine);
      if (normNext === normLast) return;
      if (normNext.startsWith(normLast) || (normLastPrefix && normNext.startsWith(normLastPrefix))) {
        const suffix = trimmed.slice(lastLine.length);
        if (suffix) {
          process.stdout.write(suffix);
          lastLine = trimmed;
          if (lastNormalized) seen.delete(lastNormalized);
          lastNormalized = dedup;
          if (dedup) seen.add(dedup);
          lineOpen = true;
        }
        return;
      }
      if (lineOpen) process.stdout.write("\n");
      process.stdout.write(trimmed);
      lastLine = trimmed;
      lastNormalized = dedup;
      if (dedup) seen.add(dedup);
      lineOpen = true;
    },
    finish() {
      if (lineOpen) process.stdout.write("\n");
      lineOpen = false;
    }
  };
}

function startFileTail({ filename, onLine }) {
  let offset = 0;
  let pending = "";
  const interval = setInterval(() => {
    let stats;
    try {
      stats = fsSync.statSync(filename);
    } catch {
      return;
    }
    if (stats.size <= offset) return;
    const fd = fsSync.openSync(filename, "r");
    const buffer = Buffer.alloc(stats.size - offset);
    fsSync.readSync(fd, buffer, 0, buffer.length, offset);
    fsSync.closeSync(fd);
    offset = stats.size;
    const text = pending + buffer.toString("utf8");
    const lines = text.split(/\r?\n/);
    pending = lines.pop() ?? "";
    for (const line of lines) {
      if (line.length) onLine(line);
    }
  }, 200);
  return () => clearInterval(interval);
}

function startStreamStdoutTail(streamOutputPath, { onBlank, enabled = true } = {}) {
  if (!enabled) return () => {};
  const writer = makeStreamStdoutWriter();
  const stopTail = startFileTail({
    filename: streamOutputPath,
    onLine: (line) => {
      const trimmed = String(line ?? "").trim();
      if (!trimmed) return;
      if (isBlankAudioLine(trimmed)) {
        if (onBlank) onBlank();
        return;
      }
      writer.write(trimmed);
    }
  });
  return () => {
    stopTail();
    writer.finish();
  };
}

function resolveStreamStdoutEnabled({ rememberFn } = {}) {
  const configured = resolveConfigBool("stream stdout", { rememberFn });
  if (configured !== undefined) return configured;
  return process.stdout?.isTTY === true;
}

function maybeEnableStreamStdout(streamOutputPath, { onBlank, rememberFn } = {}) {
  return startStreamStdoutTail(streamOutputPath, {
    onBlank,
    enabled: resolveStreamStdoutEnabled({ rememberFn })
  });
}

function startStreamEndWatcher(streamOutputPath, { onBlank } = {}) {
  return startFileTail({
    filename: streamOutputPath,
    onLine: (line) => {
      const trimmed = String(line ?? "").trim();
      if (!trimmed) return;
      if (isBlankAudioLine(trimmed)) {
        if (onBlank) onBlank();
      }
    }
  });
}

export {
  parseFixtureLines,
  normalizeStreamLine,
  normalizeStreamPrefix,
  normalizeDedupLine,
  isBlankAudioLine,
  collapseStreamLines,
  buildStreamTranscript,
  sanitizeTranscript,
  makeStreamStdoutWriter,
  startFileTail,
  startStreamStdoutTail,
  resolveStreamStdoutEnabled,
  maybeEnableStreamStdout,
  startStreamEndWatcher
};
