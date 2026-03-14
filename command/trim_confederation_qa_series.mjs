#!/usr/bin/env node
import fs from "node:fs/promises";
import process from "node:process";

import { splitSentences } from "../program/library/sentenceSplitter.mjs";
import { parse } from "../program/understand/index.mjs";

function isQuestionChip(text) {
  return /^####\s+(?!Q[’']?uo\b|Jim\b|Gary\b).+/iu.test(String(text ?? "").trim());
}

function trimClosingTail(text) {
  const source = String(text ?? "");
  const courtesyNeedle = "Is there another query at this time?";
  const courtesyIndex = source.lastIndexOf(courtesyNeedle);
  if (courtesyIndex >= 0) {
    const quoMarkers = ["\n\n#### Q’uo\n\n", "\n\n#### Q'uo\n\n"];
    for (const marker of quoMarkers) {
      const markerIndex = source.lastIndexOf(marker, courtesyIndex);
      if (markerIndex >= 0) {
        return source.slice(0, markerIndex).trimEnd();
      }
    }
  }
  const patterns = [
    /\n\n\\\[\s*Pause\s*\\\][\s\S]*$/iu,
    /\n\n\[\s*Pause\s*\][\s\S]*$/iu,
    /\n\nI am Q[’']uo, and we thank each of you[\s\S]*$/iu,
    /\n\nWe thank you for your beingness[\s\S]*$/iu
  ];
  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (match && typeof match.index === "number") {
      return source.slice(0, match.index).trimEnd();
    }
  }
  return source;
}

function renderSeries(name, entries) {
  const lines = [`su name ${name} be series def`];
  for (const text of entries) {
    lines.push(`ob text quoted.text.${String(text ?? "")}.text.quoted be text ya`);
  }
  lines.push("prah");
  return `${lines.join("\n")}\n`;
}

function parseSeriesText(source) {
  const sentences = splitSentences(String(source ?? ""), { includeThen: true });
  const entries = [];
  let seriesName = "confederation wise chips";
  for (const raw of sentences) {
    const line = String(raw ?? "").trim();
    if (!line) continue;
    const sentence = parse(line);
    if (sentence?.su?.name && sentence?.be === "series" && sentence?.mood === "def") {
      seriesName = sentence.su.name;
      continue;
    }
    if (typeof sentence?.ob?.text === "string") {
      entries.push(sentence.ob.text);
    }
  }
  return { seriesName, entries };
}

async function main() {
  const [inputPath, outputPath] = process.argv.slice(2);
  if (!inputPath || !outputPath) {
    throw new Error("usage: node command/trim_confederation_qa_series.mjs <input> <output>");
  }
  const source = await fs.readFile(inputPath, "utf8");
  const { seriesName, entries } = parseSeriesText(source);
  let trimmed = entries.slice();
  while (trimmed.length > 0 && !isQuestionChip(trimmed[0])) {
    trimmed.shift();
  }
  trimmed = trimmed.map(trimClosingTail);
  trimmed = trimmed.filter(text => String(text ?? "").trim().length > 0);
  await fs.writeFile(outputPath, renderSeries(seriesName, trimmed), "utf8");
}

main().catch((err) => {
  process.stderr.write(`${String(err?.message ?? err)}\n`);
  process.exit(1);
});
