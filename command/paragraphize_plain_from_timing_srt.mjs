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

  const spans = sentenceWordSpans(plainText);
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
