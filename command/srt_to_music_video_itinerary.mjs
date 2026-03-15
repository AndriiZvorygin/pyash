#!/usr/bin/env node
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { parseSrtToCuts } from "./itinerary_io.mjs";

function usage() {
  return "Usage: node command/srt_to_music_video_itinerary.mjs <input.srt> <output.srt> [--gap-seconds <num>]";
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const out = { inputPath: "", outputPath: "", gapSeconds: 6 };
  const positional = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--gap-seconds") {
      out.gapSeconds = Number(args[++i] ?? 6);
      continue;
    }
    positional.push(arg);
  }
  out.inputPath = positional[0] ?? "";
  out.outputPath = positional[1] ?? "";
  return out;
}

function parseTaggedLine(text) {
  const raw = String(text ?? "").trim();
  const m = /^\[([^\]]+)\]\s*(.*)$/u.exec(raw);
  if (!m) return { section: "Section", line: raw };
  return {
    section: String(m[1] ?? "").trim().replace(/\s+/gu, " ") || "Section",
    line: String(m[2] ?? "").trim()
  };
}

function buildTransitionText(prevCut, nextCut) {
  const prev = parseTaggedLine(prevCut?.obText);
  const next = parseTaggedLine(nextCut?.obText);
  if (prev.section !== next.section) {
    return `[Transition] from ${prev.section} toward ${next.section}`;
  }
  return `[Transition] continuation of ${next.section}`;
}

function expandMusicCuts(rawCuts = [], { gapSeconds = 6 } = {}) {
  const cuts = Array.isArray(rawCuts) ? rawCuts : [];
  const safeGapSeconds = Number.isFinite(gapSeconds) && gapSeconds > 0 ? gapSeconds : 6;
  const out = [];
  for (let i = 0; i < cuts.length; i += 1) {
    const current = cuts[i];
    const since = Number(current?.since ?? 0);
    const until = Math.max(since + 0.06, Number(current?.until ?? since));
    out.push({
      since,
      until,
      obText: String(current?.obText ?? "")
    });
    const next = cuts[i + 1];
    if (!next) continue;
    const nextSince = Number(next?.since ?? until);
    const gap = nextSince - until;
    const currentSection = parseTaggedLine(current?.obText).section;
    const nextSection = parseTaggedLine(next?.obText).section;
    const sectionChanged = currentSection !== nextSection;
    const needsTransition = gap > 0.35 && (sectionChanged || gap > safeGapSeconds);
    if (!needsTransition) continue;
    const transitionText = buildTransitionText(current, next);
    const chunkCount = Math.max(1, Math.ceil(gap / safeGapSeconds));
    const chunkSize = gap / chunkCount;
    for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
      const chunkSince = until + (chunkIndex * chunkSize);
      const chunkUntil = Math.min(nextSince, until + ((chunkIndex + 1) * chunkSize));
      out.push({
        since: chunkSince,
        until: Math.max(chunkSince + 0.06, chunkUntil),
        obText: transitionText
      });
    }
  }
  return out.map((cut, idx) => ({
    index: idx + 1,
    name: `cut ${String(idx + 1).padStart(3, "0")}`,
    since: cut.since,
    until: cut.until,
    obText: cut.obText
  }));
}

async function main() {
  const { inputPath, outputPath, gapSeconds } = parseArgs(process.argv);
  if (!inputPath || !outputPath) throw new Error(usage());
  const srtText = await fs.readFile(inputPath, "utf8");
  const rawCuts = parseSrtToCuts(srtText);
  if (!rawCuts.length) throw new Error("srt to music video itinerary defective: no cuts");
  const cuts = expandMusicCuts(rawCuts, { gapSeconds });
  const out = [];
  for (const cut of cuts) {
    out.push(String(cut.index));
    out.push(formatSrtTime(cut.since) + " --> " + formatSrtTime(cut.until));
    out.push(String(cut.obText ?? ""));
    out.push("");
  }
  const outText = `${out.join("\n")}\n`;
  await fs.writeFile(outputPath, outText, "utf8");
  process.stdout.write(`${outputPath}\n`);
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

export {
  parseArgs,
  parseTaggedLine,
  buildTransitionText,
  expandMusicCuts
};

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isDirectRun) {
  main().catch((err) => {
    process.stderr.write(`${err?.message ?? String(err)}\n`);
    process.exit(1);
  });
}
