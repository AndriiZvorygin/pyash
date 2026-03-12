#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

function usage() {
  return "Usage: node command/wise_chip_series_to_chapters.mjs <input.series.pya> <output_chapters.txt> [--max-words <num>]";
}

function parseArgs(argv) {
  if (argv.length < 2) throw new Error(usage());
  const out = {
    inputPath: argv[0],
    outputPath: argv[1],
    maxWords: 8
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--max-words") {
      out.maxWords = Number(argv[i + 1]);
      i += 1;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }
  if (!Number.isFinite(out.maxWords) || out.maxWords < 2) throw new Error("max-words must be >= 2");
  return out;
}

function parseSeries(text) {
  const rows = [];
  const pattern = /^su name\s+(.+?)\s+since num\s+([+-]?\d+(?:\.\d+)?)\s+until num\s+([+-]?\d+(?:\.\d+)?)\s+ob text\s+("(?:\\.|[^"\\])*")\s+ya\s*$/u;
  const lines = String(text ?? "").split(/\r?\n/u);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const m = pattern.exec(line);
    if (!m) continue;
    let chipText = "";
    try {
      chipText = JSON.parse(m[4]);
    } catch {
      chipText = "";
    }
    rows.push({
      name: String(m[1] ?? "").trim(),
      since: Number(m[2] ?? "0"),
      until: Number(m[3] ?? "0"),
      text: String(chipText ?? "").replace(/\s+/gu, " ").trim()
    });
  }
  return rows;
}

function secToClock(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds ?? 0)));
  const hh = Math.floor(total / 3600);
  const mm = Math.floor((total % 3600) / 60);
  const ss = total % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

function toTitle(text, maxWords) {
  const words = String(text ?? "")
    .replace(/[\[\](){}]/gu, " ")
    .replace(/[^\p{L}\p{N}'\-\s]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .slice(0, maxWords);
  if (!words.length) return "Untitled Section";
  const mapped = words.map((word) => {
    if (!word) return word;
    return word.charAt(0).toUpperCase() + word.slice(1);
  });
  return mapped.join(" ");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const seriesText = await fs.readFile(args.inputPath, "utf8");
  const chips = parseSeries(seriesText);
  if (!chips.length) throw new Error("wise chip chapter defective: no wise chips found");

  const lines = [];
  for (let i = 0; i < chips.length; i += 1) {
    const chip = chips[i];
    const ts = i === 0 ? "00:00:00" : secToClock(chip.since);
    const title = toTitle(chip.text, args.maxWords);
    lines.push(`${ts} -- ${title}`);
  }

  await fs.mkdir(path.dirname(args.outputPath), { recursive: true });
  await fs.writeFile(args.outputPath, `${lines.join("\n")}\n`, "utf8");

  console.log(`chapters: ${lines.length}`);
  console.log(`output: ${args.outputPath}`);
}

main().catch((err) => {
  console.error(String(err?.message || err));
  process.exit(1);
});
