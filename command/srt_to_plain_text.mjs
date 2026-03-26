#!/usr/bin/env node
import fs from "node:fs/promises";
import { parseSrtToCuts } from "./itinerary_io.mjs";

function usage() {
  return "Usage: node command/srt_to_plain_text.mjs <input.srt> <output.txt>";
}

function normalizeLine(text) {
  return String(text ?? "")
    .replace(/<[^>]+>/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

async function main() {
  const inputPath = process.argv[2];
  const outputPath = process.argv[3];
  if (!inputPath || !outputPath) {
    process.stderr.write(`${usage()}\n`);
    process.exit(2);
  }

  const srtText = await fs.readFile(inputPath, "utf8");
  const cuts = parseSrtToCuts(srtText);
  const lines = [];
  for (const cut of cuts) {
    const line = normalizeLine(cut?.obText ?? "");
    if (!line) continue;
    lines.push(line);
  }

  const plainText = `${lines.join("\n")}\n`;
  await fs.writeFile(outputPath, plainText, "utf8");
  process.stdout.write(`${outputPath}\n`);
}

main().catch((err) => {
  process.stderr.write(`${String(err?.stack || err?.message || err)}\n`);
  process.exit(1);
});

