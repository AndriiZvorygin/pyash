#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { parseSrtToCuts } from "./itinerary_io.mjs";

function usage() {
  return "Usage: node command/srt_to_wise_chip_series.mjs <input.srt> <output.series.pya> [--min-words <num>] [--max-words <num>] [--pause-seconds <num>]";
}

function quoteText(value) {
  return JSON.stringify(String(value ?? ""));
}

function sanitizeText(value) {
  return String(value ?? "").replace(/\s+/gu, " ").trim();
}

function countWords(value) {
  const text = sanitizeText(value);
  if (!text) return 0;
  return text.split(/\s+/u).length;
}

function formatName(index) {
  return `wise chip ${String(index).padStart(3, "0")}`;
}

function deriveOutputPath(inputPath) {
  const dir = path.dirname(inputPath);
  const base = path.basename(inputPath, path.extname(inputPath));
  return path.join(dir, `${base}_wise_chips.series.pya`);
}

function parseArgs(argv) {
  if (argv.length < 1) {
    throw new Error(usage());
  }
  const out = {
    inputPath: argv[0],
    outputPath: argv[1] || deriveOutputPath(argv[0]),
    minWords: 60,
    maxWords: 180,
    pauseSeconds: 2.2
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--min-words") {
      out.minWords = Number(next);
      i += 1;
      continue;
    }
    if (arg === "--max-words") {
      out.maxWords = Number(next);
      i += 1;
      continue;
    }
    if (arg === "--pause-seconds") {
      out.pauseSeconds = Number(next);
      i += 1;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }
  if (!Number.isFinite(out.minWords) || out.minWords < 1) throw new Error("min-words must be >= 1");
  if (!Number.isFinite(out.maxWords) || out.maxWords < out.minWords) throw new Error("max-words must be >= min-words");
  if (!Number.isFinite(out.pauseSeconds) || out.pauseSeconds < 0) throw new Error("pause-seconds must be >= 0");
  return out;
}

function chipFromRows(rows, idx) {
  const first = rows[0];
  const last = rows[rows.length - 1];
  const text = sanitizeText(rows.map((row) => row.obText).join(" "));
  return {
    index: idx,
    name: formatName(idx),
    since: Number(first?.since ?? 0),
    until: Number(last?.until ?? Number(first?.since ?? 0)),
    text,
    words: countWords(text)
  };
}

function buildChips(cuts, { minWords, maxWords, pauseSeconds }) {
  const cleaned = cuts
    .map((cut) => ({
      since: Number(cut?.since ?? 0),
      until: Number(cut?.until ?? 0),
      obText: sanitizeText(cut?.obText ?? "")
    }))
    .filter((cut) => cut.obText.length > 0)
    .sort((a, b) => (a.since - b.since));

  if (!cleaned.length) return [];

  const chips = [];
  let rows = [cleaned[0]];

  for (let i = 1; i < cleaned.length; i += 1) {
    const next = cleaned[i];
    const prev = rows[rows.length - 1];
    const gapSeconds = Math.max(0, Number(next.since) - Number(prev.until));
    const current = chipFromRows(rows, chips.length + 1);
    const wouldText = sanitizeText(`${current.text} ${next.obText}`);
    const wouldWords = countWords(wouldText);
    const pauseSplit = gapSeconds >= pauseSeconds && current.words >= minWords;
    const sizeSplit = current.words >= maxWords || wouldWords > Math.max(maxWords, current.words + 60);

    if (pauseSplit || sizeSplit) {
      chips.push(current);
      rows = [next];
      continue;
    }
    rows.push(next);
  }

  if (rows.length) chips.push(chipFromRows(rows, chips.length + 1));
  return chips;
}

function renderSeries(chips) {
  const lines = ["su name wise chips be series def"];
  for (const chip of chips) {
    lines.push(`su name ${chip.name} since num ${chip.since.toFixed(3)} until num ${chip.until.toFixed(3)} ob text ${quoteText(chip.text)} ya`);
  }
  lines.push("prah");
  return `${lines.join("\n")}\n`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const inputText = await fs.readFile(args.inputPath, "utf8");
  const cuts = parseSrtToCuts(inputText);
  if (!cuts.length) throw new Error("srt to wise chip defective: no parsed subtitle cuts");

  const chips = buildChips(cuts, {
    minWords: args.minWords,
    maxWords: args.maxWords,
    pauseSeconds: args.pauseSeconds
  });
  if (!chips.length) throw new Error("srt to wise chip defective: no wise chips");

  await fs.mkdir(path.dirname(args.outputPath), { recursive: true });
  await fs.writeFile(args.outputPath, renderSeries(chips), "utf8");

  console.log(`wise chips: ${chips.length}`);
  console.log(`output: ${args.outputPath}`);
}

main().catch((err) => {
  console.error(String(err?.message || err));
  process.exit(1);
});
