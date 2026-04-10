#!/usr/bin/env node
import fs from "node:fs/promises";
import { parseSrtToCuts } from "./itinerary_io.mjs";

function usage() {
  return "Usage: node command/paragraphize_plain_from_timing_srt.mjs <plain.txt> <timing.srt> <output.txt> [--pause-seconds <num>]";
}

function tokenize(text = "") {
  return String(text ?? "")
    .replace(/\s+/gu, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

function sentenceWordSpans(text = "") {
  const source = String(text ?? "").replace(/\s+/gu, " ").trim();
  if (!source) return [];
  const parts = source.split(/(?<=[.!?])\s+/u).filter(Boolean);
  const spans = [];
  let cursor = 0;
  for (const part of parts) {
    const words = tokenize(part);
    if (!words.length) continue;
    cursor += words.length;
    spans.push({ endWord: cursor, text: part.trim() });
  }
  return spans;
}

function normalizeWord(text = "") {
  return String(text || "")
    .toLowerCase()
    .replace(/[`'’]/gu, "")
    .replace(/[^a-z0-9]+/gu, "");
}

function sentenceTokens(text = "") {
  return String(text || "")
    .split(/\s+/u)
    .map((w) => normalizeWord(w))
    .filter(Boolean);
}

function hasLikelyTruncatedEcho(prevText = "", nextText = "") {
  const prev = sentenceTokens(prevText);
  const next = sentenceTokens(nextText);
  if (!prev.length || !next.length) return false;
  if (prev.length > 10 || next.length < 4) return false;
  if (prev.length > next.length) return false;

  const minOverlap = Math.max(3, prev.length - 1);
  for (let start = 0; start <= Math.min(2, next.length - minOverlap); start += 1) {
    const maxLen = Math.min(prev.length, next.length - start);
    for (let len = maxLen; len >= minOverlap; len -= 1) {
      const prevSlice = prev.slice(prev.length - len);
      const nextSlice = next.slice(start, start + len);
      let same = true;
      for (let i = 0; i < len; i += 1) {
        if (prevSlice[i] !== nextSlice[i]) {
          same = false;
          break;
        }
      }
      if (!same) continue;
      // Keep only when the next sentence clearly extends meaningfully.
      const extendsTail = (start + len) < next.length;
      const hasLeadIn = start > 0;
      if (extendsTail || hasLeadIn) return true;
    }
  }
  return false;
}

function collapseEchoSentenceSpans(spans = []) {
  const input = Array.isArray(spans) ? spans : [];
  if (input.length <= 1) return input;
  const kept = [];
  for (let i = 0; i < input.length; i += 1) {
    const cur = input[i];
    const next = input[i + 1];
    if (next && hasLikelyTruncatedEcho(cur?.text, next?.text)) {
      continue;
    }
    kept.push({ text: String(cur?.text || "").trim() });
  }
  const out = [];
  let cursor = 0;
  for (const row of kept) {
    const words = tokenize(row.text);
    if (!words.length) continue;
    cursor += words.length;
    out.push({ endWord: cursor, text: row.text });
  }
  return out;
}

function parseArgs(argv = []) {
  const args = [...argv];
  const out = {
    plainPath: args.shift(),
    timingPath: args.shift(),
    outputPath: args.shift(),
    pauseSeconds: 2.2
  };
  while (args.length) {
    const arg = String(args.shift() ?? "");
    if (arg === "--pause-seconds") {
      const n = Number(args.shift());
      if (Number.isFinite(n) && n > 0) out.pauseSeconds = n;
    }
  }
  return out;
}

function countWords(text = "") {
  return tokenize(text).length;
}

function normalizeOutput(text = "") {
  return String(text ?? "")
    .replace(/[ \t]+\n/gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

async function main() {
  const { plainPath, timingPath, outputPath, pauseSeconds } = parseArgs(process.argv.slice(2));
  if (!plainPath || !timingPath || !outputPath) {
    process.stderr.write(`${usage()}\n`);
    process.exit(2);
  }

  const [plainText, timingText] = await Promise.all([
    fs.readFile(plainPath, "utf8"),
    fs.readFile(timingPath, "utf8")
  ]);
  const cuts = parseSrtToCuts(timingText);
  const words = tokenize(plainText);
  if (!cuts.length || !words.length) {
    const out = normalizeOutput(plainText);
    await fs.writeFile(outputPath, out ? `${out}\n` : "", "utf8");
    process.stdout.write(`${outputPath}\n`);
    return;
  }

  const spans = collapseEchoSentenceSpans(sentenceWordSpans(plainText));
  if (!spans.length) {
    await fs.writeFile(outputPath, normalizeOutput(plainText) + "\n", "utf8");
    process.stdout.write(`${outputPath}\n`);
    return;
  }

  const anchors = [];
  let cursor = 0;
  for (let i = 0; i < cuts.length; i += 1) {
    const cut = cuts[i];
    const next = cuts[i + 1];
    const wc = Math.max(1, countWords(cut?.obText ?? ""));
    cursor += wc;
    if (next) {
      const gap = Math.max(0, Number(next.since ?? 0) - Number(cut.until ?? 0));
      if (gap >= pauseSeconds) anchors.push(cursor);
    }
  }

  const breakEnds = new Set();
  const maxForwardWords = 28;
  const maxBackwardWords = 16;
  for (const anchor of anchors) {
    let chosen = null;
    for (const span of spans) {
      if (span.endWord >= anchor && span.endWord <= anchor + maxForwardWords) {
        chosen = span.endWord;
        break;
      }
    }
    if (chosen === null) {
      for (let i = spans.length - 1; i >= 0; i -= 1) {
        const endWord = spans[i].endWord;
        if (endWord <= anchor && endWord >= anchor - maxBackwardWords) {
          chosen = endWord;
          break;
        }
      }
    }
    if (chosen !== null) breakEnds.add(chosen);
  }

  const rendered = [];
  for (const span of spans) {
    rendered.push(span.text);
    if (breakEnds.has(span.endWord)) rendered.push("\n\n");
    else rendered.push(" ");
  }

  const normalized = normalizeOutput(rendered.join(""));
  await fs.writeFile(outputPath, normalized ? `${normalized}\n` : "", "utf8");
  process.stdout.write(`${outputPath}\n`);
}

main().catch((err) => {
  process.stderr.write(`${String(err?.stack || err?.message || err)}\n`);
  process.exit(1);
});
