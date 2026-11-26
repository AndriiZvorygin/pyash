#!/usr/bin/env node
// The line a song repeats.
//
// A song written by the house sings one phrase again in every chorus. That
// phrase is the hook of the song, and it is the line the song is named after.
// This command finds it: the first line of the first block of the sheet that
// the sheet sings twice.
//
// A sheet that repeats nothing has no hook, and the house names the song from
// the sheet itself.

import fs from "node:fs";

/**
 * The blocks of a sheet: every section tag opens a block, and the lines under
 * it belong to that block.
 */
export function parseSheetBlocks(text) {
  const blocks = [];
  let current = null;
  for (const raw of String(text ?? "").split(/\r?\n/u)) {
    const line = raw.trim();
    if (!line) continue;
    const mark = line.match(/^\[([^\]]+)\]/u);
    if (mark) {
      current = { tag: mark[1].trim(), lines: [] };
      blocks.push(current);
      continue;
    }
    if (!current) {
      current = { tag: "", lines: [] };
      blocks.push(current);
    }
    current.lines.push(line);
  }
  return blocks;
}

/**
 * The line a song repeats: the first line of the first block the sheet sings
 * more than once.
 */
export function songHook(text) {
  const blocks = parseSheetBlocks(text);
  const seen = new Map();
  for (const block of blocks) {
    const key = block.lines.join("\n");
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  for (const block of blocks) {
    if ((seen.get(block.lines.join("\n")) ?? 0) < 2) continue;
    const first = block.lines.find((line) => line.trim());
    if (first) return first.trim();
  }
  const chorus = blocks.find((block) => /^chorus\b/iu.test(block.tag));
  const fromChorus = chorus?.lines.find((line) => line.trim());
  if (fromChorus) return fromChorus.trim();
  const first = blocks.find((block) => block.lines.length)?.lines.find((line) => line.trim());
  return first ? first.trim() : "";
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const input = fs.readFileSync(0, "utf8");
  process.stdout.write(songHook(input));
}
